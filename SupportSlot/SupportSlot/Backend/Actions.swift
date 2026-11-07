import Foundation

// Every write the signed-in app makes. Anything that changes application,
// booking, listing or message state goes through a SQL function that checks who
// is asking and what state things are in, inside one transaction. Each of these
// throws an `AppError` on failure — nothing ever pretends a failed write worked.

typealias Patch = [String: JSONValue]

extension JSONValue {
    static func strings(_ values: [String]) -> JSONValue { .array(values.map { .string($0) }) }
}

extension Database {
    // MARK: Applications

    @discardableResult
    func apply(slotId: ID, artistId: ID, featuredTrackId: ID?, message: String?) async throws -> ID {
        let trimmed = message?.trimmingCharacters(in: .whitespacesAndNewlines)
        let rows: [IDRow] = try await insert("applications", [
            "slot_id": .string(slotId),
            "artist_id": .string(artistId),
            "featured_track_id": .optional(featuredTrackId),
            "message": .optional(trimmed?.isEmpty == true ? nil : trimmed),
        ] as Patch, returning: "id")
        guard let id = rows.first?.id else { throw AppError.generic("Couldn't submit your application.") }
        return id
    }

    func markViewed(applicationId: ID) async throws { try await rpcVoid("mark_application_viewed", ["p_application_id": .string(applicationId)]) }
    func shortlist(applicationId: ID) async throws { try await rpcVoid("shortlist_application", ["p_application_id": .string(applicationId)]) }
    func decline(applicationId: ID, reason: String?) async throws {
        try await rpcVoid("decline_application", ["p_application_id": .string(applicationId), "p_reason": .optional(reason)])
    }
    @discardableResult
    func makeOffer(applicationId: ID, message: String?) async throws -> ID {
        try await rpc("make_offer", ["p_application_id": .string(applicationId), "p_message": .optional(message)])
    }
    func withdrawOffer(applicationId: ID) async throws { try await rpcVoid("withdraw_offer", ["p_application_id": .string(applicationId)]) }
    @discardableResult
    func respondToOffer(applicationId: ID, accept: Bool, reason: String?) async throws -> String {
        try await rpc("respond_to_offer", ["p_application_id": .string(applicationId), "p_accept": .bool(accept), "p_reason": .optional(reason)])
    }
    func withdrawApplication(applicationId: ID) async throws { try await rpcVoid("withdraw_application", ["p_application_id": .string(applicationId)]) }
    func cancelBooking(applicationId: ID, reason: String) async throws {
        try await rpcVoid("cancel_booking", ["p_application_id": .string(applicationId), "p_reason": .string(reason)])
    }

    // MARK: Listings

    func closeSlot(id: ID) async throws { try await rpcVoid("close_slot", ["p_slot_id": .string(id)]) }
    func cancelSlot(id: ID, reason: String?) async throws { try await rpcVoid("cancel_slot", ["p_slot_id": .string(id), "p_reason": .optional(reason)]) }
    func rescheduleSlot(id: ID, date: String, doors: String, set: String) async throws {
        try await rpcVoid("reschedule_slot", ["p_slot_id": .string(id), "p_date": .string(date), "p_doors": .string(doors), "p_set": .string(set)])
    }

    func reopenSlot(id: ID) async throws {
        let rows = try await update(Query("slots").eq("id", id), ["status": "open", "closed_at": nil, "closed_reason": nil] as Patch)
        if rows.isEmpty { throw AppError("You can't reopen this listing.") }
    }

    private func listingPayload(_ d: ListingDraft, headlinerImage: String?, artistPhoto: String?) -> Patch {
        [
            "headliner": .string(d.headliner.trimmingCharacters(in: .whitespacesAndNewlines)),
            "headliner_image_url": .optional(headlinerImage),
            "artist_photo_url": .optional(artistPhoto),
            "venue_id": .string(d.venueId),
            "date": .string(d.date),
            "doors_time": .string(d.doorsTime),
            "set_time": .string(d.setTime),
            "performance_length_mins": .int(d.performanceLengthMins ?? 30),
            "genres": .strings(d.genres),
            "expected_attendance": .int(d.expectedAttendance ?? 1),
            "support_fee": .int(d.supportFee ?? 0),
            "travel_contribution": .int(d.travelContribution ?? 0),
            "requirements": .strings(ListingRules.parseRequirements(d.requirementsText)),
            "application_deadline": .string(d.applicationDeadline),
            "is_urgent": .bool(d.isUrgent),
            "artist_size_fit": .strings(d.artistSizeFit),
            "description": .string(d.description),
        ]
    }

    @discardableResult
    func createListing(promoterId: ID, _ d: ListingDraft, headlinerImage: String?, artistPhoto: String?) async throws -> ID {
        var payload = listingPayload(d, headlinerImage: headlinerImage, artistPhoto: artistPhoto)
        payload["promoter_id"] = .string(promoterId)
        let rows: [IDRow] = try await insert("slots", payload, returning: "id")
        guard let id = rows.first?.id else { throw AppError.generic("Couldn't publish your listing.") }
        return id
    }

    /// Edits a listing the signed-in promoter owns. The database refuses a change
    /// to the date, venue, times or fee while an offer or confirmed booking exists.
    func updateListing(id: ID, _ d: ListingDraft, headlinerImage: String?, artistPhoto: String?) async throws {
        let rows = try await update(Query("slots").eq("id", id), listingPayload(d, headlinerImage: headlinerImage, artistPhoto: artistPhoto))
        if rows.isEmpty { throw AppError("You can't edit this listing.") }
    }

    // MARK: Places

    /// Changes the signed-in person's location. The public label/nation/area and
    /// (for artists) the private, ~1 km-rounded coordinates are written together.
    func setMyLocation(_ place: Place) async throws {
        try await rpcVoid("set_my_location", [
            "p_label": .string(place.label),
            "p_country": .string(place.country.rawValue),
            "p_region": .optional(place.region),
            "p_lat": .optional(place.coordinate?.lat),
            "p_lon": .optional(place.coordinate?.lon),
            "p_source": .string(place.source.rawValue),
        ])
    }

    /// Adds a venue anywhere in the UK (shown as unverified). Returns its id.
    func createVenue(name: String, address: String, capacity: Int, place: Place) async throws -> String {
        try await rpc("create_venue", [
            "p_name": .string(name), "p_address": .string(address), "p_capacity": .int(capacity),
            "p_label": .string(place.label), "p_country": .string(place.country.rawValue), "p_region": .optional(place.region),
            "p_lat": .optional(place.coordinate?.lat), "p_lon": .optional(place.coordinate?.lon), "p_source": .string(place.source.rawValue),
        ])
    }

    // MARK: Messaging

    func openThread(applicationId: ID) async throws -> ID {
        try await rpc("open_application_thread", ["p_application_id": .string(applicationId)])
    }
    func markThreadRead(id: ID) async throws { try await rpcVoid("mark_thread_read", ["p_thread_id": .string(id)]) }

    struct SentMessage: Decodable { let id: ID; let createdAt: Date }

    /// Sends a message. `clientId` is generated once per message and reused when the
    /// person taps retry, so a send that reached the server but whose answer was lost
    /// can never produce a second copy: the database ignores the repeat and we read
    /// back the one that exists.
    func sendMessage(threadId: ID, senderId: ID, text: String, clientId: String) async throws -> SentMessage {
        try await insertIgnoringDuplicates("messages", [
            "thread_id": .string(threadId), "sender_id": .string(senderId), "text": .string(text), "client_id": .string(clientId),
        ] as Patch, onConflict: "sender_id,client_id")
        let stored: SentMessage? = try await selectOne(Query("messages", "id, created_at").eq("sender_id", senderId).eq("client_id", clientId))
        guard let m = stored else { throw AppError.generic("Couldn't send that message.") }
        return m
    }

    // MARK: Notifications

    func markNotificationRead(id: ID) async throws {
        try await update(Query("notifications").eq("id", id), ["read": true] as Patch)
    }

    func markAllNotificationsRead(profileId: ID) async throws {
        try await update(Query("notifications").eq("profile_id", profileId).eq("read", false), ["read": true] as Patch)
    }

    // MARK: Saved gigs

    /// Saving something already saved is a success, not an error.
    func saveSlot(profileId: ID, slotId: ID) async throws {
        try await insertIgnoringDuplicates("saved_slots", ["profile_id": .string(profileId), "slot_id": .string(slotId)] as Patch, onConflict: "profile_id,slot_id")
    }

    func unsaveSlot(profileId: ID, slotId: ID) async throws {
        try await delete(Query("saved_slots").eq("profile_id", profileId).eq("slot_id", slotId))
    }

    // MARK: Reports and blocking

    @discardableResult
    func submitReport(contextType: String, contextId: ID?, reportedProfileId: ID?, reason: String) async throws -> ID {
        try await rpc("submit_report", [
            "p_context_type": .string(contextType),
            "p_context_id": .optional(contextId),
            "p_reported_profile_id": .optional(reportedProfileId),
            "p_reason": .string(reason),
        ])
    }

    func blockPromoter(artistId: ID, promoterId: ID) async throws {
        try await insertIgnoringDuplicates("promoter_blocks", ["artist_id": .string(artistId), "promoter_id": .string(promoterId)] as Patch, onConflict: "artist_id,promoter_id")
    }

    func unblockPromoter(artistId: ID, promoterId: ID) async throws {
        try await delete(Query("promoter_blocks").eq("artist_id", artistId).eq("promoter_id", promoterId))
    }

    // MARK: Account

    func deleteMyAccount() async throws { try await rpcVoid("delete_my_account") }
    func exportMyData() async throws -> Data { try await rpcRaw("export_my_data") }
    func submitSupportRequest(topic: String, message: String, email: String?) async throws {
        try await rpcVoid("submit_support_request", ["p_topic": .string(topic), "p_message": .string(message), "p_email": .optional(email)])
    }
    func refreshExpiredOffers() async { _ = try? await rpc("refresh_expired_offers", [:], as: Int.self) }
}
