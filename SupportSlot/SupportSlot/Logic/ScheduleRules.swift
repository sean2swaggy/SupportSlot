import Foundation

/// Pure helpers for the show schedule — overlap and conflict detection,
/// ordering, and templates — kept free of the network so they can be tested.
///
/// Every start/end is a naive "YYYY-MM-DDTHH:mm[:ss]" wall-clock string with no
/// timezone, matching the database's `timestamp` columns. The app has exactly
/// one implicit timezone (Europe/London), so nothing is converted: the digits
/// are read and written through a UTC calendar as an offset-free scratch space,
/// never through the device's own timezone.
enum ScheduleRules {
    static let defaultStage = "Main Stage"
    /// "Consecutive performances with no changeover" shorter than this is flagged.
    static let minChangeoverMinutes = 10

    private static var utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    /// Seconds since 1970 for a naive date-time string (read as if it were UTC).
    static func parse(_ iso: String) -> TimeInterval? {
        let pieces = iso.split(separator: "T", maxSplits: 1).map(String.init)
        guard let datePart = pieces.first else { return nil }
        let d = datePart.split(separator: "-").compactMap { Int($0) }
        guard d.count == 3 else { return nil }
        let t = (pieces.count > 1 ? pieces[1] : "00:00:00").split(separator: ":").compactMap { Int($0.prefix(2)) }
        let comps = DateComponents(year: d[0], month: d[1], day: d[2], hour: t.count > 0 ? t[0] : 0, minute: t.count > 1 ? t[1] : 0, second: t.count > 2 ? t[2] : 0)
        return utc.date(from: comps)?.timeIntervalSince1970
    }

    static func format(_ seconds: TimeInterval) -> String {
        let c = utc.dateComponents([.year, .month, .day, .hour, .minute, .second], from: Date(timeIntervalSince1970: seconds))
        return String(format: "%04d-%02d-%02dT%02d:%02d:%02d", c.year!, c.month!, c.day!, c.hour!, c.minute!, c.second!)
    }

    static func time(_ iso: String) -> String { String((iso.split(separator: "T").dropFirst().first ?? "00:00:00").prefix(5)) }

    static func dayLabel(_ iso: String) -> String { UKDates.formatShowDate(String(iso.prefix(10))) }

    /// True when the entry's calendar day differs from the event's own date (it runs past midnight).
    static func crossesIntoNextDay(_ iso: String, eventDate: String) -> Bool { iso.prefix(10) != eventDate.prefix(10) }

    private static func start(_ e: ScheduleEntry) -> TimeInterval { parse(e.startAt) ?? 0 }
    private static func end(_ e: ScheduleEntry) -> TimeInterval { parse(e.endAt) ?? 0 }
    private static func overlaps(_ a: ScheduleEntry, _ b: ScheduleEntry) -> Bool { start(a) < end(b) && start(b) < end(a) }

    /// Distinct stage names in first-seen order; always at least the default stage.
    static func stages(of entries: [ScheduleEntry]) -> [String] {
        var seen: [String] = []
        for e in entries where !seen.contains(e.stage) { seen.append(e.stage) }
        return seen.isEmpty ? [defaultStage] : seen
    }

    /// Display order within one stage — never derived from start/end.
    static func entries(_ entries: [ScheduleEntry], onStage stage: String) -> [ScheduleEntry] {
        entries.filter { $0.stage == stage }.sorted { $0.sortOrder != $1.sortOrder ? $0.sortOrder < $1.sortOrder : start($0) < start($1) }
    }

    /// The all-stages overview, strictly time-ordered.
    static func combinedTimeline(_ entries: [ScheduleEntry]) -> [ScheduleEntry] { entries.sorted { start($0) < start($1) } }

    struct Conflict: Equatable, Identifiable {
        enum Kind { case stageOverlap, artistDoubleBooking, missingChangeover }
        let entryIds: [ID]
        let kind: Kind
        let message: String
        var id: String { entryIds.joined(separator: "|") + "\(kind)" }
    }

    static func stageOverlaps(_ all: [ScheduleEntry]) -> [Conflict] {
        var out: [Conflict] = []
        for stage in stages(of: all) {
            let on = all.filter { $0.stage == stage }
            for i in on.indices { for j in on.indices where j > i && overlaps(on[i], on[j]) {
                out.append(Conflict(entryIds: [on[i].id, on[j].id], kind: .stageOverlap, message: "“\(on[i].title)” and “\(on[j].title)” overlap on \(stage)."))
            } }
        }
        return out
    }

    /// The same artist on two stages at overlapping times — impossible, so always worth flagging.
    static func artistDoubleBookings(_ all: [ScheduleEntry]) -> [Conflict] {
        let with = all.filter { $0.artistId != nil }
        var out: [Conflict] = []
        for i in with.indices { for j in with.indices where j > i {
            let a = with[i], b = with[j]
            if a.artistId == b.artistId, a.stage != b.stage, overlaps(a, b) {
                out.append(Conflict(entryIds: [a.id, b.id], kind: .artistDoubleBooking, message: "Same artist is scheduled on both \(a.stage) and \(b.stage) at overlapping times."))
            }
        } }
        return out
    }

    /// Back-to-back performances on one stage with less than `minGap` minutes between and no changeover entry.
    static func missingChangeovers(_ all: [ScheduleEntry], minGap: Int = minChangeoverMinutes) -> [Conflict] {
        var out: [Conflict] = []
        for stage in stages(of: all) {
            let on = all.filter { $0.stage == stage }.sorted { start($0) < start($1) }
            let perfs = on.filter { $0.kind == "performance" }
            guard perfs.count > 1 else { continue }
            for i in 0..<(perfs.count - 1) {
                let cur = perfs[i], next = perfs[i + 1]
                let gap = (start(next) - end(cur)) / 60
                if gap >= Double(minGap) { continue }
                let hasChangeover = on.contains { $0.kind == "changeover" && start($0) >= end(cur) && end($0) <= start(next) }
                if !hasChangeover {
                    out.append(Conflict(entryIds: [cur.id, next.id], kind: .missingChangeover, message: "“\(cur.title)” and “\(next.title)” are back-to-back on \(stage) with no changeover."))
                }
            }
        }
        return out
    }

    static func allConflicts(_ entries: [ScheduleEntry]) -> [Conflict] {
        stageOverlaps(entries) + artistDoubleBookings(entries) + missingChangeovers(entries)
    }

    static func nextSortOrder(_ entries: [ScheduleEntry], stage: String) -> Int {
        let on = entries.filter { $0.stage == stage }
        return on.isEmpty ? 0 : (on.map(\.sortOrder).max() ?? 0) + 1
    }

    /// Swaps two entries' sort order — only the two changed pairs, so a concurrent editor's untouched entries aren't re-saved.
    static func reorder(_ all: [ScheduleEntry], stage: String, entryId: ID, up: Bool) -> [(id: ID, sortOrder: Int)]? {
        let ordered = entries(all, onStage: stage)
        guard let i = ordered.firstIndex(where: { $0.id == entryId }) else { return nil }
        let t = up ? i - 1 : i + 1
        guard t >= 0, t < ordered.count else { return nil }
        return [(ordered[i].id, ordered[t].sortOrder), (ordered[t].id, ordered[i].sortOrder)]
    }

    /// Builds entries for one event from a template, anchored at `anchorStart` (typically doors on the show date).
    /// Never carries an artist or notes forward — templates don't have them.
    static func apply(_ template: ScheduleTemplate, anchorStart: String) -> [ScheduleEntryDraft] {
        guard let anchor = parse(anchorStart) else { return [] }
        return template.entries.map { te in
            let s = anchor + TimeInterval(te.offsetMinutes * 60)
            return ScheduleEntryDraft(kind: ScheduleKind(rawValue: te.kind) ?? .other, title: te.title, stage: te.stage, startAt: format(s),
                                      endAt: format(s + TimeInterval(te.durationMinutes * 60)), artistId: nil, notes: "", sortOrder: te.sortOrder)
        }
    }

    /// Captures an event's running order as reusable structure: no artists, no private notes, no real dates (only minute offsets).
    static func captureTemplate(_ entries: [ScheduleEntry]) -> [(kind: String, title: String, stage: String, offsetMinutes: Int, durationMinutes: Int, sortOrder: Int)] {
        guard let anchor = entries.map(start).min() else { return [] }
        return entries.map { e in
            (e.kind, e.title, e.stage, Int(((start(e) - anchor) / 60).rounded()), max(1, Int(((end(e) - start(e)) / 60).rounded())), e.sortOrder)
        }
    }

    /// nil when the times are valid.
    static func timesError(start s: String, end e: String) -> String? {
        if s.isEmpty || e.isEmpty { return "Set both a start and end time." }
        guard let a = parse(s), let b = parse(e) else { return "Those times don’t look right." }
        return b <= a ? "End time must be after the start time." : nil
    }

    /// A copy of an entry 30 minutes later (same stage, kind and length), titled distinctly.
    static func duplicate(_ entry: ScheduleEntry, offsetMinutes: Int = 30) -> ScheduleEntryDraft {
        let length = end(entry) - start(entry)
        let s = start(entry) + TimeInterval(offsetMinutes * 60)
        return ScheduleEntryDraft(kind: entry.scheduleKind, title: "\(entry.title) (copy)", stage: entry.stage, startAt: format(s), endAt: format(s + length),
                                  artistId: entry.artistId, notes: entry.notes, sortOrder: entry.sortOrder)
    }
}
