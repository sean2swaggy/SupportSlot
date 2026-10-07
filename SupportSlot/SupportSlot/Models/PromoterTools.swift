import Foundation

struct PromoterMini: Decodable, Equatable, Hashable { let company: String; let avatarUrl: String? }

// table: artist_roster
/// A promoter's private, saved artist. Never visible to the artist, and it
/// never affects their ranking or eligibility for anything.
struct RosterEntry: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let notes: String
    let tags: [String]
    let addedAt: Date
    let artists: Artist?
    var artist: Artist? { artists }
    static let columns = "id, notes, tags, added_at, artists(\(Artist.listColumns))"
}

// table: event_templates
struct EventTemplate: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let name: String
    let eventName: String
    let venueName: String
    let venueLocation: String
    let proposedFee: Int?
    let currency: String
    let setLengthMins: Int?
    let message: String?
    static let columns = "id, name, event_name, venue_name, venue_location, proposed_fee, currency, set_length_mins, message"
}

// table: availability_requests
/// A pre-booking "are you free" enquiry — never a reservation or a booking.
struct AvailabilityRequest: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let promoterId: ID
    let eventName: String
    let eventDate: String
    let eventTime: String
    let timezone: String
    let venueName: String
    let venueLocation: String
    let proposedFee: Int
    let currency: String
    let setLengthMins: Int
    let responseDeadline: Date
    let message: String?
    let status: String
    let linkedSlotId: ID?
    let createdAt: Date
    let promoters: PromoterMini?
    let availabilityRequestRecipients: [AvailabilityRecipient]?

    static let baseColumns = "id, promoter_id, event_name, event_date, event_time, timezone, venue_name, venue_location, proposed_fee, currency, set_length_mins, response_deadline, message, status, linked_slot_id, created_at"
    /// The promoter's view: every recipient, with their artist and the linked application's status.
    static let withRecipientsColumns = "\(baseColumns), availability_request_recipients(\(AvailabilityRecipient.baseColumns), artists(\(Artist.listColumns)), applications(status))"

    var recipients: [AvailabilityRecipient] { availabilityRequestRecipients ?? [] }
    var isExpired: Bool { AvailabilityRules.isExpired(status: status, deadline: responseDeadline) }
    var label: AvailabilityRules.Label { AvailabilityRules.label(status: status, deadline: responseDeadline) }
}

struct ApplicationStatusRow: Decodable, Equatable, Hashable { let status: String }

// table: availability_request_recipients
struct AvailabilityRecipient: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let requestId: ID
    let artistId: ID
    let response: String
    let respondedAt: Date?
    let questionAsked: Bool
    let threadId: ID?
    let linkedApplicationId: ID?
    let artists: Artist?
    let applications: ApplicationStatusRow?
    let availabilityRequests: AvailabilityRequest?

    static let baseColumns = "id, request_id, artist_id, response, responded_at, question_asked, thread_id, linked_application_id"
    /// The artist's view: their own response, with the request and who sent it.
    static let forArtistColumns = "\(baseColumns), availability_requests(\(AvailabilityRequest.baseColumns), promoters(company, avatar_url))"
}

// table: gig_invitations
/// A promoter inviting one artist to apply for one of their own open gigs.
/// Accepting creates a real application; this never books anything by itself.
struct GigInvitation: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let slotId: ID
    let promoterId: ID
    let artistId: ID
    let message: String?
    let status: String
    let linkedApplicationId: ID?
    let createdAt: Date
    let respondedAt: Date?
    let slots: Slot?
    let promoters: PromoterMini?
    let artists: Artist?

    static let baseColumns = "id, slot_id, promoter_id, artist_id, message, status, linked_application_id, created_at, responded_at"
    static let forArtistColumns = "\(baseColumns), slots(\(Slot.columns)), promoters(company, avatar_url)"
    static let forPromoterColumns = "\(baseColumns), artists(\(Artist.listColumns))"
}

enum AvailabilityRules {
    static let maxRecipients = 50

    /// nil when valid.
    static func recipientsError(_ ids: [String]) -> String? {
        if ids.isEmpty { return "Select at least one artist from your roster." }
        if ids.count > maxRecipients { return "Send to at most \(maxRecipients) artists at a time." }
        return nil
    }

    /// A request is only "expired" while it is still nominally open — once a
    /// promoter withdraws it or marks it filled, that status wins instead.
    static func isExpired(status: String, deadline: Date, now: Date = Date()) -> Bool { status == "sent" && deadline < now }

    enum Label: String { case withdrawn = "Withdrawn", filled = "Filled", expired = "Expired", open = "Open" }

    static func label(status: String, deadline: Date, now: Date = Date()) -> Label {
        if status == "withdrawn" { return .withdrawn }
        if status == "filled" { return .filled }
        if isExpired(status: status, deadline: deadline, now: now) { return .expired }
        return .open
    }
}
