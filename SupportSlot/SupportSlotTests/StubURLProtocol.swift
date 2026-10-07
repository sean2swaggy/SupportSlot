import Foundation
@testable import SupportSlot

/// A fake network for tests: each request is answered by `handler`, and every
/// request is recorded so tests can check what was sent.
final class StubURLProtocol: URLProtocol {
    struct Reply {
        var status: Int = 200
        var headers: [String: String] = [:]
        var body: Data = Data()
        static func json(_ object: Any, status: Int = 200, headers: [String: String] = [:]) -> Reply {
            Reply(status: status, headers: headers, body: try! JSONSerialization.data(withJSONObject: object))
        }
    }

    nonisolated(unsafe) static var handler: ((URLRequest) -> Reply)?
    nonisolated(unsafe) static var requests: [URLRequest] = []
    private static let lock = NSLock()

    static func reset(_ h: @escaping (URLRequest) -> Reply) {
        lock.lock(); defer { lock.unlock() }
        handler = h
        requests = []
    }

    static var recorded: [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return requests
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var req = request
        // Bodies arrive as a stream inside URLProtocol; materialise it so tests can read it.
        if req.httpBody == nil, let stream = req.httpBodyStream {
            stream.open()
            var data = Data()
            let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
            defer { buf.deallocate(); stream.close() }
            while stream.hasBytesAvailable {
                let n = stream.read(buf, maxLength: 4096)
                if n <= 0 { break }
                data.append(buf, count: n)
            }
            req.httpBody = data
        }
        Self.lock.lock()
        Self.requests.append(req)
        let handler = Self.handler
        Self.lock.unlock()
        let reply = handler?(req) ?? Reply(status: 500)
        let response = HTTPURLResponse(url: req.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

enum TestSupport {
    static let config = AppConfig(host: "test-project.supabase.co", anonKey: "anon-key-for-tests-0123456789")

    static func transport() -> Transport {
        let c = URLSessionConfiguration.ephemeral
        c.protocolClasses = [StubURLProtocol.self]
        return Transport(config: config, session: URLSession(configuration: c))
    }

    /// A JWT-shaped token with the given claims (the signature is never checked client-side).
    static func token(aal: String = "aal1", extra: [String: Any] = [:]) -> String {
        func b64(_ obj: [String: Any]) -> String {
            let data = try! JSONSerialization.data(withJSONObject: obj)
            return data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        }
        var claims: [String: Any] = ["aal": aal, "sub": "user-1"]
        for (k, v) in extra { claims[k] = v }
        return "\(b64(["alg": "HS256"])).\(b64(claims)).sig"
    }

    static func tokenJSON(access: String? = nil, refresh: String = "refresh-1", expiresIn: Int = 3600, userID: String = "user-1", factors: [[String: Any]] = []) -> [String: Any] {
        [
            "access_token": access ?? token(), "token_type": "bearer", "expires_in": expiresIn, "refresh_token": refresh,
            "user": ["id": userID, "email": "a@example.com", "email_confirmed_at": "2026-10-07T10:00:00.123456+00:00", "factors": factors],
        ]
    }
}
