import Foundation

struct AuthFactor: Codable, Equatable {
    let id: String
    let friendlyName: String?
    let factorType: String
    let status: String
    var isVerifiedTOTP: Bool { factorType == "totp" && status == "verified" }
}

struct AuthIdentity: Codable, Equatable { let id: String? }

struct AuthUserMetadata: Codable, Equatable { let role: String? }

struct AuthUser: Codable, Equatable {
    let id: String
    let email: String?
    let emailConfirmedAt: Date?
    let factors: [AuthFactor]?
    let identities: [AuthIdentity]?
    let userMetadata: AuthUserMetadata?

    var hasVerifiedTOTP: Bool { factors?.contains(where: \.isVerifiedTOTP) ?? false }
    var verifiedTOTPFactorID: String? { factors?.first(where: \.isVerifiedTOTP)?.id }
}

/// A signed-in session. Persisted in the Keychain.
struct AuthSession: Codable, Equatable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var user: AuthUser

    /// "aal1" (password only) or "aal2" (password + authenticator code), read
    /// from the access token. The app asks for the code until this is aal2.
    var assuranceLevel: String { JWT.claim("aal", in: accessToken) ?? "aal1" }
    var isAAL2: Bool { assuranceLevel == "aal2" }
    var needsRefresh: Bool { expiresAt.timeIntervalSinceNow < 60 }
}

/// What GoTrue returns from sign-in, token refresh and MFA verify.
struct TokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int?
    let expiresAt: Int?
    let user: AuthUser

    var session: AuthSession {
        let expiry = expiresAt.map { Date(timeIntervalSince1970: TimeInterval($0)) }
            ?? Date().addingTimeInterval(TimeInterval(expiresIn ?? 3600))
        return AuthSession(accessToken: accessToken, refreshToken: refreshToken, expiresAt: expiry, user: user)
    }
}

enum JWT {
    /// Reads one string claim from a JWT payload (no signature check — the
    /// server verifies tokens; this only decides which screen to show).
    static func claim(_ name: String, in token: String) -> String? {
        payload(token)?[name] as? String
    }

    static func payload(_ token: String) -> [String: Any]? {
        let parts = token.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var b64 = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return obj
    }
}

struct TOTPEnrollment: Equatable {
    let factorID: String
    let secret: String
    let otpauthURI: String
}

enum SignUpOutcome: Equatable {
    case signedIn(AuthSession)
    /// The project requires email confirmation: tell the person to check their inbox.
    case confirmationRequired
    /// That address already has an account (GoTrue hides this behind a fake success).
    case alreadyRegistered
}

enum AuthCallbackKind: Equatable {
    case recovery
    case signedIn
    case failed(String)
    case notAuthLink
}
