import Foundation

// MARK: - Account fields

enum UsernameRules {
    static let minLength = 3
    static let maxLength = 20

    /// nil when valid, otherwise the message to show.
    static func error(_ username: String) -> String? {
        if username.count < minLength { return "At least \(minLength) characters." }
        if username.count > maxLength { return "At most \(maxLength) characters." }
        if username.range(of: "^[a-zA-Z0-9_]+$", options: .regularExpression) == nil { return "Only letters, numbers and underscores." }
        return nil
    }
}

enum EmailRules {
    static func isValid(_ email: String) -> Bool {
        let e = email.trimmingCharacters(in: .whitespaces)
        return e.count <= 254 && e.range(of: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", options: .regularExpression) != nil
    }
}

struct PasswordStrength: Equatable {
    enum Label: String { case veryWeak = "Very weak", weak = "Weak", fair = "Fair", good = "Good", strong = "Strong" }
    let score: Int // 0...4
    let label: Label
    /// Non-empty while the password doesn't yet meet the minimum bar to submit.
    let blockingIssues: [String]
    var isAcceptable: Bool { blockingIssues.isEmpty }
}

enum PasswordRules {
    static let minLength = 8

    // Not exhaustive (that needs a breach-list service), just enough to stop
    // the most obvious cases that length and variety rules alone wouldn't.
    private static let common: Set<String> = [
        "password", "password1", "password123", "12345678", "123456789",
        "1234567890", "qwerty123", "qwertyuiop", "letmein123", "welcome123",
        "admin1234", "iloveyou1", "111111111", "abc123456", "changeme1",
    ]

    private static func classCount(_ p: String) -> Int {
        var n = 0
        if p.range(of: "[a-z]", options: .regularExpression) != nil { n += 1 }
        if p.range(of: "[A-Z]", options: .regularExpression) != nil { n += 1 }
        if p.range(of: "[0-9]", options: .regularExpression) != nil { n += 1 }
        if p.range(of: "[^a-zA-Z0-9]", options: .regularExpression) != nil { n += 1 }
        return n
    }

    static func evaluate(_ password: String) -> PasswordStrength {
        var issues: [String] = []
        if password.count < minLength { issues.append("At least \(minLength) characters.") }
        let isCommon = common.contains(password.lowercased())
        if isCommon { issues.append("That password is too common — pick something less guessable.") }
        let classes = classCount(password)
        if password.count >= minLength, classes < 2 { issues.append("Mix in at least two of: lowercase, uppercase, numbers, symbols.") }

        var score = 0
        if password.count >= minLength { score = 1 }
        if password.count >= minLength, classes >= 2 { score = 2 }
        if password.count >= minLength, classes >= 3 { score = 3 }
        if password.count >= 12, classes >= 3 { score = 4 }
        if isCommon { score = 0 }
        let labels: [PasswordStrength.Label] = [.veryWeak, .weak, .fair, .good, .strong]
        return PasswordStrength(score: score, label: labels[score], blockingIssues: issues)
    }
}

enum AgeRules {
    /// The latest birth date (YYYY-MM-DD) that makes someone old enough today.
    static func latestBirthDate(today: String = UKDates.today(), minimumAge: Int = Catalog.minimumAge) -> String {
        guard let p = UKDates.parts(today) else { return today }
        // Feb 29 -> Feb 28 in a non-leap target year.
        var day = p.d
        if p.m == 2, p.d == 29, !isLeap(p.y - minimumAge) { day = 28 }
        return String(format: "%04d-%02d-%02d", p.y - minimumAge, p.m, day)
    }

    static func isOldEnough(dob: String, today: String = UKDates.today()) -> Bool {
        UKDates.parts(dob) != nil && dob <= latestBirthDate(today: today)
    }

    private static func isLeap(_ y: Int) -> Bool { (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 }
}

// MARK: - Links

/// A link a person typed into their profile. It is shown to other people and
/// opened from their phone, so only plain http(s) links are ever accepted.
enum SafeLink {
    static func isSafe(_ url: String?) -> Bool {
        guard let url, !url.isEmpty, let comps = URLComponents(string: url),
              let scheme = comps.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = comps.host, host.contains(".") else { return false }
        return true
    }

    static func url(_ s: String?) -> URL? { isSafe(s) ? URL(string: s!) : nil }
}

struct PlatformLink: Equatable, Identifiable {
    enum Platform: String, CaseIterable {
        case spotify, soundcloud, bandcamp, youtube, instagram, tiktok, website
        var label: String {
            switch self {
            case .spotify: return "Spotify"
            case .soundcloud: return "SoundCloud"
            case .bandcamp: return "Bandcamp"
            case .youtube: return "YouTube"
            case .instagram: return "Instagram"
            case .tiktok: return "TikTok"
            case .website: return "Website"
            }
        }
        var isListening: Bool { [.spotify, .soundcloud, .bandcamp, .youtube].contains(self) }
    }
    let platform: Platform
    let url: String
    var id: String { platform.rawValue }
    var label: String { platform.label }
}

struct ArtistLinks: Equatable {
    var spotify = "", soundcloud = "", bandcamp = "", youtube = "", instagram = "", tiktok = "", website = ""

    init() {}
    init(artist: Artist) {
        spotify = artist.spotifyUrl; instagram = artist.instagramUrl; tiktok = artist.tiktokUrl
        soundcloud = artist.soundcloudUrl ?? ""; bandcamp = artist.bandcampUrl ?? ""
        youtube = artist.youtubeUrl ?? ""; website = artist.websiteUrl ?? ""
    }

    func value(_ p: PlatformLink.Platform) -> String {
        switch p {
        case .spotify: return spotify
        case .soundcloud: return soundcloud
        case .bandcamp: return bandcamp
        case .youtube: return youtube
        case .instagram: return instagram
        case .tiktok: return tiktok
        case .website: return website
        }
    }

    mutating func set(_ p: PlatformLink.Platform, _ v: String) {
        switch p {
        case .spotify: spotify = v
        case .soundcloud: soundcloud = v
        case .bandcamp: bandcamp = v
        case .youtube: youtube = v
        case .instagram: instagram = v
        case .tiktok: tiktok = v
        case .website: website = v
        }
    }

    /// Only safe links, in a fixed display order.
    var list: [PlatformLink] {
        PlatformLink.Platform.allCases.compactMap { p in
            let v = value(p).trimmingCharacters(in: .whitespaces)
            return SafeLink.isSafe(v) ? PlatformLink(platform: p, url: v) : nil
        }
    }

    /// The link used for the primary "Listen" call to action.
    var primaryListen: String? { list.first(where: { $0.platform.isListening })?.url }

    /// Problems with the typed values: a non-empty link must be a full https link.
    var errors: [PlatformLink.Platform: String] {
        var out: [PlatformLink.Platform: String] = [:]
        for p in PlatformLink.Platform.allCases {
            let v = value(p).trimmingCharacters(in: .whitespaces)
            if v.isEmpty { continue }
            if v.count > 500 { out[p] = "That link is too long." }
            else if !SafeLink.isSafe(v) { out[p] = "Use a full link starting with https://" }
        }
        return out
    }
}

// MARK: - Profile

enum TrackRules {
    /// nil if the track link is empty or a valid http(s) URL.
    static func urlError(_ url: String) -> String? {
        let v = url.trimmingCharacters(in: .whitespaces)
        if v.isEmpty { return nil }
        if v.count > 500 { return "That link is too long." }
        return SafeLink.isSafe(v) ? nil : "Use a full link starting with https://"
    }

    /// "3:24" -> true. Minutes 0–99, seconds 00–59.
    static func isValidDuration(_ d: String) -> Bool {
        d.trimmingCharacters(in: .whitespaces).range(of: "^\\d{1,2}:[0-5]\\d$", options: .regularExpression) != nil
    }
}

struct ChecklistItem: Equatable, Identifiable {
    let key: String
    let label: String
    let done: Bool
    let hint: String
    var id: String { key }
}

/// What makes an artist profile worth applying with. Every item is something a
/// promoter can actually see on the profile, so "complete" means "a promoter has
/// what they need" — not a made-up score.
enum ProfileChecklist {
    static func items(imageUrl: String?, bio: String, genres: [String], trackCount: Int, links: ArtistLinks) -> [ChecklistItem] {
        let listen = links.list.contains(where: { $0.platform.isListening })
        return [
            ChecklistItem(key: "photo", label: "Profile photo", done: !(imageUrl ?? "").isEmpty, hint: "Promoters recognise a face or a logo."),
            ChecklistItem(key: "bio", label: "A bio of at least 40 characters", done: bio.trimmingCharacters(in: .whitespacesAndNewlines).count >= 40, hint: "Two or three sentences about your sound and live experience."),
            ChecklistItem(key: "genres", label: "At least one genre", done: !genres.isEmpty, hint: "Used to show how well a listing fits you."),
            ChecklistItem(key: "tracks", label: "At least one track", done: trackCount > 0, hint: "You choose one to feature on each application."),
            ChecklistItem(key: "listen", label: "A place to listen", done: listen, hint: "Add a Spotify, SoundCloud, Bandcamp or YouTube link."),
        ]
    }

    static func items(for artist: Artist) -> [ChecklistItem] {
        items(imageUrl: artist.imageUrl, bio: artist.bio, genres: artist.genres, trackCount: artist.tracks.count, links: ArtistLinks(artist: artist))
    }

    static func completion(_ items: [ChecklistItem]) -> (done: Int, total: Int, percent: Int) {
        let done = items.filter(\.done).count
        return (done, items.count, items.isEmpty ? 0 : Int((Double(done) / Double(items.count) * 100).rounded()))
    }
}

// MARK: - Listing form

/// Client-side checks for the listing form. They mirror the rules the database
/// enforces in `slots_guard()` so a person sees "the deadline must be before the
/// show" next to the field instead of after a failed save. The database is
/// still the authority — nothing here is trusted.
struct ListingDraft: Equatable {
    var headliner = ""
    var venueId = ""
    var date = ""            // YYYY-MM-DD
    var doorsTime = "19:00"  // HH:MM
    var setTime = "20:00"
    var performanceLengthMins: Int? = 30
    var expectedAttendance: Int?
    var genres: [String] = []
    var artistSizeFit: [String] = []
    var supportFee: Int?
    var travelContribution: Int? = 0
    var applicationDeadline = ""
    var requirementsText = ""
    var description = ""
    var isUrgent = false
}

enum ListingField: String, Hashable {
    case headliner, venueId, date, doorsTime, setTime, performanceLengthMins, expectedAttendance
    case genres, supportFee, travelContribution, applicationDeadline, requirementsText, description
}

enum ListingRules {
    static func parseRequirements(_ text: String) -> [String] {
        text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    /// - Parameters:
    ///   - today: London calendar date (YYYY-MM-DD).
    ///   - existing: lets an edit keep a date that's already in the past without
    ///     tripping the "in the past" rule on fields the person didn't touch.
    static func validate(_ d: ListingDraft, today: String, existing: (date: String, applicationDeadline: String)? = nil) -> [ListingField: String] {
        var e: [ListingField: String] = [:]

        let headliner = d.headliner.trimmingCharacters(in: .whitespacesAndNewlines)
        if headliner.isEmpty { e[.headliner] = "Enter the headliner or show name." }
        else if headliner.count > 120 { e[.headliner] = "Keep the name to 120 characters or fewer." }

        if d.venueId.isEmpty { e[.venueId] = "Choose a venue." }

        if d.date.isEmpty { e[.date] = "Choose the show date." }
        else if d.date < today, d.date != existing?.date { e[.date] = "The show date can't be in the past." }

        if d.applicationDeadline.isEmpty { e[.applicationDeadline] = "Choose when applications close." }
        else if d.applicationDeadline < today, d.applicationDeadline != existing?.applicationDeadline { e[.applicationDeadline] = "The deadline can't be in the past." }
        else if !d.date.isEmpty, d.applicationDeadline > d.date { e[.applicationDeadline] = "Applications must close on or before the show date." }

        if d.doorsTime.isEmpty { e[.doorsTime] = "Enter the doors time." }
        if d.setTime.isEmpty { e[.setTime] = "Enter the set time." }
        else if !d.doorsTime.isEmpty, d.setTime < d.doorsTime { e[.setTime] = "The set can't start before doors." }

        if let m = d.performanceLengthMins, (5...240).contains(m) {} else { e[.performanceLengthMins] = "Set length must be a whole number of minutes between 5 and 240." }
        if let a = d.expectedAttendance, (1...100_000).contains(a) {} else { e[.expectedAttendance] = "Enter the expected attendance (at least 1)." }
        if d.genres.isEmpty { e[.genres] = "Choose at least one genre." }
        if let f = d.supportFee, (0...100_000).contains(f) {} else { e[.supportFee] = "The support fee must be a whole number of pounds between £0 and £100,000." }
        if let t = d.travelContribution, (0...5_000).contains(t) {} else { e[.travelContribution] = "Travel contribution must be a whole number of pounds between £0 and £5,000." }

        if parseRequirements(d.requirementsText).count > 10 { e[.requirementsText] = "At most 10 requirements." }
        if d.description.count > 2000 { e[.description] = "The description is too long (2,000 characters max)." }
        return e
    }
}
