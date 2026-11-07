import Foundation

struct ArtistOnboarding {
    var username: String
    var name: String
    var place: Place
    var genres: [String]
    var spotifyUrl: String
    var instagramUrl: String
    var bio: String
    var imageUrl: String?
}

struct PromoterOnboarding {
    var username: String
    var company: String
    var place: Place
    var avatarUrl: String?
}

enum Slug {
    /// "The Salt Wells!" -> "the-salt-wells".
    static func make(_ name: String) -> String {
        let lowered = name.lowercased().folding(options: .diacriticInsensitive, locale: .current)
        let dashed = lowered.replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return String((dashed.isEmpty ? "artist" : dashed).prefix(40))
    }

    static func randomSuffix() -> String {
        String((0..<4).map { _ in "abcdefghijklmnopqrstuvwxyz0123456789".randomElement()! })
    }
}

extension Database {
    /// Creates the artist's page: claims the username, creates the artist row
    /// (with a unique public handle) and marks the account as set up.
    func completeOnboarding(userId: ID, artist d: ArtistOnboarding) async throws {
        try await claimUsername(userId: userId, username: d.username)

        let base = Slug.make(d.name)
        var handle = base
        for _ in 0..<5 {
            let taken: [IDRow] = try await select(Query("artists", "id").eq("handle", handle).limit(1))
            if taken.isEmpty { break }
            handle = "\(base)-\(Slug.randomSuffix())"
        }
        do {
            try await insert("artists", [
                "id": .string(userId),
                "handle": .string(handle),
                "name": .string(d.name.trimmingCharacters(in: .whitespacesAndNewlines)),
                "location": .string(d.place.label),
                "location_country": .string(d.place.country.rawValue),
                "location_region": .optional(d.place.region),
                "location_source": .string(d.place.source.rawValue),
                "genres": .strings(d.genres),
                "spotify_url": .string(d.spotifyUrl.trimmingCharacters(in: .whitespaces)),
                "instagram_url": .string(d.instagramUrl.trimmingCharacters(in: .whitespaces)),
                "bio": .string(d.bio.trimmingCharacters(in: .whitespacesAndNewlines)),
                "image_url": .optional(d.imageUrl),
            ] as Patch)
        } catch let e as AppError where e.isDuplicate {
            // A retry after a half-finished attempt: the row is already there.
        }
        // The private map position (artists only), written with the label in one step.
        if d.place.hasCoordinates { try await setMyLocation(d.place) }
        try await finishOnboarding(userId: userId)
    }

    func completeOnboarding(userId: ID, promoter d: PromoterOnboarding) async throws {
        try await claimUsername(userId: userId, username: d.username)
        do {
            try await insert("promoters", [
                "id": .string(userId),
                "name": .string(d.company.trimmingCharacters(in: .whitespacesAndNewlines)),
                "company": .string(d.company.trimmingCharacters(in: .whitespacesAndNewlines)),
                "location": .string(d.place.label),
                "location_country": .string(d.place.country.rawValue),
                "location_region": .optional(d.place.region),
                "location_source": .string(d.place.source.rawValue),
                "avatar_url": .optional(d.avatarUrl),
            ] as Patch)
        } catch let e as AppError where e.isDuplicate {
            // A retry after a half-finished attempt: the row is already there.
        }
        try await finishOnboarding(userId: userId)
    }

    /// The username is claimed first so a taken name fails before anything else is created.
    private func claimUsername(userId: ID, username: String) async throws {
        do {
            let rows = try await update(Query("profiles").eq("id", userId), ["username": .string(username)] as Patch)
            if rows.isEmpty { throw AppError("We couldn't save your username. Please try again.") }
        } catch let e as AppError where e.isDuplicate {
            throw AppError("That username was just taken — try another.")
        }
    }

    private func finishOnboarding(userId: ID) async throws {
        let rows = try await update(Query("profiles").eq("id", userId), ["has_onboarded": true] as Patch)
        if rows.isEmpty { throw AppError("We couldn't finish setting up your account. Please try again.") }
    }
}
