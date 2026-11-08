import Foundation

/// The in-app purchases sold by Support Slot. These ids must match App Store Connect.
enum ProductID {
    static let gigDiary = "com.supportslot.app.gigdiary"          // artist, one-time
    static let teamMonthly = "com.supportslot.app.team.monthly"   // promoter, auto-renewing
    static let teamYearly = "com.supportslot.app.team.yearly"     // promoter, auto-renewing
    static let all = [gigDiary, teamMonthly, teamYearly]
    static let team = [teamMonthly, teamYearly]
}

/// What a free promoter can do. Artists never pay to apply, be booked or be seen.
enum PlanRules {
    /// A free promoter can have this many open listings at once.
    static let freeLiveListings = 1

    static func canPostAnother(openListings: Int, hasTeam: Bool) -> Bool {
        hasTeam || openListings < freeLiveListings
    }

    /// Whether a purchase made with `token` counts for the signed-in account `user`.
    /// Purchases are tied to the account they were bought on.
    static func entitlementApplies(token: UUID?, user: UUID?) -> Bool {
        guard let token, let user else { return false }
        return token == user
    }

    /// Active when it hasn't been refunded/revoked and hasn't run out.
    static func isActive(revoked: Bool, expires: Date?, now: Date = Date()) -> Bool {
        if revoked { return false }
        if let expires, expires <= now { return false }
        return true
    }
}
