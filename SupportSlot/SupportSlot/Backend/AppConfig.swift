import Foundation

/// Where the app finds its Supabase project. The values come from
/// `Config/Secrets.xcconfig` (gitignored) through Info.plist. If they are
/// missing the app says so instead of failing in confusing ways.
struct AppConfig: Equatable {
    let host: String
    let anonKey: String

    var baseURL: URL { URL(string: "https://\(host)")! }

    /// The URL scheme the app registers; auth emails link back to it.
    static let urlScheme = "supportslot"
    static let authCallbackURL = "\(urlScheme)://auth-callback"

    static func load(from bundle: Bundle = .main) -> AppConfig? {
        let host = (bundle.object(forInfoDictionaryKey: "SupabaseHost") as? String ?? "").trimmingCharacters(in: .whitespaces)
        let key = (bundle.object(forInfoDictionaryKey: "SupabaseAnonKey") as? String ?? "").trimmingCharacters(in: .whitespaces)
        guard isValid(host: host), key.count > 20, !key.hasPrefix("$(") else { return nil }
        return AppConfig(host: host, anonKey: key)
    }

    static func isValid(host: String) -> Bool {
        guard !host.isEmpty, !host.hasPrefix("$("), !host.contains("/"), !host.contains(" "),
              host.contains("."), host != "your-project-ref.supabase.co" else { return false }
        return true
    }
}
