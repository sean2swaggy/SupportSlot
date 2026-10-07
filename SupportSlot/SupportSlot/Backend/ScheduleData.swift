import Foundation

// Show schedule reads and writes. Every table is private to the owning
// promoter (row-level security on every operation, including select). Every
// write first claims the next version through `claim_schedule_version`, so two
// people editing at once can't silently overwrite each other.

struct ScheduleStale: Error {}

extension Database {
    func showSchedule(slotId: ID) async throws -> ShowSchedule? {
        try await selectOne(Query("show_schedules", ShowSchedule.columns).eq("slot_id", slotId))
    }

    func scheduleEntries(scheduleId: ID) async throws -> [ScheduleEntry] {
        try await select(Query("schedule_entries", ScheduleEntry.columns).eq("schedule_id", scheduleId))
    }

    /// First visit: reuse the promoter's schedule or start an empty draft. Two near-simultaneous
    /// first visits can both try to create it (slot_id is unique); the loser just re-reads.
    func schedule(slotId: ID, promoterId: ID) async throws -> ShowSchedule? {
        if let existing = try await showSchedule(slotId: slotId) { return existing }
        do {
            let rows: [ShowSchedule] = try await insert("show_schedules", ["slot_id": .string(slotId), "promoter_id": .string(promoterId)] as Patch, returning: ShowSchedule.columns)
            if let row = rows.first { return row }
        } catch let e as AppError where e.isDuplicate {}
        return try await showSchedule(slotId: slotId)
    }

    /// Claims the next version; throws `ScheduleStale` if someone else edited first.
    private func claim(_ scheduleId: ID, expected: Int) async throws -> Int {
        do {
            return try await rpc("claim_schedule_version", ["p_schedule_id": .string(scheduleId), "p_expected_version": .int(expected)])
        } catch let e as AppError {
            if e.code == "stale_schedule_version" || e.message.contains("stale_schedule_version") { throw ScheduleStale() }
            throw e
        }
    }

    private func payload(_ d: ScheduleEntryDraft) -> Patch {
        [
            "kind": .string(d.kind.rawValue), "title": .string(d.title.trimmingCharacters(in: .whitespacesAndNewlines)), "stage": .string(d.stage),
            "start_at": .string(d.startAt), "end_at": .string(d.endAt), "artist_id": .optional(d.artistId), "notes": .string(d.notes), "sort_order": .int(d.sortOrder),
        ]
    }

    func addScheduleEntry(scheduleId: ID, version: Int, _ d: ScheduleEntryDraft) async throws -> Int {
        let v = try await claim(scheduleId, expected: version)
        var p = payload(d); p["schedule_id"] = .string(scheduleId)
        try await insert("schedule_entries", p)
        return v
    }

    func updateScheduleEntry(scheduleId: ID, version: Int, entryId: ID, _ d: ScheduleEntryDraft) async throws -> Int {
        let v = try await claim(scheduleId, expected: version)
        try await update(Query("schedule_entries").eq("id", entryId), payload(d))
        return v
    }

    func deleteScheduleEntry(scheduleId: ID, version: Int, entryId: ID) async throws -> Int {
        let v = try await claim(scheduleId, expected: version)
        try await delete(Query("schedule_entries").eq("id", entryId))
        return v
    }

    /// Writes only sort_order, so reordering can never silently change an entry's time.
    func reorderScheduleEntries(scheduleId: ID, version: Int, pairs: [(id: ID, sortOrder: Int)]) async throws -> Int {
        let v = try await claim(scheduleId, expected: version)
        for p in pairs { try await update(Query("schedule_entries").eq("id", p.id), ["sort_order": .int(p.sortOrder)] as Patch) }
        return v
    }

    /// "Final" is an internal planning label only — it never notifies an artist or touches a booking.
    func setScheduleStatus(scheduleId: ID, version: Int, status: String) async throws -> Int {
        let v = try await claim(scheduleId, expected: version)
        try await update(Query("show_schedules").eq("id", scheduleId), ["status": .string(status)] as Patch)
        return v
    }

    func applyScheduleTemplate(scheduleId: ID, version: Int, entries: [ScheduleEntryDraft]) async throws -> Int {
        let v = try await claim(scheduleId, expected: version)
        if entries.isEmpty { return v }
        try await insert("schedule_entries", entries.map { e -> Patch in var p = payload(e); p["schedule_id"] = .string(scheduleId); p.removeValue(forKey: "artist_id"); p["notes"] = ""; return p })
        return v
    }

    /// Artists with a confirmed booking for this slot — the only source for "assigned artist".
    func confirmedArtists(slotId: ID) async throws -> [Artist] {
        let rows: [Application] = try await select(Query("applications", "id, slot_id, artist_id, status, featured_track_id, message, submitted_at, status_changed_at, viewed_at, closed_reason, artists(\(Artist.listColumns))").eq("slot_id", slotId).eq("status", "confirmed"))
        return rows.compactMap(\.artist)
    }

    /// Artists whose booking for this slot was cancelled, so entries still assigned to them can be flagged.
    func cancelledArtistIDs(slotId: ID) async throws -> Set<ID> {
        struct Row: Decodable { let artistId: ID }
        return Set(try await select(Query("applications", "artist_id").eq("slot_id", slotId).eq("status", "cancelled"), as: Row.self).map(\.artistId))
    }

    func scheduleTemplates(promoterId: ID) async throws -> [ScheduleTemplate] {
        try await select(Query("schedule_templates", ScheduleTemplate.columns).eq("promoter_id", promoterId).order("created_at", ascending: false))
    }

    func saveScheduleTemplate(promoterId: ID, name: String, entries: [(kind: String, title: String, stage: String, offsetMinutes: Int, durationMinutes: Int, sortOrder: Int)]) async throws {
        let rows: [IDRow] = try await insert("schedule_templates", ["promoter_id": .string(promoterId), "name": .string(name)] as Patch, returning: "id")
        guard let id = rows.first?.id else { throw AppError.generic("Couldn’t save that template.") }
        if entries.isEmpty { return }
        try await insert("schedule_template_entries", entries.map { e -> Patch in
            ["template_id": .string(id), "kind": .string(e.kind), "title": .string(e.title), "stage": .string(e.stage),
             "offset_minutes": .int(e.offsetMinutes), "duration_minutes": .int(e.durationMinutes), "sort_order": .int(e.sortOrder)]
        })
    }

    func deleteScheduleTemplate(id: ID) async throws { try await delete(Query("schedule_templates").eq("id", id)) }
}
