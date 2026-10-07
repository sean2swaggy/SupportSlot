import Foundation

/// Every failure the app shows a person. `message` is always one plain
/// sentence; raw database or network text is never surfaced.
struct AppError: Error, LocalizedError, Equatable {
    let message: String
    /// The stable code raised by a SQL function (e.g. `slot_filled`), if any.
    let code: String?
    /// True for a dropped connection or timeout (worth a Retry button).
    let isNetwork: Bool
    /// The Postgres error class when the database reported one (`23505` = a duplicate).
    let sqlState: String?

    init(_ message: String, code: String? = nil, isNetwork: Bool = false, sqlState: String? = nil) {
        self.message = message
        self.code = code
        self.isNetwork = isNetwork
        self.sqlState = sqlState
    }

    var isDuplicate: Bool { sqlState == "23505" }

    var errorDescription: String? { message }

    static let sessionExpired = AppError("Your session has expired. Please log in again.", code: "not_authenticated")
    static let offline = AppError("We couldn't reach the server. Check your connection and try again.", isNetwork: true)
    static func generic(_ fallback: String = "Something went wrong. Please try again.") -> AppError { AppError(fallback) }
}

/// Turns the stable error codes raised by our SQL functions and triggers (and
/// the occasional Postgres/PostgREST error) into one plain sentence a person
/// can act on. Never surfaces raw database text for an unknown error.
enum ErrorMapper {
    private static let messages: [(pattern: String, text: String, options: NSRegularExpression.Options)] = [
        ("not_authenticated", "Your session has expired. Please log in again.", []),
        ("account_suspended", "This account is suspended, so that action isn't available. Contact support if you think that's a mistake.", []),
        ("not_authorized", "You don't have permission to do that.", []),
        ("application_not_found|listing_not_found|thread_not_found", "That item no longer exists.", []),
        ("listing_not_open", "This listing isn't open any more.", []),
        ("applications_closed", "Applications for this listing have closed.", []),
        ("listing_past", "This show's date has already passed.", []),
        ("slot_filled", "Another artist has already been confirmed for this slot.", []),
        ("offer_expired", "This offer has expired. Ask the promoter to send a new one.", []),
        ("offers_outstanding", "There's an offer waiting for an answer — withdraw it before changing the date.", []),
        ("has_confirmed_booking", "This listing has a confirmed booking. Cancel the booking first, or cancel the whole listing.", []),
        ("listing_locked", "This listing has an offer or a confirmed booking, so its date, venue, times and fee can't be edited.", []),
        ("promoter_required", "Only the promoter who owns this listing can do that.", []),
        ("blocked", "You can't message this person.", []),
        ("rate_limited", "You're doing that too quickly. Please wait a moment and try again.", []),
        ("duplicate key|already exists|unique constraint", "You've already done that.", [.caseInsensitive]),
        ("row-level security", "You don't have permission to do that.", []),
        ("deletion_blocked", "This account can't be deleted yet — there's an upcoming confirmed booking. Cancel it first.", []),
    ]

    /// Codes whose message already carries a human sentence after the colon
    /// (e.g. "slot_invalid: the show date is in the past").
    private static let passThrough = try! NSRegularExpression(
        pattern: "^(slot_invalid|application_invalid|message_invalid|profile_invalid|offer_invalid|cancel_invalid|report_invalid|support_invalid|invalid_transition|rate_limited|blocked): ?([\\s\\S]+)$")

    static func friendly(_ raw: String, fallback: String = "Something went wrong. Please try again.") -> String {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return fallback }
        let range = NSRange(text.startIndex..., in: text)

        if let m = passThrough.firstMatch(in: text, range: range), let r = Range(m.range(at: 2), in: text) {
            var sentence = String(text[r]).trimmingCharacters(in: .whitespacesAndNewlines)
            sentence = sentence.prefix(1).uppercased() + sentence.dropFirst()
            if let last = sentence.last, !".!?".contains(last) { sentence += "." }
            return sentence
        }
        for entry in messages {
            if let re = try? NSRegularExpression(pattern: entry.pattern, options: entry.options),
               re.firstMatch(in: text, range: range) != nil {
                return entry.text
            }
        }
        if text.range(of: "fetch|network|offline|load failed|timed out|connection", options: [.regularExpression, .caseInsensitive]) != nil {
            return "We couldn't reach the server. Check your connection and try again."
        }
        if text.range(of: "jwt|session|refresh token", options: [.regularExpression, .caseInsensitive]) != nil {
            return "Your session has expired. Please log in again."
        }
        return fallback
    }

    /// The first stable code in a raw message, if any (`slot_filled`, …).
    static func code(in raw: String) -> String? {
        raw.range(of: "^[a-z_]+(?=[:\\s]|$)", options: .regularExpression).map { String(raw[$0]) }
    }
}
