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
        struct Body: Encodable { let email: String; let password: String; let data: [String: String] }
        let body = try JSONEncoder().encode(Body(email: email, password: password, data: ["role": role]))
        let req = transport.request("POST", "/auth/v1/signup", query: QueryEncoding.queryString([("redirect_to", AppConfig.authCallbackURL)]), bearer: nil, body: body)
        let (data, http) = try await transport.send(req)
        guard (200..<300).contains(http.statusCode) else { throw Self.authError(data, status: http.statusCode) }

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

    /// Re-reads the signed-in user (email confirmation, enrolled factors).
    func refreshUser() async throws -> AuthUser {
        guard let token = try await validAccessToken() else { throw AppError.sessionExpired }
        let (data, http) = try await transport.send(transport.request("GET", "/auth/v1/user", bearer: token))
        guard (200..<300).contains(http.statusCode) else { throw Self.authError(data, status: http.statusCode) }
        let user = try JSONCoding.decoder.decode(AuthUser.self, from: data)
        if var s = session { s.user = user; store(s) }
        return user
    }

    func sendPasswordReset(email: String) async throws {
        struct Body: Encodable { let email: String }
        let body = try JSONEncoder().encode(Body(email: email))
        let req = transport.request("POST", "/auth/v1/recover", query: QueryEncoding.queryString([("redirect_to", AppConfig.authCallbackURL)]), bearer: nil, body: body)
        let (data, http) = try await transport.send(req)
        guard (200..<300).contains(http.statusCode) else { throw Self.authError(data, status: http.statusCode) }
    }

    func resendConfirmation(email: String) async throws {
        struct Body: Encodable { let type: String; let email: String }
        let body = try JSONEncoder().encode(Body(type: "signup", email: email))
        let req = transport.request("POST", "/auth/v1/resend", query: QueryEncoding.queryString([("redirect_to", AppConfig.authCallbackURL)]), bearer: nil, body: body)
        let (data, http) = try await transport.send(req)
        guard (200..<300).contains(http.statusCode) else { throw Self.authError(data, status: http.statusCode) }
    }

    func updatePassword(_ newPassword: String) async throws {
        guard let token = try await validAccessToken() else { throw AppError.sessionExpired }
        struct Body: Encodable { let password: String }
        let body = try JSONEncoder().encode(Body(password: newPassword))
        let (data, http) = try await transport.send(transport.request("PUT", "/auth/v1/user", bearer: token, body: body))
        guard (200..<300).contains(http.statusCode) else { throw Self.authError(data, status: http.statusCode) }
    }

    // MARK: - Email links (confirmation, password reset)

    /// Handles `supportslot://auth-callback#access_token=…&type=recovery`.
    /// Supabase sends the tokens in the URL fragment (or the query on errors).
    func handleCallback(_ url: URL) async -> AuthCallbackKind {
        guard url.scheme == AppConfig.urlScheme, url.host == "auth-callback" else { return .notAuthLink }
        var params: [String: String] = [:]
        for part in [url.fragment, url.query].compactMap({ $0 }) {
            for pair in part.split(separator: "&") {
                let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
                if kv.count == 2 { params[kv[0]] = kv[1].removingPercentEncoding?.replacingOccurrences(of: "+", with: " ") ?? kv[1] }
            }
        }
        if let desc = params["error_description"] ?? params["error"] {
            return .failed(desc.range(of: "expired|invalid", options: [.caseInsensitive, .regularExpression]) != nil
                ? "That link has expired or was already used. Request a new one."
                : "That link didn't work. Request a new one.")
        }
        guard let access = params["access_token"], let refresh = params["refresh_token"] else { return .notAuthLink }
        do {
            let (data, http) = try await transport.send(transport.request("GET", "/auth/v1/user", bearer: access))
            guard (200..<300).contains(http.statusCode) else { return .failed("That link has expired or was already used. Request a new one.") }
            let user = try JSONCoding.decoder.decode(AuthUser.self, from: data)
            let expires = Int(params["expires_in"] ?? "") ?? 3600
            let expiresAt = Int(params["expires_at"] ?? "").map { Date(timeIntervalSince1970: TimeInterval($0)) } ?? Date().addingTimeInterval(TimeInterval(expires))
            store(AuthSession(accessToken: access, refreshToken: refresh, expiresAt: expiresAt, user: user))
            return params["type"] == "recovery" ? .recovery : .signedIn
        } catch {
            return .failed((error as? AppError)?.message ?? "That link didn't work. Request a new one.")
        }
    }

    // MARK: - Two-factor (TOTP)

    func enrollTOTP() async throws -> TOTPEnrollment {
        guard let token = try await validAccessToken() else { throw AppError.sessionExpired }
        struct Body: Encodable { let factorType = "totp"; let friendlyName: String; let issuer = "Support Slot" }
        let body = try JSONCoding.encoder.encode(Body(friendlyName: "Authenticator \(Int(Date().timeIntervalSince1970))"))
        let (data, http) = try await transport.send(transport.request("POST", "/auth/v1/factors", bearer: token, body: body))
        guard (200..<300).contains(http.statusCode) else { throw Self.authError(data, status: http.statusCode) }
        struct Resp: Decodable { struct TOTP: Decodable { let secret: String; let uri: String }; let id: String; let totp: TOTP }
        let r = try JSONCoding.decoder.decode(Resp.self, from: data)
        return TOTPEnrollment(factorID: r.id, secret: r.totp.secret, otpauthURI: r.totp.uri)
    }

    /// Challenges and verifies a code in one go. On success the session is
    /// upgraded to aal2.
    func verifyTOTP(factorID: String, code: String) async throws {
        guard let token = try await validAccessToken() else { throw AppError.sessionExpired }
        let (cdata, chttp) = try await transport.send(transport.request("POST", "/auth/v1/factors/\(factorID)/challenge", bearer: token))
        guard (200..<300).contains(chttp.statusCode) else { throw Self.authError(cdata, status: chttp.statusCode) }
        struct Challenge: Decodable { let id: String }
        let challenge = try JSONCoding.decoder.decode(Challenge.self, from: cdata)

        struct Body: Encodable { let challengeId: String; let code: String }
        let body = try JSONCoding.encoder.encode(Body(challengeId: challenge.id, code: code))
        let (vdata, vhttp) = try await transport.send(transport.request("POST", "/auth/v1/factors/\(factorID)/verify", bearer: token, body: body))
        guard (200..<300).contains(vhttp.statusCode) else { throw Self.authError(vdata, status: vhttp.statusCode, mfa: true) }
        store(try JSONCoding.decoder.decode(TokenResponse.self, from: vdata).session)
    }

    /// Removes a factor that was started but never verified (so setup can restart cleanly).
    func unenroll(factorID: String) async {
        guard let token = try? await validAccessToken() else { return }
        _ = try? await transport.send(transport.request("DELETE", "/auth/v1/factors/\(factorID)", bearer: token))
    }

    // MARK: - Errors

    static func authError(_ data: Data, status: Int, mfa: Bool = false) -> AppError {
        struct Body: Decodable { let msg: String?; let message: String?; let errorCode: String?; let error: String?; let errorDescription: String? }
        let b = try? JSONCoding.decoder.decode(Body.self, from: data)
        let code = b?.errorCode ?? b?.error ?? ""
        let text = b?.msg ?? b?.message ?? b?.errorDescription ?? ""
        return AppError(friendlyAuth(code: code, text: text, status: status, mfa: mfa), code: code.isEmpty ? nil : code, isNetwork: false)
    }

    static func friendlyAuth(code: String, text: String, status: Int, mfa: Bool) -> String {
        let t = text.lowercased()
        if mfa || code.hasPrefix("mfa_") {
            if code == "mfa_verification_failed" || t.contains("invalid totp") || t.contains("invalid") { return "That code isn't right. Try the latest one from your authenticator app." }
            return "We couldn't check that code. Please try again."
        }
        switch code {
        case "invalid_credentials": return "That email and password don't match."
        case "email_not_confirmed": return "Confirm your email first — we sent you a link when you signed up."
        case "user_already_exists", "email_exists": return "That email already has an account. Try logging in instead."
        case "weak_password": return "That password is too weak. Use at least 8 characters with a mix of letters and numbers."
        case "over_request_rate_limit", "over_email_send_rate_limit", "over_sms_send_rate_limit": return "Too many attempts. Please wait a minute and try again."
        case "same_password": return "Choose a password you haven't used before."
        case "otp_expired", "flow_state_expired": return "That link has expired. Request a new one."
        case "user_banned": return "This account is suspended. Contact support if you think that's a mistake."
        case "signup_disabled": return "Sign-up is turned off for this project."
        default: break
        }
        if t.contains("invalid login") { return "That email and password don't match." }
        if t.contains("not confirmed") { return "Confirm your email first — we sent you a link when you signed up." }
        if t.contains("already registered") { return "That email already has an account. Try logging in instead." }
        if t.contains("password") && (t.contains("short") || t.contains("weak") || t.contains("at least")) { return "That password is too weak. Use at least 8 characters with a mix of letters and numbers." }
        if t.contains("rate limit") || status == 429 { return "Too many attempts. Please wait a minute and try again." }
        if t.contains("different from the old") { return "Choose a password you haven't used before." }
        if status == 401 || status == 403 { return "Your session has expired. Please log in again." }
        return "Something went wrong. Please try again."
    }
}
