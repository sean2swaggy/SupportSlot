import Foundation

struct StaffReport: Decodable, Identifiable, Equatable {
    let id: ID
    let contextType: String
    let contextId: ID?
    let reason: String
    let status: String
    let createdAt: Date
    let reporterId: ID?
    let reporterLabel: String?
    let reportedProfileId: ID?
    let reportedLabel: String?
    let resolutionNote: String?
}

// table: support_requests
struct StaffSupportRequest: Decodable, Identifiable, Equatable {
    let id: ID
    let profileId: ID?
    let email: String
    let topic: String
    let message: String
    let status: String
    let createdAt: Date
}

struct StaffUser: Decodable, Identifiable, Equatable {
    let id: ID
    let role: String
    let email: String
    let username: String?
    let createdAt: Date
    let hasOnboarded: Bool
    let suspendedAt: Date?
    let suspensionReason: String?
    let adminRole: String?
}

struct StaffSlot: Decodable, Identifiable, Equatable {
    let id: ID
    let headliner: String
    let city: String
    let date: String
    let status: String
    let promoterId: ID
    let promoterCompany: String
    let applicantCount: Int
}

struct StaffBooking: Decodable, Identifiable, Equatable {
    let id: ID
    let headliner: String
    let artistName: String
    let promoterCompany: String
    let status: String
    let eventDate: String
    let feePence: Int
    let travelPence: Int
    let createdAt: Date
}

// table: admin_audit_log
struct AuditEntry: Decodable, Identifiable, Equatable {
    let id: ID
    let actorRole: String
    let action: String
    let targetType: String
    let targetId: String?
    let createdAt: Date
}
