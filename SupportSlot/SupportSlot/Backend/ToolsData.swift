import Foundation

// Roster, templates, availability requests and invitations.
// Row-level security makes each of these private to its owner (and, for
// requests and invitations, to the artist they were sent to).

extension Database {
    // MARK: Roster

    func roster(promoterId: ID) async throws -> [RosterEntry] {
        try await select(Query("artist_roster", RosterEntry.columns).eq("promoter_id", promoterId).order("added_at", ascending: false))
    }

    func rosterArtistIDs(promoterId: ID) async throws -> Set<ID> {
        struct Row: Decodable { let artistId: ID }
        return Set(try await select(Query("artist_roster", "artist_id").eq("promoter_id", promoterId), as: Row.self).map(\.artistId))
    }

    func addToRoster(promoterId: ID, artistId: ID) async throws {
        do { try await insert("artist_roster", ["promoter_id": .string(promoterId), "artist_id": .string(artistId)] as Patch) }
        catch let e as AppError where e.isDuplicate { throw AppError("Already on your roster.") }
    }

    func removeFromRoster(entryId: ID) async throws { try await delete(Query("artist_roster").eq("id", entryId)) }

    func updateRosterEntry(entryId: ID, notes: String, tags: [String]) async throws {
        let rows = try await update(Query("artist_roster").eq("id", entryId), ["notes": .string(notes), "tags": .strings(tags)] as Patch)
        if rows.isEmpty { throw AppError("Couldn’t save that.") }
    }

    /// The promoter's own history with one artist: the applications that artist made to their listings.
    func history(withArtist artistId: ID) async throws -> [Application] {
        try await select(Query("applications", Application.withSlotColumns).eq("artist_id", artistId).order("submitted_at", ascending: false))
    }

    // MARK: Templates

    func templates(promoterId: ID) async throws -> [EventTemplate] {
        try await select(Query("event_templates", EventTemplate.columns).eq("promoter_id", promoterId).order("created_at", ascending: false))
    }

    func createTemplate(promoterId: ID, name: String, eventName: String, venueName: String, venueLocation: String, proposedFee: Int?, currency: String, setLengthMins: Int?, message: String?) async throws {
        try await insert("event_templates", [
            "promoter_id": .string(promoterId), "name": .string(name), "event_name": .string(eventName), "venue_name": .string(venueName),
            "venue_location": .string(venueLocation), "proposed_fee": .optional(proposedFee), "currency": .string(currency),
            "set_length_mins": .optional(setLengthMins), "message": .optional(message),
        ] as Patch)
    }

    func deleteTemplate(id: ID) async throws { try await delete(Query("event_templates").eq("id", id)) }

    // MARK: Availability requests

    struct NewAvailabilityRequest {
        var eventName = "", eventDate = "", eventTime = "20:00", timezone = "Europe/London"
        var venueName = "", venueLocation = ""
        var proposedFee = 0, currency = "GBP", setLengthMins = 30
        var responseDeadline = Date().addingTimeInterval(3 * 86_400)
        var message = ""
        var artistIds: [ID] = []
    }

    func createAvailabilityRequest(promoterId: ID, _ r: NewAvailabilityRequest) async throws {
        if let problem = AvailabilityRules.recipientsError(r.artistIds) { throw AppError(problem) }
        let text = r.message.trimmingCharacters(in: .whitespacesAndNewlines)
        let rows: [IDRow] = try await insert("availability_requests", [
            "promoter_id": .string(promoterId), "event_name": .string(r.eventName), "event_date": .string(r.eventDate), "event_time": .string(r.eventTime),
            "timezone": .string(r.timezone), "venue_name": .string(r.venueName), "venue_location": .string(r.venueLocation),
            "proposed_fee": .int(r.proposedFee), "currency": .string(r.currency), "set_length_mins": .int(r.setLengthMins),
            "response_deadline": .string(JSONCoding.formatTimestamp(r.responseDeadline)), "message": .optional(text.isEmpty ? nil : text),
        ] as Patch, returning: "id")
        guard let id = rows.first?.id else { throw AppError.generic("Couldn’t create the request.") }
        do {
            try await insert("availability_request_recipients", r.artistIds.map { ["request_id": .string(id), "artist_id": .string($0)] as Patch })
        } catch {
            // Don't leave an empty request with no recipients behind.
            _ = try? await delete(Query("availability_requests").eq("id", id))
            throw error
        }
    }

    func availabilityRequests(promoterId: ID) async throws -> [AvailabilityRequest] {
        try await select(Query("availability_requests", AvailabilityRequest.withRecipientsColumns).eq("promoter_id", promoterId).order("created_at", ascending: false))
    }

    func setRequestStatus(id: ID, status: String) async throws {
        let rows = try await update(Query("availability_requests").eq("id", id), ["status": .string(status)] as Patch)
        if rows.isEmpty { throw AppError("Couldn’t update that request.") }
    }

    func linkRequest(id: ID, toSlot slotId: ID) async throws {
        try await update(Query("availability_requests").eq("id", id), ["linked_slot_id": .string(slotId)] as Patch)
    }

    // Artist side

    func availabilityRequests(forArtist artistId: ID) async throws -> [AvailabilityRecipient] {
        try await select(Query("availability_request_recipients", AvailabilityRecipient.forArtistColumns).eq("artist_id", artistId))
    }

    func respondToAvailability(recipientId: ID, response: String) async throws {
        let rows = try await update(Query("availability_request_recipients").eq("id", recipientId),
                                    ["response": .string(response), "responded_at": .string(JSONCoding.formatTimestamp(Date()))] as Patch)
        if rows.isEmpty { throw AppError("This request is no longer open for replies.") }
    }

    /// "Ask a question" reuses the conversation system: finds or creates the thread for this request.
    func startAvailabilityQuestion(recipientId: ID, artistId: ID, promoterId: ID, requestId: ID) async throws -> ID {
        let context = "availability-request:\(requestId)"
        if let existing: IDRow = try await selectOne(Query("message_threads", "id").eq("artist_id", artistId).eq("promoter_id", promoterId).eq("context", context)) {
            try await markQuestionAsked(recipientId: recipientId, threadId: existing.id)
            return existing.id
        }
        let rows: [IDRow] = try await insert("message_threads", ["artist_id": .string(artistId), "promoter_id": .string(promoterId), "context": .string(context)] as Patch, returning: "id")
        guard let id = rows.first?.id else { throw AppError.generic("Couldn’t start a conversation.") }
        try await markQuestionAsked(recipientId: recipientId, threadId: id)
        return id
    }

    private func markQuestionAsked(recipientId: ID, threadId: ID) async throws {
        try await update(Query("availability_request_recipients").eq("id", recipientId), ["question_asked": true, "thread_id": .string(threadId)] as Patch)
    }

    // MARK: Gig invitations

    func createInvitation(slotId: ID, promoterId: ID, artistId: ID, message: String?) async throws {
        let text = message?.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await insert("gig_invitations", ["slot_id": .string(slotId), "promoter_id": .string(promoterId), "artist_id": .string(artistId), "message": .optional(text?.isEmpty == true ? nil : text)] as Patch)
        } catch let e as AppError where e.isDuplicate { throw AppError("You’ve already invited this artist to this gig.") }
    }

    func invitedArtistIDs(slotId: ID) async throws -> Set<ID> {
        struct Row: Decodable { let artistId: ID }
        return Set(try await select(Query("gig_invitations", "artist_id").eq("slot_id", slotId).in("status", ["pending", "accepted"]), as: Row.self).map(\.artistId))
    }

    func invitations(forArtist artistId: ID) async throws -> [GigInvitation] {
        try await select(Query("gig_invitations", GigInvitation.forArtistColumns).eq("artist_id", artistId).order("created_at", ascending: false))
    }

    func invitations(forSlot slotId: ID) async throws -> [GigInvitation] {
        try await select(Query("gig_invitations", GigInvitation.forPromoterColumns).eq("slot_id", slotId).order("created_at", ascending: false))
    }

    /// Accepting creates a real application, exactly as if the artist had applied themselves.
    func respondToInvitation(_ inv: GigInvitation, artistId: ID, accept: Bool) async throws {
        var linked: ID?
        if accept {
            if let existing: IDRow = try await selectOne(Query("applications", "id").eq("slot_id", inv.slotId).eq("artist_id", artistId)) {
                linked = existing.id
            } else {
                let rows: [IDRow] = try await insert("applications", ["slot_id": .string(inv.slotId), "artist_id": .string(artistId), "status": "submitted", "message": "Applied via promoter invitation."] as Patch, returning: "id")
                linked = rows.first?.id
            }
        }
        var patch: Patch = ["status": .string(accept ? "accepted" : "declined"), "responded_at": .string(JSONCoding.formatTimestamp(Date()))]
        if let linked { patch["linked_application_id"] = .string(linked) }
        let rows = try await update(Query("gig_invitations").eq("id", inv.id), patch)
        if rows.isEmpty { throw AppError("This invitation is no longer available.") }
    }

    func withdrawInvitation(id: ID) async throws {
        let rows = try await update(Query("gig_invitations").eq("id", id), ["status": "withdrawn"] as Patch)
        if rows.isEmpty { throw AppError("Couldn’t withdraw that invitation.") }
    }
}
