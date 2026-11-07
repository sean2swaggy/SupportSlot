import Foundation

/// Talks to Supabase Auth (GoTrue) and owns the login session: it keeps it in
/// the Keychain, refreshes it before it expires (one refresh at a time, even
/// if many requests ask at once), and reports changes to the app.
final class AuthService: @unchecked Sendable {
    private let transport: Transport
    private let lock = NSLock()
    private var _session: AuthSession?
    private var refreshTask: Task<AuthSession, Error>?
    private let storageKey: String
    private var flowKey: String { storageKey + ".pkce" }

    /// Called on any change of the signed-in session (including sign-out).
    var onChange: (@Sendable (AuthSession?) -> Void)?

    init(transport: Transport, storageKey: String = "session", restoreFromKeychain: Bool = true) {
        self.transport = transport
        self.storageKey = storageKey
        if restoreFromKeychain { _session = Self.loadStored(key: storageKey) }
    }

    var session: AuthSession? {
        lock.lock(); defer { lock.unlock() }
        return _session
    }

    // MARK: - Session storage

    private static let storeEncoder: JSONEncoder = {
        let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; return e
    }()
    private static let storeDecoder: JSONDecoder = {
        let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601; return d
    }()

    private static func loadStored(key: String) -> AuthSession? {
        guard let data = Keychain.get(key) else { return nil }
        return try? storeDecoder.decode(AuthSession.self, from: data)
    }

    private func store(_ s: AuthSession?) {
        lock.lock()
        _session = s
        lock.unlock()
        if let s, let data = try? Self.storeEncoder.encode(s) { Keychain.set(data, for: storageKey) } else { Keychain.remove(storageKey) }
        onChange?(s)
    }

    // MARK: - Public API

    func signUp(email: String, password: String, role: String) async throws -> SignUpOutcome {
        struct Body: Encodable {
            let email: String; let password: String; let data: [String: String]
            let codeChallenge: String; let codeChallengeMethod = "s256"
        }
        let pkce = PKCEPair.generate()
        let body = try JSONCoding.encoder.encode(Body(email: email, password: password, data: ["role": role], codeChallenge: pkce.challenge))
        let req = transport.request("POST", "/auth/v1/signup", query: QueryEncoding.queryString([("redirect_to", AppConfig.authCallbackURL)]), bearer: nil, body: body)
        let (data, http) = try await transport.send(req)
        guard (200..<300).contains(http.statusCode) else { throw Self.authError(data, status: http.statusCode) }
        PendingAuthFlowStore.save(PendingAuthFlow(kind: .signup, verifier: pkce.verifier, createdAt: Date()), key: flowKey)

        if let token = try? JSONCoding.decoder.decode(TokenResponse.self, from: data) {
            let s = token.session
            store(s)
            return .signedIn(s)
        }
        // Confirmation required: GoTrue returns the user. For an address that
        // already has an account it returns a user with no identities.
        if let user = try? JSONCoding.decoder.decode(AuthUser.self, from: data) {
            if let ids = user.identities, ids.isEmpty { return .alreadyRegistered }
            return .confirmationRequired
        }
        return .confirmationRequired
    }

    @discardableResult
    func signIn(email: String, password: String) async throws -> AuthSession {
        struct Body: Encodable { let email: String; let password: String }
        let body = try JSONEncoder().encode(Body(email: email, password: password))
        let req = transport.request("POST", "/auth/v1/token", query: "grant_type=password", bearer: nil, body: body)
        let (data, http) = try await transport.send(req)
        guard (200..<300).contains(http.statusCode) else { throw Self.authError(data, status: http.statusCode) }
        let s = try JSONCoding.decoder.decode(TokenResponse.self, from: data).session
        store(s)
        return s
    }

    func signOut() async {
        let token = session?.accessToken
        store(nil)
        clearPendingFlow()
        if let token {
            let req = transport.request("POST", "/auth/v1/logout", query: "scope=local", bearer: token)
            _ = try? await transport.send(req)
        }
    }

    /// A valid access token, refreshing first if it is about to expire.
    /// Returns nil when signed out.
    func validAccessToken() async throws -> String? {
        guard let s = session else { return nil }
        if !s.needsRefresh { return s.accessToken }
        return try await refresh().accessToken
    }

    @discardableResult
    func refresh() async throws -> AuthSession {
        guard let task = beginRefresh() else { throw AppError.sessionExpired }
        do {
            let s = try await task.value
            endRefresh()
            store(s)
            return s
        } catch {
            endRefresh()
            if let e = error as? AppError, e == .sessionExpired { store(nil) }
            throw error
        }
    }

    // Lock handling lives in plain synchronous helpers (never held across an await).
    private func beginRefresh() -> Task<AuthSession, Error>? {
        lock.lock(); defer { lock.unlock() }
        if let task = refreshTask { return task }
        guard let current = _session else { return nil }
        let transport = self.transport
        let task = Task<AuthSession, Error> {
            struct Body: Encodable { let refreshToken: String }
            let body = try JSONCoding.encoder.encode(Body(refreshToken: current.refreshToken))
            let req = transport.request("POST", "/auth/v1/token", query: "grant_type=refresh_token", bearer: nil, body: body)
            let (data, http) = try await transport.send(req)
            guard (200..<300).contains(http.statusCode) else {
                // 4xx = the refresh token is no longer valid: the session is over.
                if (400..<500).contains(http.statusCode) { throw AppError.sessionExpired }
                throw AuthService.authError(data, status: http.statusCode)
            }
            return try JSONCoding.decoder.decode(TokenResponse.self, from: data).session
        }
        refreshTask = task
        return task
    }

    private func endRefresh() {
        lock.lock(); refreshTask = nil; lock.unlock()
    }

    /// Re-reads the signed-in user (email confirmation).
    func refreshUser() async throws -> AuthUser {
        guard let token = try await validAccessToken() else { throw AppError.sessionExpired }
        let (data, http) = try await transport.send(transport.request("GET", "/auth/v1/user", bearer: token))
        guard (200..<300).contains(http.statusCode) else { throw Self.authError(data, status: http.statusCode) }
        let user = try JSONCoding.decoder.decode(AuthUser.self, from: data)
        if var s = session { s.user = user; store(s) }
        return user
    }

    func sendPasswordReset(email: String) async throws {
        struct Body: Encodable { let email: String; let codeChallenge: String; let codeChallengeMethod = "s256" }
        let pkce = PKCEPair.generate()
        let body = try JSONCoding.encoder.encode(Body(email: email, codeChallenge: pkce.challenge))
        let req = transport.request("POST", "/auth/v1/recover", query: QueryEncoding.queryString([("redirect_to", AppConfig.authCallbackURL)]), bearer: nil, body: body)
        let (data, http) = try await transport.send(req)
        guard (200..<300).contains(http.statusCode) else { throw Self.authError(data, status: http.statusCode) }
        PendingAuthFlowStore.save(PendingAuthFlow(kind: .recovery, verifier: pkce.verifier, createdAt: Date()), key: flowKey)
    }

    func resendConfirmation(email: String) async throws {
        struct Body: Encodable { let type: String; let email: String; let codeChallenge: String; let codeChallengeMethod = "s256" }
        let pkce = PKCEPair.generate()
        let body = try JSONCoding.encoder.encode(Body(type: "signup", email: email, codeChallenge: pkce.challenge))
        let req = transport.request("POST", "/auth/v1/resend", query: QueryEncoding.queryString([("redirect_to", AppConfig.authCallbackURL)]), bearer: nil, body: body)
        let (data, http) = try await transport.send(req)
        guard (200..<300).contains(http.statusCode) else { throw Self.authError(data, status: http.statusCode) }
        PendingAuthFlowStore.save(PendingAuthFlow(kind: .signup, verifier: pkce.verifier, createdAt: Date()), key: flowKey)
    }

    /// Confirms a new account with the 6-digit code from the sign-up email, and
    /// signs the person in. The code is typed into the app, so it works whichever
    /// device the email was opened on. (The Supabase "Confirm signup" email must
    /// include `{{ .Token }}` for the code to be in it; see docs/EMAIL_TEMPLATES.md.)
    @discardableResult
    func verifyEmailCode(email: String, code: String) async throws -> AuthSession {
        struct Body: Encodable { let type = "signup"; let email: String; let token: String }
        let body = try JSONCoding.encoder.encode(Body(email: email, token: code))
        let (data, http) = try await transport.send(transport.request("POST", "/auth/v1/verify", bearer: nil, body: body))
        guard (200..<300).contains(http.statusCode) else { throw Self.authError(data, status: http.statusCode) }
        let s = try JSONCoding.decoder.decode(TokenResponse.self, from: data).session
        PendingAuthFlowStore.clear(key: flowKey) // the link in the same email is now spent
        store(s)
        return s
    }

    func updatePassword(_ newPassword: String) async throws {
        guard let token = try await validAccessToken() else { throw AppError.sessionExpired }
        struct Body: Encodable { let password: String }
        let body = try JSONEncoder().encode(Body(password: newPassword))
        let (data, http) = try await transport.send(transport.request("PUT", "/auth/v1/user", bearer: token, body: body))
        guard (200..<300).contains(http.statusCode) else { throw Self.authError(data, status: http.statusCode) }
    }

    // MARK: - Email links (confirmation, password reset) — PKCE only

    /// Handles `supportslot://auth-callback?code=…`.
    ///
    /// Only the PKCE code flow is accepted. A link that carries ready-made
    /// tokens (the old implicit flow, `#access_token=…`) is refused without
    /// signing anyone in, because anything on the phone can open this URL
    /// scheme and could use such a link to sign the person in as someone else.
    /// A code is only exchanged if THIS device started the flow, it is under an
    /// hour old, and it hasn't been used: the stored verifier is single-use.
    func handleCallback(_ url: URL, now: Date = Date()) async -> AuthCallbackKind {
        guard url.scheme == AppConfig.urlScheme, url.host == "auth-callback" else { return .notAuthLink }
        var params: [String: String] = [:]
        for part in [url.query, url.fragment].compactMap({ $0 }) {
            for pair in part.split(separator: "&") {
                let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
                if kv.count == 2 { params[kv[0]] = kv[1].replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? kv[1] }
            }
        }
        let expiredText = "That link has expired or was already used. Request a new one."
        if let desc = params["error_description"] ?? params["error"] {
            PendingAuthFlowStore.clear(key: flowKey)
            return .failed(desc.range(of: "expired|invalid|used", options: [.caseInsensitive, .regularExpression]) != nil ? expiredText : "That link didn’t work. Request a new one.")
        }
        if params["access_token"] != nil || params["refresh_token"] != nil {
            // Old-style link carrying tokens. Not accepted. By the time it reaches us the email is already confirmed.
            return .failed("That link is in an older format that we no longer accept for your safety. If you were confirming your email, it’s done — just log in. If you were resetting your password, request a new reset link.")
        }
        guard let code = params["code"], !code.isEmpty else { return .notAuthLink }
        guard let flow = PendingAuthFlowStore.load(key: flowKey) else {
            return .failed("We can’t use that link here — it wasn’t requested from this device, or it was already used. If you just confirmed your email, log in. Otherwise request a new link.")
        }
        // Single use: whatever happens next, this verifier is spent.
        PendingAuthFlowStore.clear(key: flowKey)
        if flow.isExpired(now: now) { return .failed(expiredText) }

        do {
            struct Body: Encodable { let authCode: String; let codeVerifier: String }
            let body = try JSONCoding.encoder.encode(Body(authCode: code, codeVerifier: flow.verifier))
            let (data, http) = try await transport.send(transport.request("POST", "/auth/v1/token", query: "grant_type=pkce", bearer: nil, body: body))
            guard (200..<300).contains(http.statusCode) else { return .failed(expiredText) }
            let s = try JSONCoding.decoder.decode(TokenResponse.self, from: data).session
            store(s)
            return flow.kind == .recovery ? .recovery : .signedIn
        } catch {
            return .failed((error as? AppError)?.message ?? "That link didn’t work. Request a new one.")
        }
    }

    /// Forgets any half-finished email-link flow (on sign-out).
    func clearPendingFlow() { PendingAuthFlowStore.clear(key: flowKey) }

    // MARK: - Errors

    static func authError(_ data: Data, status: Int) -> AppError {
        struct Body: Decodable { let msg: String?; let message: String?; let errorCode: String?; let error: String?; let errorDescription: String? }
        let b = try? JSONCoding.decoder.decode(Body.self, from: data)
        let code = b?.errorCode ?? b?.error ?? ""
        let text = b?.msg ?? b?.message ?? b?.errorDescription ?? ""
        return AppError(friendlyAuth(code: code, text: text, status: status), code: code.isEmpty ? nil : code, isNetwork: false)
    }

    static func friendlyAuth(code: String, text: String, status: Int) -> String {
        let t = text.lowercased()
        switch code {
        case "invalid_credentials": return "That email and password don't match."
        case "email_not_confirmed": return "Confirm your email first — enter the code we emailed you."
        case "user_already_exists", "email_exists": return "That email already has an account. Try logging in instead."
        case "weak_password": return "That password is too weak. Use at least 8 characters with a mix of letters and numbers."
        case "over_request_rate_limit", "over_email_send_rate_limit", "over_sms_send_rate_limit": return "Too many attempts. Please wait a minute and try again."
        case "same_password": return "Choose a password you haven't used before."
        case "otp_expired", "flow_state_expired": return "That code has expired or isn’t right. Request a new one."
        case "user_banned": return "This account is suspended. Contact support if you think that's a mistake."
        case "signup_disabled": return "Sign-up is turned off for this project."
        default: break
        }
        if t.contains("invalid login") { return "That email and password don't match." }
        if t.contains("not confirmed") { return "Confirm your email first — enter the code we emailed you." }
        if t.contains("already registered") { return "That email already has an account. Try logging in instead." }
        if t.contains("password") && (t.contains("short") || t.contains("weak") || t.contains("at least")) { return "That password is too weak. Use at least 8 characters with a mix of letters and numbers." }
        if t.contains("rate limit") || status == 429 { return "Too many attempts. Please wait a minute and try again." }
        if t.contains("different from the old") { return "Choose a password you haven't used before." }
        if status == 401 || status == 403 { return "Your session has expired. Please log in again." }
        return "Something went wrong. Please try again."
    }
}
