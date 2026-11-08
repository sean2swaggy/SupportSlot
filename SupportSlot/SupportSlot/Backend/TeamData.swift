import Foundation

/// One line of "Build a team": an invitation or a member, as returned by `team_overview()`.
struct TeamRow: Decodable, Identifiable, Equatable {
    let id: ID
    let promoterId: ID          // the owner
    let memberId: ID
    let status: String          // "pending" or "active"
    let invitedAt: Date
    let ownerName: String
    let memberName: String
    let memberEmail: String?    // only the owner is sent this

    var isActive: Bool { status == "active" }
}

extension Database {
    func teamOverview() async throws -> [TeamRow] { try await rpc("team_overview") }

    @discardableResult
    func inviteTeamMember(email: String) async throws -> ID {
        try await rpc("invite_team_member", ["p_email": .string(email)])
    }

    func respondTeamInvite(promoterId: ID, accept: Bool) async throws {
        try await rpcVoid("respond_team_invite", ["p_promoter_id": .string(promoterId), "p_accept": .bool(accept)])
    }

    func removeTeamMember(promoterId: ID, memberId: ID) async throws {
        try await rpcVoid("remove_team_member", ["p_promoter_id": .string(promoterId), "p_member_id": .string(memberId)])
    }
}

/// Plain rules about teams, kept apart so they can be tested.
enum TeamRules {
    static let maxPeople = 5

    /// Whether this person may post and reopen listings without their own Team plan:
    /// the owner of the team they belong to has it.
    static func skipsListingLimit(isTeamMember: Bool) -> Bool { isTeamMember }
}
