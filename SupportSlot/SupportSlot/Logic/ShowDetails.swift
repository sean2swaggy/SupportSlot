import Foundation

/// Pure helpers behind "Add to calendar" and "Share show details".
enum ShowDetails {
    static let london = TimeZone(identifier: "Europe/London")!

    /// A show date (`YYYY-MM-DD`) and a clock time (`HH:mm` or `HH:mm:ss`) as a real moment in UK time.
    static func moment(date: String, time: String) -> Date? {
        guard let d = UKDates.parts(date) else { return nil }
        let t = time.split(separator: ":").compactMap { Int($0) }
        guard t.count >= 2, (0..<24).contains(t[0]), (0..<60).contains(t[1]) else { return nil }
        var cal = Calendar(identifier: .gregorian); cal.timeZone = london
        return cal.date(from: DateComponents(timeZone: london, year: d.y, month: d.m, day: d.d, hour: t[0], minute: t[1]))
    }

    /// Plain-text details the artist or promoter can send on. No payment amounts: those stay between the two sides.
    static func shareText(_ b: Booking) -> String {
        var lines = [
            "\(b.headliner) — support slot",
            "\(b.artistName) supporting, promoted by \(b.promoterCompany)",
            "",
            "Date: \(UKDates.formatShowDate(b.eventDate, withYear: true))",
            "Doors: \(UKDates.clock(b.doorsTime))   On stage: \(UKDates.clock(b.setTime)) (\(b.setLengthMins)-minute set)",
            "Venue: \(b.venueName), \(b.venueAddress), \(b.venueCity)",
        ]
        if !b.requirements.isEmpty { lines.append("Requirements: " + b.requirements.joined(separator: "; ")) }
        lines.append("")
        lines.append("Booked through Support Slot.")
        return lines.joined(separator: "\n")
    }
}
