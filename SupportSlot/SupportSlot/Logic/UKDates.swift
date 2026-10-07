import Foundation

/// Show dates and application deadlines are calendar dates in UK time
/// ("YYYY-MM-DD" strings, no clock time), so they are compared as dates in
/// Europe/London — never parsed as instants, which shifts them by a day for
/// anyone in another timezone and around midnight/DST changes.
enum UKDates {
    static let london = TimeZone(identifier: "Europe/London")!

    private static let isoFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = london
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static var utcCalendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    private static let weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    /// Today's date in the UK, as YYYY-MM-DD.
    static func today(now: Date = Date()) -> String { isoFormatter.string(from: now) }

    /// A UK calendar date for a `Date` (e.g. an expiry timestamp), as YYYY-MM-DD.
    static func isoDate(_ date: Date) -> String { isoFormatter.string(from: date) }

    static func parts(_ iso: String) -> (y: Int, m: Int, d: Int)? {
        let bits = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard bits.count == 3, (1...12).contains(bits[1]), (1...31).contains(bits[2]) else { return nil }
        return (bits[0], bits[1], bits[2])
    }

    private static func utcDate(_ p: (y: Int, m: Int, d: Int)) -> Date {
        utcCalendar.date(from: DateComponents(year: p.y, month: p.m, day: p.d))!
    }

    /// Whole calendar days from `from` to `to` (both YYYY-MM-DD). Negative if `to` is earlier.
    static func diffDays(from: String, to: String) -> Int {
        guard let a = parts(from), let b = parts(to) else { return 0 }
        let seconds = utcDate(b).timeIntervalSince(utcDate(a))
        return Int((seconds / 86_400).rounded())
    }

    static func daysUntil(_ iso: String, now: Date = Date()) -> Int { diffDays(from: today(now: now), to: iso) }

    /// A date `offset` calendar days after `iso` (negative for before).
    static func adding(days offset: Int, to iso: String) -> String {
        guard let p = parts(iso) else { return iso }
        let d = utcCalendar.date(byAdding: .day, value: offset, to: utcDate(p))!
        let c = utcCalendar.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// "Dec 1, 2026" or, without the year, "Dec 1".
    static func formatShowDate(_ iso: String, withYear: Bool = false) -> String {
        guard let p = parts(iso) else { return iso }
        return withYear ? "\(months[p.m - 1]) \(p.d), \(p.y)" : "\(months[p.m - 1]) \(p.d)"
    }

    static func weekday(_ iso: String) -> String {
        guard let p = parts(iso) else { return "" }
        let index = utcCalendar.component(.weekday, from: utcDate(p)) - 1
        return weekdays[index]
    }

    /// "Sat, Oct 3" style for cards.
    static func shortDate(_ iso: String) -> String {
        guard parts(iso) != nil else { return iso }
        return "\(weekday(iso).prefix(3)), \(formatShowDate(iso))"
    }

    static func applicationCloseText(_ deadline: String, now: Date = Date()) -> String {
        let d = daysUntil(deadline, now: now)
        if d < 0 { return "Applications closed" }
        if d == 0 { return "Applications close today" }
        if d == 1 { return "Applications close tomorrow" }
        return "Applications close in \(d) days"
    }

    /// True once the deadline's whole day has passed in the UK.
    static func deadlinePassed(_ deadline: String, now: Date = Date()) -> Bool { daysUntil(deadline, now: now) < 0 }

    /// "19:00:00" -> "19:00".
    static func clock(_ time: String) -> String { String(time.prefix(5)) }

    static func timeAgo(_ date: Date, now: Date = Date()) -> String {
        let mins = Int(now.timeIntervalSince(date) / 60)
        if mins < 1 { return "just now" }
        if mins < 60 { return "\(mins) minute\(mins == 1 ? "" : "s") ago" }
        let hours = mins / 60
        if hours < 24 { return "\(hours) hour\(hours == 1 ? "" : "s") ago" }
        let days = hours / 24
        return "\(days) day\(days == 1 ? "" : "s") ago"
    }

    /// "Tue 7 Oct, 14:30" in UK time, for offer deadlines.
    static func dateTime(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = london
        f.dateFormat = "EEE d MMM, HH:mm"
        return f.string(from: date)
    }
}

enum Money {
    private static let grouped: NumberFormatter = {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.numberStyle = .decimal
        f.usesGroupingSeparator = true
        return f
    }()

    /// Whole pounds -> "£1,234".
    static func gbp(_ amount: Int) -> String { "£" + (grouped.string(from: NSNumber(value: amount)) ?? "\(amount)") }

    /// Integer pence -> "£1,234.50".
    static func pence(_ pence: Int) -> String {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.numberStyle = .decimal
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return "£" + (f.string(from: NSNumber(value: Double(pence) / 100)) ?? "\(pence)")
    }

    static func number(_ n: Int) -> String { grouped.string(from: NSNumber(value: n)) ?? "\(n)" }
}
