import Foundation
import CryptoKit

/// PKCE (RFC 7636) for the email links (confirm address, reset password).
///
/// Why: the app is opened from email by the custom URL scheme `supportslot://`.
/// Any other app or web page can open that scheme too, so a link that carried
/// ready-made tokens could be forged to sign the person in as someone else.
/// With PKCE the link carries only a one-time `code`; it is worth nothing
/// without the secret `code_verifier` that was generated here, kept in the
/// Keychain, and never sent anywhere except directly to Supabase when the code
/// is exchanged. A forged or replayed link has no matching verifier, so it fails.
struct PKCEPair: Equatable {
    let verifier: String
    let challenge: String

    /// base64url(SHA-256(verifier)), no padding — the S256 method.
    static func challenge(for verifier: String) -> String {
        base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func generate() -> PKCEPair {
        var bytes = [UInt8](repeating: 0, count: 48)          // 48 random bytes -> 64 URL-safe characters
        precondition(SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess, "no secure random source")
        let verifier = base64url(Data(bytes))
        return PKCEPair(verifier: verifier, challenge: challenge(for: verifier))
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

/// The one email-link flow that is waiting for its link to be opened. A new
/// request replaces the old one; using the link (or failing to) removes it.
struct PendingAuthFlow: Codable, Equatable {
    enum Kind: String, Codable { case signup, recovery }
    let kind: Kind
    let verifier: String
    let createdAt: Date

    /// A link older than this is treated as expired without asking the server.
    static let lifetime: TimeInterval = 60 * 60

    func isExpired(now: Date = Date()) -> Bool { now.timeIntervalSince(createdAt) > Self.lifetime }
}

enum PendingAuthFlowStore {
    static func save(_ flow: PendingAuthFlow, key: String) {
        if let data = try? JSONEncoder().encode(flow) { Keychain.set(data, for: key) }
    }
    static func load(key: String) -> PendingAuthFlow? {
        guard let data = Keychain.get(key) else { return nil }
        return try? JSONDecoder().decode(PendingAuthFlow.self, from: data)
    }
    static func clear(key: String) { Keychain.remove(key) }
}
