import SwiftUI

/// First-run setup: username and age check, then the artist or promoter details.
/// The role was chosen at sign-up and can't change. The date of birth is only
/// ever checked on this device — it is never sent anywhere or stored.
struct OnboardingView: View {
    @Environment(AppStore.self) private var store

    @State private var step = 1
    @State private var username = ""
    @State private var usernameStatus: UsernameStatus = .idle
    @State private var dob = ""
    @State private var image: String?
    @State private var name = ""        // artist/band name or company
    @State private var place: Place?
    @State private var genres: [String] = []
    @State private var spotify = ""
    @State private var instagram = ""
    @State private var bio = ""
    @State private var stepError: String?
    @State private var submitError: String?
    @State private var finished = false

    enum UsernameStatus: Equatable { case idle, checking, available, taken, invalid(String) }

    private static let placeMissing = "Choose where you’re based."
    private var role: UserRole { store.role }
    private var totalSteps: Int { role == .artist ? 4 : 3 }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Logo(size: 22).frame(maxWidth: .infinity)
                if finished { done } else {
                    HStack(spacing: 6) {
                        ForEach(1...totalSteps, id: \.self) { i in Rectangle().fill(i <= step ? Theme.acid : Theme.inkBorder).frame(height: 4) }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Step \(step) of \(totalSteps)")
                    stepContent
                    if let stepError { Banner(kind: .error, text: stepError) }
                    if let submitError { Banner(kind: .error, text: submitError) }
                    nav
                    LogOutButton { Label("Log out", systemImage: "rectangle.portrait.and.arrow.right") }
                        .buttonStyle(.app(.outline, compact: true)).frame(maxWidth: .infinity)
                }
            }
            .padding(24)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .task(id: username) { await checkUsername() }
        .onAppear { restoreDraft() }
        .onChange(of: draft) { _, new in
            stepError = nil   // any edit means the old validation message is stale
            if restored, let uid = store.userId { OnboardingDraftStore.save(new, userId: uid) }
        }
        .onChange(of: dob) { _, _ in stepError = nil }
    }

    // MARK: Draft (resume after the app is closed)

    @State private var restored = false
    private var draft: OnboardingDraft {
        OnboardingDraft(step: step, username: username, name: name, place: place, genres: genres, spotify: spotify, instagram: instagram, bio: bio)
    }

    private func restoreDraft() {
        guard !restored, let uid = store.userId else { return }
        if let d = OnboardingDraftStore.load(userId: uid) {
            step = min(max(d.step, 1), totalSteps); username = d.username; name = d.name; place = d.place
            genres = d.genres; spotify = d.spotify; instagram = d.instagram; bio = d.bio
        }
        restored = true
    }

    // MARK: Steps

    @ViewBuilder private var stepContent: some View {
        switch (step, role) {
        case (1, _): accountStep
        case (2, .artist): artistStep
        case (3, .artist): linksStep
        case (4, .artist): bioStep
        case (2, .promoter): promoterStep
        default: promoterFinishStep
        }
    }

    private func heading(_ title: String, _ subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(Theme.display(26)).foregroundStyle(Theme.paper)
            Text(subtitle).dimBody(14)
        }
    }

    private var accountStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            heading("Set up your account", "Choose a username, and confirm you’re at least \(Catalog.minimumAge).")
            LabeledField(label: "Username", error: usernameErrorText, hint: usernameStatus == .available ? nil : "3–20 letters, numbers or underscores.") {
                TextField("", text: $username)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .accessibilityLabel("Username")
                    .fieldStyle(invalid: usernameErrorText != nil)
                    .onChange(of: username) { _, new in username = String(new.trimmingCharacters(in: .whitespaces).prefix(UsernameRules.maxLength)) }
                if usernameStatus == .available { Text("That username is available.").font(Theme.body(13)).foregroundStyle(Theme.ok) }
                if usernameStatus == .checking { Text("Checking…").font(Theme.body(13)).foregroundStyle(Theme.paperDim) }
            }
            LabeledField(label: "Date of birth", error: dob.isEmpty || AgeRules.isOldEnough(dob: dob) ? nil : "You need to be at least \(Catalog.minimumAge) to use Support Slot.",
                         hint: "Used only to check your age. We never store it.") {
                ISODatePicker(title: "Date of birth", iso: $dob, range: nil)
            }
        }
    }

    private var usernameErrorText: String? {
        switch usernameStatus {
        case .invalid(let m): return m
        case .taken: return "That username is taken."
        default: return nil
        }
    }

    private var artistStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            heading("Tell us about your project", "Solo artist or full band — either works.")
            PhotoField(label: "Profile photo", imageUrl: $image, maxDimension: 640)
            LabeledField(label: "Artist / band name") { TextField("Your name", text: $name).fieldStyle() }
            PlaceField(label: "Based in", place: $place, error: stepError == Self.placeMissing ? Self.placeMissing : nil, hint: "Search for your actual town, city or village. You can type it in if search isn’t available.")
            LabeledField(label: "Genres (up to 5)") { ChoiceChips(options: Catalog.genres, selection: $genres, limit: 5) }
        }
    }

    private var linksStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            heading("Link your platforms", "Helps promoters check you out before booking.")
            LabeledField(label: "Spotify artist link", error: SafeLink.isSafe(spotify) || spotify.isEmpty ? nil : "Use a full link starting with https://") {
                TextField("https://open.spotify.com/artist/…", text: $spotify).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().fieldStyle()
            }
            LabeledField(label: "Instagram", error: SafeLink.isSafe(instagram) || instagram.isEmpty ? nil : "Use a full link starting with https://") {
                TextField("https://instagram.com/…", text: $instagram).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().fieldStyle()
            }
            Text("Both are optional. You can add more links later in your profile.").dimBody(13)
        }
    }

    private var bioStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            heading("Add a short bio", "A couple of sentences is plenty.")
            LabeledField(label: "Biography", hint: "\(bio.count)/1000") {
                TextArea(text: $bio, placeholder: "What do you sound like, and what’s your live show like?", minHeight: 140)
            }
        }
    }

    private var promoterStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            heading("Your promoter details", "This appears on every slot you post.")
            PhotoField(label: "Profile photo", imageUrl: $image, maxDimension: 640)
            LabeledField(label: "Company / collective name") { TextField("Your company or collective", text: $name).fieldStyle() }
            PlaceField(label: "Based in", place: $place, error: stepError == Self.placeMissing ? Self.placeMissing : nil, hint: "Search for your actual town, city or village. You can type it in if search isn’t available.")
        }
    }

    private var promoterFinishStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            heading("You’re almost done", "Verification badges are added once we confirm your venue or promotion history.")
            Card { Text("That’s everything. Finish to start using Support Slot.").dimBody(14) }
        }
    }

    // MARK: Navigation

    private var nav: some View {
        HStack(spacing: 12) {
            if step > 1 { Button("Back") { step -= 1; stepError = nil }.buttonStyle(.appOutline) }
            if step < totalSteps {
                Button("Continue") { advance() }.buttonStyle(.appPrimary)
            } else {
                AsyncButton { await finish() } label: { Text("Finish") }
            }
        }
    }

    private func advance() {
        stepError = nil
        switch (step, role) {
        case (1, _):
            if let m = UsernameRules.error(username) { stepError = m; return }
            if usernameStatus == .taken { stepError = "That username is taken."; return }
            if dob.isEmpty { stepError = "Enter your date of birth."; return }
            if !AgeRules.isOldEnough(dob: dob) { stepError = "You need to be at least \(Catalog.minimumAge) to use Support Slot."; return }
        case (2, .artist):
            if name.trimmingCharacters(in: .whitespaces).isEmpty { stepError = "Enter your artist or band name."; return }
            if genres.isEmpty { stepError = "Choose at least one genre."; return }
            if place == nil { stepError = Self.placeMissing; return }
        case (3, .artist):
            if !spotify.isEmpty, !SafeLink.isSafe(spotify) { stepError = "Fix your Spotify link first."; return }
            if !instagram.isEmpty, !SafeLink.isSafe(instagram) { stepError = "Fix your Instagram link first."; return }
        case (2, .promoter):
            if name.trimmingCharacters(in: .whitespaces).isEmpty { stepError = "Enter your company or collective name."; return }
            if place == nil { stepError = Self.placeMissing; return }
        default: break
        }
        step += 1
    }

    private func finish() async {
        submitError = nil
        guard let uid = store.userId else { return }
        guard let place else { submitError = Self.placeMissing; return }
        do {
            if role == .artist {
                try await store.db.completeOnboarding(userId: uid, artist: ArtistOnboarding(
                    username: username, name: name, place: place, genres: genres, spotifyUrl: spotify, instagramUrl: instagram, bio: bio, imageUrl: image))
            } else {
                try await store.db.completeOnboarding(userId: uid, promoter: PromoterOnboarding(username: username, company: name, place: place, avatarUrl: image))
            }
            if let uid = store.userId { OnboardingDraftStore.clear(userId: uid) }
            finished = true
        } catch {
            submitError = (error as? AppError)?.message ?? "Something went wrong — try again."
        }
    }

    private var done: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark").font(.system(size: 28, weight: .bold)).foregroundStyle(Theme.acid)
                .frame(width: 64, height: 64).overlay(Rectangle().stroke(Theme.acid, lineWidth: 1))
            Text(role == .artist ? "Welcome, \(name.isEmpty ? "artist" : name)." : "Welcome, \(name.isEmpty ? "promoter" : name).")
                .font(Theme.display(28)).foregroundStyle(Theme.paper).multilineTextAlignment(.center)
            Text(role == .artist ? "Your profile is set up. Start browsing support slots that fit your sound." : "Your promoter account is ready. Post your first support slot in minutes.")
                .dimBody().multilineTextAlignment(.center)
            AsyncButton { await store.refresh() } label: { Text("Continue") }
        }
        .padding(.top, 30)
    }

    // MARK: Username availability (debounced)

    private func checkUsername() async {
        if username.isEmpty { usernameStatus = .idle; return }
        if let m = UsernameRules.error(username) { usernameStatus = .invalid(m); return }
        try? await Task.sleep(nanoseconds: 400_000_000)
        if Task.isCancelled { return }
        usernameStatus = .checking
        do {
            let free = try await store.db.isUsernameAvailable(username)
            if Task.isCancelled { return }
            usernameStatus = free ? .available : .taken
        } catch {
            if !Task.isCancelled { usernameStatus = .idle }
        }
    }
}
