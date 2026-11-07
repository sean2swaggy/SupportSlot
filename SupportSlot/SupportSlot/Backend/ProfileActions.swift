import Foundation

extension Database {
    // MARK: Artist profile

    func updateArtistBasics(id: ID, name: String, genres: [String], bio: String, availability: String,
                            travelRadiusMiles: Int, artistSize: String) async throws {
        let rows = try await update(Query("artists").eq("id", id), [
            "name": .string(name),
            "genres": .strings(genres),
            "bio": .string(bio),
            "availability": .string(availability),
            "travel_radius_miles": .int(travelRadiusMiles),
            "artist_size": .string(artistSize),
        ] as Patch)
        if rows.isEmpty { throw AppError("Your profile couldn’t be saved.") }
    }

    func updateArtistPhotos(id: ID, imageUrl: String?, bannerImageUrl: String?) async throws {
        let rows = try await update(Query("artists").eq("id", id), ["image_url": .optional(imageUrl), "banner_image_url": .optional(bannerImageUrl)] as Patch)
        if rows.isEmpty { throw AppError("Your photos couldn’t be saved.") }
    }

    func updateArtistLinks(id: ID, links: ArtistLinks) async throws {
        func blank(_ s: String) -> JSONValue { s.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(s.trimmingCharacters(in: .whitespaces)) }
        let rows = try await update(Query("artists").eq("id", id), [
            "spotify_url": .string(links.spotify.trimmingCharacters(in: .whitespaces)),
            "instagram_url": .string(links.instagram.trimmingCharacters(in: .whitespaces)),
            "tiktok_url": .string(links.tiktok.trimmingCharacters(in: .whitespaces)),
            "soundcloud_url": blank(links.soundcloud),
            "bandcamp_url": blank(links.bandcamp),
            "youtube_url": blank(links.youtube),
        ] as Patch)
        if rows.isEmpty { throw AppError("Your links couldn’t be saved.") }
    }

    func updateMonthlyListeners(id: ID, value: Int?) async throws {
        let rows = try await update(Query("artists").eq("id", id), ["monthly_listeners": .optional(value)] as Patch)
        if rows.isEmpty { throw AppError("That number couldn’t be saved.") }
    }

    func setLastMinuteAlerts(id: ID, enabled: Bool) async throws {
        let rows = try await update(Query("artists").eq("id", id), ["last_minute_alerts": .bool(enabled)] as Patch)
        if rows.isEmpty { throw AppError("That setting couldn’t be saved.") }
    }

    // MARK: Tracks

    func addTrack(artistId: ID, title: String, duration: String, url: String?, sortOrder: Int) async throws {
        try await insert("artist_tracks", [
            "artist_id": .string(artistId), "title": .string(title.trimmingCharacters(in: .whitespaces)),
            "duration": .string(duration.trimmingCharacters(in: .whitespaces)), "url": .optional(url), "sort_order": .int(sortOrder),
        ] as Patch)
    }

    func updateTrack(artistId: ID, trackId: ID, title: String, duration: String, url: String?) async throws {
        let rows = try await update(Query("artist_tracks").eq("id", trackId).eq("artist_id", artistId), [
            "title": .string(title.trimmingCharacters(in: .whitespaces)), "duration": .string(duration.trimmingCharacters(in: .whitespaces)), "url": .optional(url),
        ] as Patch)
        if rows.isEmpty { throw AppError("Couldn’t save that track.") }
    }

    func deleteTrack(artistId: ID, trackId: ID) async throws {
        try await delete(Query("artist_tracks").eq("id", trackId).eq("artist_id", artistId))
    }

    // MARK: Promoter profile

    func updatePromoter(id: ID, company: String, avatarUrl: String?) async throws {
        let rows = try await update(Query("promoters").eq("id", id), [
            "name": .string(company), "company": .string(company), "avatar_url": .optional(avatarUrl),
        ] as Patch)
        if rows.isEmpty { throw AppError("Your details couldn’t be saved.") }
    }

    // MARK: Settings

    func setNotifyAvailabilityRequests(profileId: ID, enabled: Bool) async throws {
        let rows = try await update(Query("profiles").eq("id", profileId), ["notify_availability_requests": .bool(enabled)] as Patch)
        if rows.isEmpty { throw AppError("That setting couldn’t be saved.") }
    }

    func blockedPromoters(artistId: ID) async throws -> [BlockedPromoter] {
        try await select(Query("promoter_blocks", "promoter_id, promoters(company)").eq("artist_id", artistId).order("created_at", ascending: false))
    }
}

struct BlockedPromoter: Decodable, Identifiable {
    struct Co: Decodable { let company: String }
    let promoterId: ID
    let promoters: Co?
    var id: ID { promoterId }
    var company: String { promoters?.company ?? "A promoter" }
}
