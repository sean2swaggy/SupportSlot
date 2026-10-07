import Foundation

/// Rough road distances between the six cities, and the long-journey travel
/// top-up. These mirror `city_distances` and `effective_travel_pence` in the
/// database (tests/db checks that they agree for every pair), which is what
/// actually fixes the amount on an offer; this copy only previews it.
enum Travel {
    private static let distances: [String: Int] = [
        "London-Manchester": 200,
        "London-Birmingham": 120,
        "London-Bristol": 120,
        "London-Leeds": 200,
        "London-Brighton": 55,
        "Manchester-Birmingham": 90,
        "Manchester-Bristol": 170,
        "Manchester-Leeds": 45,
        "Manchester-Brighton": 250,
        "Birmingham-Bristol": 90,
        "Birmingham-Leeds": 120,
        "Birmingham-Brighton": 170,
        "Bristol-Leeds": 210,
        "Bristol-Brighton": 130,
        "Leeds-Brighton": 240,
    ]

    static let averageSpeedMph = 40
    static let longTravelThresholdHours = 1.0
    /// The minimum travel contribution (pounds) guaranteed to the artist on a journey over an hour.
    static let minimumLongTravelPounds = 10

    static func miles(_ a: String, _ b: String) -> Int {
        if a == b { return 0 }
        return distances["\(a)-\(b)"] ?? distances["\(b)-\(a)"] ?? 150
    }

    static func estimatedHours(_ artistCity: String, _ venueCity: String) -> Double {
        Double(miles(artistCity, venueCity)) / Double(averageSpeedMph)
    }

    static func isLongJourney(_ artistCity: String, _ venueCity: String) -> Bool {
        estimatedHours(artistCity, venueCity) > longTravelThresholdHours
    }

    /// What the artist actually gets: the promoter's figure, topped up to £10 on a long journey.
    static func effectiveContribution(pounds: Int, artistCity: String, venueCity: String) -> Int {
        isLongJourney(artistCity, venueCity) ? max(pounds, minimumLongTravelPounds) : pounds
    }
}
