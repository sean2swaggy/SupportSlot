import Foundation

// Staff tools. Each function checks the caller's role in SQL (moderator or
// admin) and writes an audit row itself; the app only offers what the role
// allows, and a normal account calling any of these is refused by the database.

extension Database {
    func staffReports(status: String) async throws -> [StaffReport] {
        try await rpc("staff_open_reports", ["p_status": .string(status), "p_limit": .int(50)])
    }
    func updateReport(id: ID, status: String, note: String?) async throws {
        try await rpcVoid("admin_update_report", ["p_report_id": .string(id), "p_status": .string(status), "p_note": .optional(note)])
    }

    func staffSupportRequests(status: String) async throws -> [StaffSupportRequest] {
        try await rpc("staff_support_requests", ["p_status": .string(status), "p_limit": .int(50)])
    }
    func updateSupportRequest(id: ID, status: String, note: String?) async throws {
        try await rpcVoid("admin_update_support_request", ["p_id": .string(id), "p_status": .string(status), "p_note": .optional(note)])
    }

    func staffUsers(query: String) async throws -> [StaffUser] {
        try await rpc("staff_find_users", ["p_q": .string(query), "p_limit": .int(25)])
    }
    func suspendUser(id: ID, reason: String) async throws { try await rpcVoid("admin_suspend_user", ["p_profile_id": .string(id), "p_reason": .string(reason)]) }
    func unsuspendUser(id: ID) async throws { try await rpcVoid("admin_unsuspend_user", ["p_profile_id": .string(id)]) }
    func setVerification(profileId: ID, verified: Bool) async throws {
        try await rpcVoid("admin_set_verification", ["p_profile_id": .string(profileId), "p_verified": .bool(verified)])
    }

    func staffListings(query: String) async throws -> [StaffSlot] {
        try await rpc("staff_recent_slots", ["p_q": query.isEmpty ? .null : .string(query), "p_limit": .int(50)])
    }
    func removeListing(id: ID, reason: String) async throws { try await rpcVoid("admin_remove_listing", ["p_slot_id": .string(id), "p_reason": .string(reason)]) }

    func staffBookings() async throws -> [StaffBooking] { try await rpc("admin_recent_bookings", ["p_limit": .int(100)]) }
    func staffAudit() async throws -> [AuditEntry] { try await rpc("staff_audit_log", ["p_limit": .int(100)]) }
}
