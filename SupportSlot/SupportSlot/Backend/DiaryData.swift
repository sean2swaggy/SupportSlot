import Foundation

// table: gig_diary_entries
struct GigDiaryEntry: Decodable, Identifiable, Equatable {
    let id: ID
    let artistId: ID
    let bookingId: ID?
    let showDate: String          // UK calendar date, YYYY-MM-DD
    let venue: String
    let city: String?
    let promoter: String?
    let feePence: Int
    let expensesPence: Int
    let setList: String?
    let notes: String?
    let createdAt: Date

    static let columns = "id, artist_id, booking_id, show_date, venue, city, promoter, fee_pence, expenses_pence, set_list, notes, created_at"
    var netPence: Int { feePence - expensesPence }
}

/// What the artist types in. Money is entered in pounds and stored as whole pence.
struct DiaryDraft: Equatable {
    var showDate = UKDates.today()
    var venue = ""
    var city = ""
    var promoter = ""
    var fee = ""
    var expenses = ""
    var setList = ""
    var notes = ""
    var bookingId: ID?

    init() {}
    init(_ e: GigDiaryEntry) {
        showDate = e.showDate; venue = e.venue; city = e.city ?? ""; promoter = e.promoter ?? ""
        fee = DiaryMath.poundsText(e.feePence); expenses = DiaryMath.poundsText(e.expensesPence)
        setList = e.setList ?? ""; notes = e.notes ?? ""; bookingId = e.bookingId
    }
    init(booking b: Booking) {
        showDate = b.eventDate; venue = b.venueName; city = b.venueCity; promoter = b.promoterCompany
        fee = DiaryMath.poundsText(b.totalPence); bookingId = b.id
    }

    /// The first thing wrong with the entry, if any.
    var problem: String? {
        if venue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Enter the venue." }
        if venue.count > 120 { return "The venue name is too long." }
        if DiaryMath.pence(fromPounds: fee) == nil { return "Enter the fee as a number, like 150 or 150.50." }
        if DiaryMath.pence(fromPounds: expenses) == nil { return "Enter expenses as a number, like 20 or 20.50." }
        if setList.count > 2000 || notes.count > 2000 { return "Notes and set lists can be up to 2,000 characters." }
        return nil
    }
}

extension Database {
    func diaryEntries() async throws -> [GigDiaryEntry] {
        try await select(Query("gig_diary_entries", GigDiaryEntry.columns).order("show_date", ascending: false).limit(2000))
    }

    private func diaryPayload(_ d: DiaryDraft) -> Patch {
        func text(_ s: String) -> JSONValue {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? .null : .string(t)
        }
        return [
            "show_date": .string(d.showDate),
            "venue": .string(d.venue.trimmingCharacters(in: .whitespacesAndNewlines)),
            "city": text(d.city), "promoter": text(d.promoter),
            "fee_pence": .int(DiaryMath.pence(fromPounds: d.fee) ?? 0),
            "expenses_pence": .int(DiaryMath.pence(fromPounds: d.expenses) ?? 0),
            "set_list": text(d.setList), "notes": text(d.notes),
        ]
    }

    func addDiaryEntry(artistId: ID, _ draft: DiaryDraft) async throws {
        var payload = diaryPayload(draft)
        payload["artist_id"] = .string(artistId)
        payload["booking_id"] = .optional(draft.bookingId)
        try await insert("gig_diary_entries", payload)
    }

    func updateDiaryEntry(id: ID, _ draft: DiaryDraft) async throws {
        let rows = try await update(Query("gig_diary_entries").eq("id", id), diaryPayload(draft))
        if rows.isEmpty { throw AppError("That entry couldn’t be saved.") }
    }

    func deleteDiaryEntry(id: ID) async throws { try await delete(Query("gig_diary_entries").eq("id", id)) }
}

/// Totals, UK tax years and the spreadsheet export. Pure, so it can be tested.
enum DiaryMath {
    /// "150", "150.5", "£1,250.00" → pence. Blank means 0. Negative, more than two decimals, or over £100,000 → nil.
    static func pence(fromPounds raw: String) -> Int? {
        let t = raw.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "£", with: "").replacingOccurrences(of: ",", with: "")
        if t.isEmpty { return 0 }
        let parts = t.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count <= 2, parts.allSatisfy({ $0.allSatisfy(\.isNumber) }), !(parts.first ?? "").isEmpty || parts.count == 2 else { return nil }
        let whole = Int(parts[0].isEmpty ? "0" : String(parts[0])) ?? -1
        var frac = parts.count == 2 ? String(parts[1]) : ""
        guard frac.count <= 2, whole >= 0 else { return nil }
        while frac.count < 2 { frac += "0" }
        let total = whole * 100 + (Int(frac) ?? 0)
        return total <= 10_000_000 ? total : nil
    }

    static func poundsText(_ pence: Int) -> String {
        pence == 0 ? "" : (pence % 100 == 0 ? "\(pence / 100)" : String(format: "%d.%02d", pence / 100, pence % 100))
    }

    /// Plain decimal for a spreadsheet: 12345 → "123.45".
    static func decimal(_ pence: Int) -> String {
        let sign = pence < 0 ? "-" : ""
        let a = abs(pence)
        return String(format: "%@%d.%02d", sign, a / 100, a % 100)
    }

    /// The UK tax year a date falls in (6 April to 5 April), as "2026/27".
    static func taxYear(of iso: String) -> String? {
        guard let p = UKDates.parts(iso) else { return nil }
        let start = (p.m > 4 || (p.m == 4 && p.d >= 6)) ? p.y : p.y - 1
        return String(format: "%d/%02d", start, (start + 1) % 100)
    }

    struct Totals: Equatable { var count = 0, fee = 0, expenses = 0; var net: Int { fee - expenses } }

    static func totals(_ entries: [GigDiaryEntry]) -> Totals {
        entries.reduce(into: Totals()) { $0.count += 1; $0.fee += $1.feePence; $0.expenses += $1.expensesPence }
    }

    /// Entries grouped by tax year, newest year first, each year's entries newest first.
    static func byTaxYear(_ entries: [GigDiaryEntry]) -> [(year: String, entries: [GigDiaryEntry])] {
        let grouped = Dictionary(grouping: entries) { taxYear(of: $0.showDate) ?? "Undated" }
        return grouped.keys.sorted(by: >).map { y in (y, grouped[y]!.sorted { $0.showDate > $1.showDate }) }
    }

    /// A spreadsheet-safe CSV. Cells that start with = + - @ are neutralised so a spreadsheet
    /// can't run them as formulas, and every cell is quoted.
    static func csv(_ entries: [GigDiaryEntry]) -> String {
        func cell(_ s: String?) -> String {
            var v = (s ?? "").replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
            if let f = v.first, "=+-@\t".contains(f) { v = "'" + v }
            return "\"" + v.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        // Amounts are numbers we generate (a negative net must stay a number), so they aren't neutralised.
        func amount(_ pence: Int) -> String { "\"" + decimal(pence) + "\"" }
        var rows = [["Date", "Tax year", "Venue", "City", "Promoter", "Fee (GBP)", "Expenses (GBP)", "Net (GBP)", "Set list", "Notes"].map { cell($0) }.joined(separator: ",")]
        for e in entries.sorted(by: { $0.showDate < $1.showDate }) {
            rows.append([cell(e.showDate), cell(taxYear(of: e.showDate)), cell(e.venue), cell(e.city), cell(e.promoter),
                         amount(e.feePence), amount(e.expensesPence), amount(e.netPence), cell(e.setList), cell(e.notes)].joined(separator: ","))
        }
        return rows.joined(separator: "\n") + "\n"
    }
}
