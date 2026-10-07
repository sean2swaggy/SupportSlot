import Foundation

/// Raw HTTP to the Supabase project. Everything above this (auth, database)
/// builds a request and gets back bytes or an `AppError`.
final class Transport {
    let config: AppConfig
    let session: URLSession

    init(config: AppConfig, session: URLSession? = nil) {
        self.config = config
        if let session {
            self.session = session
        } else {
            let c = URLSessionConfiguration.default
            c.timeoutIntervalForRequest = 25
            c.waitsForConnectivity = false
            c.requestCachePolicy = .reloadIgnoringLocalCacheData
            self.session = URLSession(configuration: c)
        }
    }

    func url(_ path: String, query: String? = nil) -> URL {
        var s = config.baseURL.absoluteString + path
        if let query, !query.isEmpty { s += "?" + query }
        return URL(string: s)!
    }

    func request(_ method: String, _ path: String, query: String? = nil, bearer: String?, headers: [String: String] = [:], body: Data? = nil) -> URLRequest {
        var r = URLRequest(url: url(path, query: query))
        r.httpMethod = method
        r.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        r.setValue("Bearer \(bearer ?? config.anonKey)", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { r.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        for (k, v) in headers { r.setValue(v, forHTTPHeaderField: k) }
        r.httpBody = body
        return r
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw AppError.generic("Unexpected response from the server.") }
            return (data, http)
        } catch let error as AppError {
            throw error
        } catch let error as URLError {
            switch error.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost,
                 .cannotConnectToHost, .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff:
                throw AppError.offline
            case .cancelled:
                throw CancellationError()
            default:
                throw AppError("We couldn't reach the server. Please try again.", isNetwork: true)
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw AppError.generic()
        }
    }
}

/// Percent-encoding for query strings: everything except RFC 3986 unreserved
/// characters (so `+`, `&`, `=`, `,`, `(` and `)` in a value are always safe).
enum QueryEncoding {
    private static let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
    static func encode(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s }
    static func queryString(_ pairs: [(String, String)]) -> String {
        pairs.map { "\(encode($0.0))=\(encode($0.1))" }.joined(separator: "&")
    }
}
