import Foundation

/// Shared JSON coding for the Supabase REST API: snake_case keys, and
/// timestamps that Postgres sends with microseconds and a timezone offset.
enum JSONCoding {
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func parseTimestamp(_ s: String) -> Date? {
        if let d = fractional.date(from: s) { return d }
        if let d = plain.date(from: s) { return d }
        // Postgres may send "2026-10-07 16:20:55+00" (space, short offset).
        var t = s.replacingOccurrences(of: " ", with: "T", options: [], range: s.range(of: " "))
        if t.range(of: "[+-][0-9]{2}$", options: .regularExpression) != nil { t += ":00" }
        return fractional.date(from: t) ?? plain.date(from: t)
    }

    static func formatTimestamp(_ d: Date) -> String { fractional.string(from: d) }

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let s = try c.decode(String.self)
            guard let date = parseTimestamp(s) else {
                throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unrecognised timestamp \(s)")
            }
            return date
        }
        return d
    }()

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(formatTimestamp(date))
        }
        return e
    }()
}

/// A JSON value for RPC arguments and ad-hoc payloads.
enum JSONValue: Encodable, Equatable, ExpressibleByStringLiteral, ExpressibleByIntegerLiteral,
                ExpressibleByBooleanLiteral, ExpressibleByNilLiteral, ExpressibleByFloatLiteral {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    init(stringLiteral value: String) { self = .string(value) }
    init(integerLiteral value: Int) { self = .int(value) }
    init(floatLiteral value: Double) { self = .double(value) }
    init(booleanLiteral value: Bool) { self = .bool(value) }
    init(nilLiteral: ()) { self = .null }

    static func optional(_ s: String?) -> JSONValue { s.map { .string($0) } ?? .null }
    static func optional(_ i: Int?) -> JSONValue { i.map { .int($0) } ?? .null }
    static func optional(_ d: Double?) -> JSONValue { d.map { .double($0) } ?? .null }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .int(let i): try c.encode(i)
        case .double(let d): try c.encode(d)
        case .bool(let b): try c.encode(b)
        case .null: try c.encodeNil()
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}
