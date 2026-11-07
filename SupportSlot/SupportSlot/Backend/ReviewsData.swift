import Foundation

// table: reviews
struct Review: Decodable, Identifiable, Equatable {
    let id: ID
    let bookingId: ID
    let reviewerId: ID
    let revieweeId: ID
    let reviewerName: String
    let rating: Int
    let comment: String?
    let createdAt: Date

    static let columns = "id, booking_id, reviewer_id, reviewee_id, reviewer_name, rating, comment, created_at"
}

// table: saved_searches
struct SavedSearch: Decodable, Identifiable, Equatable {
    let id: ID
    let artistId: ID
    let label: String
    let genres: [String]
    let maxMiles: Int?
    let createdAt: Date

    static let columns = "id, artist_id, label, genres, max_miles, created_at"
}

enum ReviewMath {
    /// Mean rating to one decimal, or nil when there are no reviews. Never invented: it is the real average.
    static func average(_ reviews: [Review]) -> Double? {
        guard !reviews.isEmpty else { return nil }
        let mean = Double(reviews.map(\.rating).reduce(0, +)) / Double(reviews.count)
        return (mean * 10).rounded() / 10
    }
}

extension Database {
    func reviews(about profileId: ID, limit: Int = 50) async throws -> [Review] {
        try await select(Query("reviews", Review.columns).eq("reviewee_id", profileId).order("created_at", ascending: false).limit(limit))
    }

    func myReview(bookingId: ID, reviewerId: ID) async throws -> Review? {
        try await select(Query("reviews", Review.columns).eq("booking_id", bookingId).eq("reviewer_id", reviewerId).limit(1)).first
    }

    @discardableResult
    func submitReview(bookingId: ID, rating: Int, comment: String?) async throws -> ID {
        try await rpc("submit_review", ["p_booking_id": .string(bookingId), "p_rating": .int(rating), "p_comment": .optional(comment)])
    }

    func savedSearches() async throws -> [SavedSearch] {
        try await select(Query("saved_searches", SavedSearch.columns).order("created_at", ascending: false))
    }

    @discardableResult
    func saveSearch(label: String, genres: [String], maxMiles: Int?) async throws -> ID {
        try await rpc("save_search", ["p_label": .string(label), "p_genres": .strings(genres), "p_max_miles": .optional(maxMiles)])
    }

    func deleteSavedSearch(id: ID) async throws { try await delete(Query("saved_searches").eq("id", id)) }
}
