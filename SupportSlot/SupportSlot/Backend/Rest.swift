import Foundation

/// A PostgREST query, built with small chained helpers:
///     Query("slots", "id, headliner").eq("status", "open").order("date").limit(12)
struct Query {
    let table: String
    var columns: String
    fileprivate(set) var pairs: [(String, String)] = []
    fileprivate(set) var orders: [String] = []
    fileprivate(set) var limitValue: Int?
    fileprivate(set) var offsetValue: Int?

    init(_ table: String, _ columns: String = "*") {
        self.table = table
        self.columns = columns
    }

    private func adding(_ column: String, _ op: String, _ value: String) -> Query {
        var q = self
        q.pairs.append((column, "\(op).\(value)"))
        return q
    }

    func eq(_ c: String, _ v: any CustomStringConvertible) -> Query { adding(c, "eq", "\(v)") }
    func neq(_ c: String, _ v: any CustomStringConvertible) -> Query { adding(c, "neq", "\(v)") }
    func gt(_ c: String, _ v: any CustomStringConvertible) -> Query { adding(c, "gt", "\(v)") }
    func gte(_ c: String, _ v: any CustomStringConvertible) -> Query { adding(c, "gte", "\(v)") }
    func lt(_ c: String, _ v: any CustomStringConvertible) -> Query { adding(c, "lt", "\(v)") }
    func lte(_ c: String, _ v: any CustomStringConvertible) -> Query { adding(c, "lte", "\(v)") }
    func ilike(_ c: String, _ pattern: String) -> Query { adding(c, "ilike", pattern) }
    func isNull(_ c: String, _ yes: Bool = true) -> Query { adding(c, "is", yes ? "null" : "not.null") }
    func contains(_ c: String, _ values: [String]) -> Query { adding(c, "cs", "{" + values.map(Self.quote).joined(separator: ",") + "}") }

    /// `column IN (…)`. Values are quoted so commas and spaces are safe.
    func `in`(_ c: String, _ values: [String]) -> Query {
        adding(c, "in", "(" + values.map(Self.quote).joined(separator: ",") + ")")
    }

    /// Raw PostgREST `or=(…)` expression, e.g. `status.eq.open,status.eq.filled`.
    func or(_ expression: String) -> Query {
        var q = self
        q.pairs.append(("or", "(\(expression))"))
        return q
    }

    func order(_ c: String, ascending: Bool = true, nullsLast: Bool = false) -> Query {
        var q = self
        q.orders.append("\(c).\(ascending ? "asc" : "desc")\(nullsLast ? ".nullslast" : "")")
        return q
    }
    func limit(_ n: Int) -> Query { var q = self; q.limitValue = n; return q }
    func offset(_ n: Int) -> Query { var q = self; q.offsetValue = n; return q }
    func page(_ index: Int, size: Int) -> Query { limit(size).offset(index * size) }

    static func quote(_ s: String) -> String {
        "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }

    func queryString(includeSelect: Bool = true) -> String {
        var items = pairs
        if includeSelect { items.insert(("select", columns), at: 0) }
        if !orders.isEmpty { items.append(("order", orders.joined(separator: ","))) }
        if let limitValue { items.append(("limit", String(limitValue))) }
        if let offsetValue { items.append(("offset", String(offsetValue))) }
        return QueryEncoding.queryString(items)
    }

    /// Filters only (for update/delete).
    var filterString: String { QueryEncoding.queryString(pairs) }
}

struct IDRow: Decodable, Equatable { let id: String }

/// The database client: reads, writes and function calls through PostgREST,
/// always as the signed-in user (so row-level security applies), or as the
/// anonymous visitor when nobody is signed in.
final class Database: @unchecked Sendable {
    private let transport: Transport
    private let auth: AuthService

    init(transport: Transport, auth: AuthService) {
        self.transport = transport
        self.auth = auth
    }

    // MARK: Reads

    func select<T: Decodable>(_ q: Query, as type: T.Type = T.self) async throws -> [T] {
        let (data, _) = try await run("GET", "/rest/v1/\(q.table)", query: q.queryString())
        return try decode([T].self, data)
    }

    func selectOne<T: Decodable>(_ q: Query, as type: T.Type = T.self) async throws -> T? {
        try await select(q.limit(1), as: T.self).first
    }

    /// One page of rows plus the total number of matches.
    func selectPage<T: Decodable>(_ q: Query, as type: T.Type = T.self) async throws -> (rows: [T], total: Int) {
        let (data, http) = try await run("GET", "/rest/v1/\(q.table)", query: q.queryString(), headers: ["Prefer": "count=exact"])
        let rows = try decode([T].self, data)
        return (rows, Self.total(from: http) ?? rows.count)
    }

    func count(_ q: Query) async throws -> Int {
        var head = q
        head.columns = "id"
        let (data, http) = try await run("GET", "/rest/v1/\(q.table)", query: head.limit(1).queryString(), headers: ["Prefer": "count=exact"])
        if let t = Self.total(from: http) { return t }
        return try decode([IDRow].self, data).count
    }

    static func total(from http: HTTPURLResponse) -> Int? {
        guard let range = http.value(forHTTPHeaderField: "Content-Range"), let slash = range.lastIndex(of: "/") else { return nil }
        return Int(range[range.index(after: slash)...])
    }

    // MARK: Writes

    @discardableResult
    func insert<B: Encodable, T: Decodable>(_ table: String, _ body: B, returning columns: String, as type: T.Type = T.self) async throws -> [T] {
        let (data, _) = try await run("POST", "/rest/v1/\(table)", query: QueryEncoding.queryString([("select", columns)]),
                                      headers: ["Prefer": "return=representation"], body: JSONCoding.encoder.encode(body))
        return try decode([T].self, data)
    }

    func insert<B: Encodable>(_ table: String, _ body: B) async throws {
        _ = try await run("POST", "/rest/v1/\(table)", headers: ["Prefer": "return=minimal"], body: JSONCoding.encoder.encode(body))
    }

    /// Inserts, ignoring rows that already exist (used for idempotent saves).
    func insertIgnoringDuplicates<B: Encodable>(_ table: String, _ body: B, onConflict: String) async throws {
        _ = try await run("POST", "/rest/v1/\(table)", query: QueryEncoding.queryString([("on_conflict", onConflict)]),
                          headers: ["Prefer": "resolution=ignore-duplicates,return=minimal"], body: JSONCoding.encoder.encode(body))
    }

    /// Updates the rows matching `q`'s filters and returns their ids. An empty
    /// result means the row-level security policy hid the row (not yours, or gone).
    @discardableResult
    func update<B: Encodable>(_ q: Query, _ body: B) async throws -> [IDRow] {
        let (data, _) = try await run("PATCH", "/rest/v1/\(q.table)", query: q.filterString + "&select=id",
                                      headers: ["Prefer": "return=representation"], body: JSONCoding.encoder.encode(body))
        return try decode([IDRow].self, data)
    }

    @discardableResult
    func delete(_ q: Query) async throws -> [IDRow] {
        let (data, _) = try await run("DELETE", "/rest/v1/\(q.table)", query: q.filterString + "&select=id", headers: ["Prefer": "return=representation"])
        return try decode([IDRow].self, data)
    }

    // MARK: Functions

    func rpc<T: Decodable>(_ name: String, _ params: [String: JSONValue] = [:], as type: T.Type = T.self) async throws -> T {
        let (data, _) = try await run("POST", "/rest/v1/rpc/\(name)", body: JSONCoding.encoder.encode(params))
        return try decode(T.self, data)
    }

    /// An RPC whose JSON result is handed back untouched (e.g. the data export).
    func rpcRaw(_ name: String, _ params: [String: JSONValue] = [:]) async throws -> Data {
        let (data, _) = try await run("POST", "/rest/v1/rpc/\(name)", body: JSONCoding.encoder.encode(params))
        return data
    }

    func rpcVoid(_ name: String, _ params: [String: JSONValue] = [:]) async throws {
        _ = try await run("POST", "/rest/v1/rpc/\(name)", body: JSONCoding.encoder.encode(params))
    }

    // MARK: Plumbing

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        if data.isEmpty, T.self == [IDRow].self { return [IDRow]() as! T }
        do {
            return try JSONCoding.decoder.decode(T.self, from: data)
        } catch {
            #if DEBUG
            print("Decoding \(T.self) failed: \(error)")
            #endif
            throw AppError.generic("We got an unexpected response from the server. Please try again.")
        }
    }

    /// Sends a request as the current user; if the access token turns out to be
    /// expired, refreshes once and retries.
    @discardableResult
    private func run(_ method: String, _ path: String, query: String? = nil, headers: [String: String] = [:], body: Data? = nil) async throws -> (Data, HTTPURLResponse) {
        var attempt = 0
        while true {
            let token = try await auth.validAccessToken()
            let req = transport.request(method, path, query: query, bearer: token, headers: headers, body: body)
            let (data, http) = try await transport.send(req)
            if (200..<300).contains(http.statusCode) { return (data, http) }

            if http.statusCode == 401, token != nil, attempt == 0 {
                attempt += 1
                _ = try await auth.refresh()
                continue
            }
            throw Self.error(from: data, status: http.statusCode)
        }
    }

    struct PostgrestError: Decodable { let code: String?; let message: String?; let details: String?; let hint: String? }

    static func error(from data: Data, status: Int) -> AppError {
        let e = try? JSONCoding.decoder.decode(PostgrestError.self, from: data)
        let raw = e?.message ?? ""
        let code = e?.code ?? ""
        // The app is newer than the database: say so plainly instead of "something went wrong".
        if code == "PGRST202" || code == "42883" || code == "42P01" || code == "PGRST205" || code == "42703" || code == "PGRST204" {
            return AppError("This app needs the latest database schema. Ask whoever runs Support Slot to apply it, then try again.", code: "schema_out_of_date")
        }
        if status == 401 || code == "PGRST301" { return AppError.sessionExpired }
        if status == 403, raw.isEmpty { return AppError("You don't have permission to do that.", code: "forbidden") }
        return AppError(ErrorMapper.friendly(raw), code: ErrorMapper.code(in: raw), sqlState: code.isEmpty ? nil : code)
    }
}
