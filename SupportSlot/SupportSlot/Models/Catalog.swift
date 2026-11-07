import Foundation

/// The fixed vocabularies the database enforces with CHECK constraints. (Places are not one of them: any town in the UK is valid — see `Place`.)
enum Catalog {
    static let genres = ["Alternative", "Electronic", "Indie", "Experimental", "Hip-Hop", "Punk", "Folk", "Pop", "R&B", "Techno", "Drum & Bass", "Rock"]
    static let artistSizes = ["emerging", "developing", "established"]
    static let availabilities = ["available", "limited", "unavailable"]

    static func artistSizeLabel(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

    static func availabilityLabel(_ s: String) -> String {
        switch s {
        case "available": return "Available for shows"
        case "limited": return "Limited availability"
        default: return "Not taking shows"
        }
    }

    static let minimumAge = 16
}

enum UserRole: String, Codable, Equatable {
    case artist, promoter
    var title: String { self == .artist ? "Artist" : "Promoter" }
}

enum ApplicationStatus: String, Codable, Equatable {
    case submitted, viewed, shortlisted, offered, confirmed
    case declined          // the promoter said no
    case offerDeclined = "offer_declined" // the artist said no to an offer
    case withdrawn
    case cancelled         // a confirmed booking was cancelled

    /// Still in play (not a dead end).
    var isLive: Bool {
        switch self {
        case .submitted, .viewed, .shortlisted, .offered, .confirmed: return true
        default: return false
        }
    }
}

enum BookingStatus: String, Codable, Equatable {
    case offered, confirmed, declined, withdrawn, cancelled
}

enum SlotStatus: String, Codable, Equatable {
    case open, filled, closed, cancelled
}
