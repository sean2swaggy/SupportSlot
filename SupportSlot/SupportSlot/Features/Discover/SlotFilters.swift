import Foundation

/// The Discover filters. They turn into one server-side query (`search_slots`).
struct SlotFilters: Equatable {
    enum When: String, CaseIterable, Identifiable {
        case any, week, month, quarter
        var id: String { rawValue }
        var label: String {
            switch self { case .any: return "Any date"; case .week: return "Next 7 days"; case .month: return "Next 31 days"; case .quarter: return "Next 3 months" }
        }
        var days: Int? { switch self { case .any: return nil; case .week: return 7; case .month: return 31; case .quarter: return 92 } }
    }
    enum VenueSize: String, CaseIterable, Identifiable {
        case any, intimate, mid, large
        var id: String { rawValue }
        var label: String {
            switch self { case .any: return "Any venue size"; case .intimate: return "Intimate (< 250)"; case .mid: return "Mid (250–400)"; case .large: return "Large (400+)" }
        }
    }
    enum Sort: String, CaseIterable, Identifiable {
        case date, fee, newest, distance
        var id: String { rawValue }
        var label: String { switch self { case .date: return "Soonest first"; case .fee: return "Highest fee"; case .newest: return "Newly posted"; case .distance: return "Nearest first" } }
    }

    static let payOptions = [80, 120, 150, 200]
    static let distanceOptions = [10, 25, 60, 120, 250]

    var query = ""
    var country: UKNation?
    /// A place chosen to search around (needs a map position), or the artist's own base.
    var near: Place?
    var nearMyBase = false
    var genre: String?
    var when: When = .any
    var minPay: Int?
    var venueSize: VenueSize = .any
    var artistSize: String?
    var distance: Int?
    var sort: Sort = .date
    var urgentOnly = false

    /// Filters other than the search text and sort (what the badge on the filter button counts).
    var activeCount: Int {
        [country != nil, genre != nil, when != .any, minPay != nil, venueSize != .any, artistSize != nil, distance != nil && hasCentre(base: nil, assumeBase: nearMyBase)].filter { $0 }.count
    }
    var isFiltering: Bool { activeCount > 0 || !query.trimmingCharacters(in: .whitespaces).isEmpty }

    mutating func clear() {
        let urgent = urgentOnly
        self = SlotFilters()
        urgentOnly = urgent
    }

    /// Whether a radius search has something to measure from.
    func hasCentre(base: Coordinate?, assumeBase: Bool = false) -> Bool {
        near?.coordinate != nil || (nearMyBase && (base != nil || assumeBase))
    }

    /// The centre of a radius search: the chosen place if it has a map position,
    /// otherwise the artist's own base if they asked for that. Typed-in places have no position.
    func centre(base: Coordinate?) -> Coordinate? {
        if let c = near?.coordinate { return c }
        return nearMyBase ? base : nil
    }

    func search(base: Coordinate?, page: Int, pageSize: Int = 12, today: String = UKDates.today()) -> SlotSearch {
        var s = SlotSearch()
        s.q = query
        s.country = country?.rawValue
        s.genre = genre
        if let days = when.days { s.from = today; s.to = UKDates.adding(days: days, to: today) }
        s.minFee = minPay
        s.venueSize = venueSize == .any ? nil : venueSize.rawValue
        s.artistSize = artistSize
        if let distance, let c = centre(base: base) { s.near = c; s.maxMiles = distance }
        s.urgentOnly = urgentOnly
        s.sort = sort.rawValue
        s.page = page
        s.pageSize = pageSize
        return s
    }
}
