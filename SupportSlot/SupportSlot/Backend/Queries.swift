import Foundation

// Every read the app makes. Each function names its table and columns
// explicitly; tests/db/query-contract.test.ts checks them against the schema.

extension Database {
    // MARK: Profiles

    /// Role, set-up and suspension for the signed-in account (aal2 only; works while suspended).
    func accountStatus() async throws -> AccountStatus {
        let rows: [AccountStatus] = try await rpc("my_account_status", [:])
        guard let row = rows.first else { throw AppError.sessionExpired }
        return row
    }

    func profile(id: ID) async throws -> Profile? {
        try await selectOne(Query("profiles", Profile.columns).eq("id", id))
    }

    func artist(id: ID) async throws -> Artist? {
        try await selectOne(Query("artists", Artist.columns).eq("id", id))
    }

    func artist(handle: String) async throws -> Artist? {
        try await selectOne(Query("artists", Artist.columns).eq("handle", handle))
    }

    func promoter(id: ID) async throws -> Promoter? {
        try await selectOne(Query("promoters", Promoter.columns).eq("id", id))
    }

    /// Newest artists first, for the home screen.
    func featuredArtists(limit: Int = 8) async throws -> [Artist] {
        try await select(Query("artists", Artist.listColumns).order("member_since", ascending: false).limit(limit))
    }

    /// Every artist, for the promoter's Discover Artists screen.
    func allArtists() async throws -> [Artist] {
        try await select(Query("artists", Artist.listColumns).order("member_since", ascending: false).limit(500))
    }

    // MARK: Listings

    func venues() async throws -> [Venue] {
        try await select(Query("venues", Venue.columns).order("name"))
    }

    func venue(id: String) async throws -> Venue? {
        try await selectOne(Query("venues", Venue.columns).eq("id", id))
    }

    func slot(id: ID) async throws -> Slot? {
        try await selectOne(Query("slots", Slot.columns).eq("id", id))
    }

    /// Open listings whose deadline and show date haven't passed (UK time).
    func openSlots(limit: Int = 12) async throws -> [Slot] {
        let today = UKDates.today()
        return try await select(Query("slots", Slot.columns).eq("status", "open").gte("application_deadline", today).gte("date", today).order("date").limit(limit))
    }

    func urgentSlots() async throws -> [Slot] {
        let today = UKDates.today()
        return try await select(Query("slots", Slot.columns).eq("status", "open").eq("is_urgent", true).gte("application_deadline", today).gte("date", today).order("application_deadline"))
    }

    /// Public discovery: one server-side query does the searching, filtering,
    /// sorting and paging, so it's correct for signed-out visitors and doesn't
    /// download every listing.
    func searchSlots(_ s: SlotSearch) async throws -> SlotSearchResult {
        let pageSize = min(max(s.pageSize, 1), 50)
        let page = max(s.page, 1)
        let q = s.q.trimmingCharacters(in: .whitespacesAndNewlines)
        let hits: [SearchHit] = try await rpc("search_slots", [
            "p_q": q.isEmpty ? .null : .string(q),
            "p_country": .optional(s.country),
            "p_genre": .optional(s.genre),
            "p_from": .optional(s.from),
            "p_to": .optional(s.to),
            "p_min_fee": .optional(s.minFee),
            "p_venue_size": .optional(s.venueSize),
            "p_artist_size": .optional(s.artistSize),
            "p_near_lat": .optional(s.near?.lat),
            "p_near_lon": .optional(s.near?.lon),
            "p_max_miles": .optional(s.maxMiles),
            "p_urgent_only": .bool(s.urgentOnly),
            "p_sort": .string(s.sort),
            "p_limit": .int(pageSize),
            "p_offset": .int((page - 1) * pageSize),
        ])
        guard let total = hits.first?.totalCount else { return SlotSearchResult(slots: [], total: 0, page: page, pageSize: pageSize) }
        let rows: [Slot] = try await select(Query("slots", Slot.columns).in("id", hits.map(\.id)))
        let byId = Dictionary(uniqueKeysWithValues: rows.map { ($0.id, $0) })
        // The function decides the order; keep it.
        var distances: [ID: Double] = [:]
        for h in hits { if let d = h.distanceMiles { distances[h.id] = d } }
        return SlotSearchResult(slots: hits.compactMap { byId[$0.id] }, distances: distances, total: total, page: page, pageSize: pageSize)
    }

    func slots(ids: [ID]) async throws -> [Slot] {
        if ids.isEmpty { return [] }
        return try await select(Query("slots", Slot.columns).in("id", ids))
    }

    func promoterSlots(promoterId: ID) async throws -> [Slot] {
        try await select(Query("slots", Slot.columns).eq("promoter_id", promoterId).order("posted_at", ascending: false))
    }

    // MARK: Applications and bookings

    /// An artist's own applications, each with its listing and venue.
    func artistApplications(artistId: ID) async throws -> [Application] {
        try await select(Query("applications", Application.withSlotColumns).eq("artist_id", artistId).order("submitted_at", ascending: false))
    }

    /// Applications on the signed-in promoter's listings. Row-level security
    /// limits this to their own listings, so no filter is needed (or trusted).
    func promoterApplications() async throws -> [Application] {
        try await select(Query("applications", Application.withArtistColumns).order("submitted_at", ascending: false).limit(500))
    }

    func applications(forSlot slotId: ID) async throws -> [Application] {
        try await select(Query("applications", Application.withArtistColumns).eq("slot_id", slotId).order("submitted_at", ascending: false))
    }

    /// Bookings the signed-in user is a party to (row-level security does the filtering).
    func myBookings() async throws -> [Booking] {
        try await select(Query("bookings", Booking.columns).order("event_date", ascending: false).limit(300))
    }

    func bookings(forSlot slotId: ID) async throws -> [Booking] {
        try await select(Query("bookings", Booking.columns).eq("slot_id", slotId))
    }

    // MARK: Notifications and saved gigs

    func notifications(profileId: ID) async throws -> [AppNotification] {
        try await select(Query("notifications", AppNotification.columns).eq("profile_id", profileId).order("created_at", ascending: false).limit(50))
    }

    func savedSlotIDs(profileId: ID) async throws -> [ID] {
        try await select(Query("saved_slots", SavedSlot.columns).eq("profile_id", profileId), as: SavedSlot.self).map(\.slotId)
    }

    // MARK: Places and travel terms

    /// The signed-in artist's own private (rounded) coordinates, if they chose a place with a map position.
    func myCoordinate(artistId: ID) async throws -> Coordinate? {
        let row: ArtistLocationRow? = try await selectOne(Query("artist_locations", ArtistLocationRow.columns).eq("artist_id", artistId))
        return row?.coordinate
    }

    /// What an offer on this listing would contain, computed by the database
    /// (the artist's own terms, or — for a promoter — an applicant's).
    func termsPreview(slotId: ID, artistId: ID? = nil) async throws -> TermsPreview? {
        let rows: [TermsPreview] = try await rpc("terms_preview", ["p_slot_id": .string(slotId), "p_artist_id": .optional(artistId)])
        return rows.first
    }

    /// Artist search for promoters. Distances come back rounded up to 5 miles.
    func searchArtists(q: String, genre: String?, country: String?, near: Coordinate?, maxMiles: Int?, sort: String, page: Int, pageSize: Int = 24) async throws -> (hits: [ArtistSearchHit], artists: [Artist]) {
        let hits: [ArtistSearchHit] = try await rpc("search_artists", [
            "p_q": q.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(q.trimmingCharacters(in: .whitespaces)),
            "p_genre": .optional(genre),
            "p_country": .optional(country),
            "p_near_lat": .optional(near?.lat),
            "p_near_lon": .optional(near?.lon),
            "p_max_miles": .optional(maxMiles),
            "p_sort": .string(sort),
            "p_limit": .int(pageSize),
            "p_offset": .int(max(page - 1, 0) * pageSize),
        ])
        if hits.isEmpty { return ([], []) }
        let rows: [Artist] = try await select(Query("artists", Artist.listWithTracksColumns).in("id", hits.map(\.id)))
        let byId = Dictionary(uniqueKeysWithValues: rows.map { ($0.id, $0) })
        return (hits, hits.compactMap { byId[$0.id] })
    }

    // MARK: Blocking

    func isUsernameAvailable(_ username: String) async throws -> Bool {
        try await rpc("is_username_available", ["p_username": .string(username)])
    }
}

// MARK: - Messaging

extension Database {
    static let messagesPerPage = 30

    /// The signed-in person's conversations, newest activity first, each with
    /// its latest message (for the preview and the unread dot).
    func chatThreads(viewerRole: UserRole, viewerId: ID) async throws -> [ChatThread] {
        let column = viewerRole == .artist ? "artist_id" : "promoter_id"
        let rows: [MessageThreadRow] = try await select(
            Query("message_threads", MessageThreadRow.columns).eq(column, viewerId).order("last_message_at", ascending: false, nullsLast: true).limit(100))
        if rows.isEmpty { return [] }

        // The latest messages across all of the person's threads, newest first.
        let recent: [Message] = try await select(
            Query("messages", Message.columns).in("thread_id", rows.map(\.id)).order("created_at", ascending: false).limit(400))
        var latestByThread: [ID: Message] = [:]
        for m in recent where latestByThread[m.threadId] == nil { latestByThread[m.threadId] = m }

        return rows
            .map { ChatThread(row: $0, viewerRole: viewerRole, viewerId: viewerId, latest: latestByThread[$0.id]) }
            .sorted { $0.lastActivity > $1.lastActivity }
    }

    /// The newest page of one conversation, oldest first for display.
    func messages(threadId: ID, before: Date? = nil) async throws -> [Message] {
        var q = Query("messages", Message.columns).eq("thread_id", threadId).order("created_at", ascending: false).limit(Self.messagesPerPage)
        if let before { q = q.lt("created_at", JSONCoding.formatTimestamp(before)) }
        return try await select(q).reversed()
    }
}
