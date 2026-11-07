import Foundation

typealias ID = String

// Each model lists the exact columns it reads (`columns`). tests/db/query-contract
// checks every one of them against the real schema, so a renamed column fails a
// test instead of failing in someone's hands.

// MARK: - Profiles

// table: profiles
struct Profile: Decodable, Equatable {
    let id: ID
    let role: String
    let email: String
    let hasOnboarded: Bool
    let username: String?
    let suspendedAt: Date?
    let suspensionReason: String?
    let adminRole: String?
    let notifyAvailabilityRequests: Bool

    static let columns = "id, role, email, has_onboarded, username, suspended_at, suspension_reason, admin_role, notify_availability_requests"

    var userRole: UserRole { UserRole(rawValue: role) ?? .artist }
    var isSuspended: Bool { suspendedAt != nil }
    var isStaff: Bool { adminRole != nil }
    var isAdmin: Bool { adminRole == "admin" }
}

/// `my_account_status()`: the first thing asked once the session is aal2. Works for a suspended account.
struct AccountStatus: Decodable, Equatable {
    let role: String
    let hasOnboarded: Bool
    let suspended: Bool
    let suspensionReason: String?
    let adminRole: String?
}

// table: artist_tracks
struct Track: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let title: String
    let duration: String
    let coverImageUrl: String?
    let url: String?
    let sortOrder: Int

    static let columns = "id, title, duration, cover_image_url, url, sort_order"
}

// table: artist_shows
struct PastShow: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let kind: String
    let headliner: String
    let venue: String
    let city: String
    let date: String

    static let columns = "id, kind, headliner, venue, city, date"
}

// table: artists
struct Artist: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let handle: String
    let name: String
    let imageUrl: String?
    let bannerImageUrl: String?
    let location: String
    let locationCountry: String
    let locationRegion: String?
    let genres: [String]
    let spotifyUrl: String
    let instagramUrl: String
    let tiktokUrl: String
    let soundcloudUrl: String?
    let bandcampUrl: String?
    let youtubeUrl: String?
    let websiteUrl: String?
    let monthlyListeners: Int?
    let bio: String
    let liveVideoThumbnailUrl: String?
    let liveVideoUrl: String?
    let availability: String
    let travelRadiusMiles: Int
    let verification: String
    let artistSize: String
    let lastMinuteAlerts: Bool
    let memberSince: Date
    // Optional embedded children (`artist_tracks(...)`, `artist_shows(...)`).
    let artistTracks: [Track]?
    let artistShows: [PastShow]?

    static let baseColumns = "id, handle, name, image_url, banner_image_url, location, location_country, location_region, genres, spotify_url, instagram_url, tiktok_url, soundcloud_url, bandcamp_url, youtube_url, website_url, monthly_listeners, bio, live_video_thumbnail_url, live_video_url, availability, travel_radius_miles, verification, artist_size, last_minute_alerts, member_since"
    /// For lists and cards: no banner or video thumbnail (they can be large data URLs) and no children.
    static let listColumns = "id, handle, name, image_url, location, location_country, location_region, genres, spotify_url, instagram_url, tiktok_url, soundcloud_url, bandcamp_url, youtube_url, website_url, monthly_listeners, bio, live_video_url, availability, travel_radius_miles, verification, artist_size, last_minute_alerts, member_since"
    /// A list row that also carries the artist's tracks (for "featured track" lookups).
    static let listWithTracksColumns = "\(listColumns), artist_tracks(\(Track.columns))"
    /// Artist plus tracks and past shows in a single request.
    static let columns = "\(baseColumns), artist_tracks(\(Track.columns)), artist_shows(\(PastShow.columns))"

    var tracks: [Track] { (artistTracks ?? []).sorted { $0.sortOrder < $1.sortOrder } }
    var pastShows: [PastShow] { (artistShows ?? []).filter { $0.kind == "past" }.sorted { $0.date > $1.date } }
    var upcomingShows: [PastShow] { (artistShows ?? []).filter { $0.kind == "upcoming" }.sorted { $0.date < $1.date } }
    var isVerified: Bool { verification == "verified" }
}

// table: promoters
struct Promoter: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let name: String
    let company: String
    let avatarUrl: String?
    let location: String?
    let locationCountry: String?
    let locationRegion: String?
    let verification: String
    let showsPosted: Int

    static let columns = "id, name, company, avatar_url, location, location_country, location_region, verification, shows_posted"
    var isVerified: Bool { verification == "verified" }
}

// table: venues
struct Venue: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let name: String
    let city: String
    let capacity: Int
    let address: String
    let imageUrl: String?
    let verification: String
    let country: String
    let region: String?
    let lat: Double?
    let lon: Double?

    static let columns = "id, name, city, capacity, address, image_url, verification, country, region, lat, lon"
    var isVerified: Bool { verification == "verified" }
}

// MARK: - Listings

// table: slots
struct Slot: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let promoterId: ID
    let venueId: String
    let headliner: String
    let headlinerImageUrl: String?
    let artistPhotoUrl: String?
    let city: String
    let country: String
    let region: String?
    let lat: Double?
    let lon: Double?
    let date: String
    let doorsTime: String
    let setTime: String
    let performanceLengthMins: Int
    let genres: [String]
    let expectedAttendance: Int
    let supportFee: Int
    let travelContribution: Int
    let requirements: [String]
    let applicationDeadline: String
    let applicantCount: Int
    let isUrgent: Bool
    let status: String
    let artistSizeFit: [String]
    let description: String
    let rescheduledAt: Date?
    let postedAt: Date
    let venues: Venue?

    static let baseColumns = "id, promoter_id, venue_id, headliner, headliner_image_url, artist_photo_url, city, country, region, lat, lon, date, doors_time, set_time, performance_length_mins, genres, expected_attendance, support_fee, travel_contribution, requirements, application_deadline, applicant_count, is_urgent, status, artist_size_fit, description, rescheduled_at, posted_at"
    /// Includes the venue so a list of cards doesn't need a request per card.
    static let columns = "\(baseColumns), venues(\(Venue.columns))"

    var venue: Venue? { venues }
    var slotStatus: SlotStatus { SlotStatus(rawValue: status) ?? .closed }
    var doors: String { String(doorsTime.prefix(5)) }
    var onStage: String { String(setTime.prefix(5)) }
}

// table: applications
struct Application: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let slotId: ID
    let artistId: ID
    let status: String
    let featuredTrackId: ID?
    let message: String?
    let submittedAt: Date
    let statusChangedAt: Date
    let viewedAt: Date?
    let closedReason: String?
    // Optional embeds.
    let artists: Artist?
    let slots: Slot?

    static let baseColumns = "id, slot_id, artist_id, status, featured_track_id, message, submitted_at, status_changed_at, viewed_at, closed_reason"
    /// An artist's own applications, each with its listing (and venue).
    static let withSlotColumns = "\(baseColumns), slots(\(Slot.columns))"
    /// A promoter's applicants, each with the applying artist (light version plus tracks).
    static let withArtistColumns = "\(baseColumns), artists(\(Artist.listWithTracksColumns))"

    var applicationStatus: ApplicationStatus { ApplicationStatus(rawValue: status) ?? .declined }
    var artist: Artist? { artists }
    var slot: Slot? { slots }
}

// table: bookings
/// The agreed terms of an offer / confirmed booking — a snapshot taken when the
/// offer was made, so a later edit to the listing can never change what the
/// artist agreed to. Money is integer pence. The app handles no payment.
struct Booking: Decodable, Identifiable, Equatable, Hashable {
    let id: ID
    let applicationId: ID?
    let slotId: ID?
    let artistId: ID?
    let promoterId: ID?
    let status: String
    let artistName: String
    let promoterCompany: String
    let headliner: String
    let venueName: String
    let venueAddress: String
    let venueCity: String
    let eventDate: String
    let doorsTime: String
    let setTime: String
    let setLengthMins: Int
    let requirements: [String]
    let feePence: Int
    let travelPence: Int
    let offerMessage: String?
    let offeredAt: Date
    let offerExpiresAt: Date
    let confirmedAt: Date?
    let cancelledAt: Date?
    let cancelReason: String?
    let declineReason: String?

    static let columns = "id, application_id, slot_id, artist_id, promoter_id, status, artist_name, promoter_company, headliner, venue_name, venue_address, venue_city, event_date, doors_time, set_time, set_length_mins, requirements, fee_pence, travel_pence, offer_message, offered_at, offer_expires_at, confirmed_at, cancelled_at, cancel_reason, decline_reason"

    var bookingStatus: BookingStatus { BookingStatus(rawValue: status) ?? .withdrawn }
    var totalPence: Int { feePence + travelPence }
}

// table: notifications
struct AppNotification: Decodable, Identifiable, Equatable {
    let id: ID
    let type: String
    let text: String
    let href: String?
    let read: Bool
    let createdAt: Date

    static let columns = "id, type, text, href, read, created_at"
}

// table: saved_slots
struct SavedSlot: Decodable, Equatable {
    let slotId: ID
    static let columns = "slot_id"
}

// MARK: - Search

struct SlotSearch: Equatable {
    var q = ""
    var country: String?
    var genre: String?
    var from: String?
    var to: String?
    var minFee: Int?
    var venueSize: String?   // intimate | mid | large
    var artistSize: String?
    var near: Coordinate?    // radius search: the centre…
    var maxMiles: Int?       // …and how far (straight-line miles)
    var urgentOnly = false
    var sort = "date"        // date | fee | newest | distance
    var page = 1
    var pageSize = 12
}

struct SlotSearchResult: Equatable {
    let slots: [Slot]
    /// Straight-line miles from the search centre, by listing id (only when a centre was given and the listing has coordinates).
    var distances: [ID: Double] = [:]
    let total: Int
    let page: Int
    let pageSize: Int
    var hasMore: Bool { page * pageSize < total }
}

struct SearchHit: Decodable { let id: ID; let totalCount: Int; let distanceMiles: Double? }
struct ArtistSearchHit: Decodable { let id: ID; let totalCount: Int; let distanceMiles: Int? }

// table: artist_locations
/// The signed-in artist's own private, ~1 km-rounded coordinates. Nobody else can read this row.
struct ArtistLocationRow: Decodable, Equatable {
    let lat: Double
    let lon: Double
    static let columns = "lat, lon"
    var coordinate: Coordinate { Coordinate(lat: lat, lon: lon) }
}
