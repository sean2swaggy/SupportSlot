import Foundation

/// What the person has typed so far during first-run setup, kept on this phone so
/// that closing the app (or a call coming in) doesn't throw it away. Never holds
/// the date of birth (checked on the device and then forgotten), passwords or
/// anything secret; cleared when setup finishes.
struct OnboardingDraft: Codable, Equatable {
    var step = 1
    var username = ""
    var name = ""
    var place: Place?
    var genres: [String] = []
    var spotify = ""
    var instagram = ""
    var bio = ""

    var isEmpty: Bool { self == OnboardingDraft() }
}

enum OnboardingDraftStore {
    private static func key(_ userId: String) -> String { "onboarding.draft.\(userId)" }

    static func save(_ draft: OnboardingDraft, userId: String, defaults: UserDefaults = .standard) {
        if draft.isEmpty { defaults.removeObject(forKey: key(userId)); return }
        if let data = try? JSONEncoder().encode(draft) { defaults.set(data, forKey: key(userId)) }
    }

    static func load(userId: String, defaults: UserDefaults = .standard) -> OnboardingDraft? {
        guard let data = defaults.data(forKey: key(userId)) else { return nil }
        return try? JSONDecoder().decode(OnboardingDraft.self, from: data)
    }

    static func clear(userId: String, defaults: UserDefaults = .standard) { defaults.removeObject(forKey: key(userId)) }
}
