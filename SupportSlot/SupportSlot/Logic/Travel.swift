import Foundation

/// Straight-line (great-circle) distance. It is NOT a journey time and is never
/// shown as one. Same formula and radius as `public.haversine_miles` in SQL;
/// `GeoTests` and `tests/db/uk-locations.test.ts` check both against the same
/// golden values.
enum Geo {
    static let earthRadiusMiles = 3958.7613

    static func miles(_ a: Coordinate, _ b: Coordinate) -> Double {
        let dLat = (b.lat - a.lat) * .pi / 180
        let dLon = (b.lon - a.lon) * .pi / 180
        let h = pow(sin(dLat / 2), 2) + cos(a.lat * .pi / 180) * cos(b.lat * .pi / 180) * pow(sin(dLon / 2), 2)
        return 2 * earthRadiusMiles * asin(min(1, sqrt(h)))
    }

    /// "47 miles", "1 mile" — for straight-line distances shown to people.
    static func describe(miles: Int) -> String { miles == 1 ? "1 mile" : "\(miles) miles" }
}

/// The long-journey travel rule. There is no routing service in this app, so a
/// journey time can't be known; the rule is defined on straight-line distance:
/// a venue more than 30 miles away in a straight line — or any case where one
/// end has no coordinates — counts as a long journey, and the travel
/// contribution is then at least £10. The numbers live in SQL
/// (`long_journey_miles()`, `minimum_long_journey_travel_pence()`) and the
/// database fixes the amount on an offer; these constants only word the
/// explanation, and a test keeps them in step.
enum Travel {
    static let longJourneyMiles = 30
    static let minimumLongTravelPence = 1000

    static var ruleSummary: String {
        "If the venue is more than \(longJourneyMiles) miles away in a straight line (or we can’t tell how far), the travel contribution is at least \(Money.pence(minimumLongTravelPence)). This is a distance rule, not a journey time."
    }
}

/// What an offer for a listing would contain for one artist, as the database
/// would fix it (`terms_preview`). Money is integer pence.
struct TermsPreview: Decodable, Equatable {
    let feePence: Int
    let travelPence: Int
    let longJourney: Bool
    let distanceMiles: Int?
    let basis: String
    let minimumApplies: Bool

    /// One honest sentence about distance, or nil when nothing true can be said.
    var distanceSentence: String? {
        guard basis == "straight_line", let distanceMiles else {
            return "We can’t tell how far apart these places are, so the minimum travel contribution applies."
        }
        return "About \(Geo.describe(miles: distanceMiles)) apart in a straight line (not a journey time)."
    }
}
