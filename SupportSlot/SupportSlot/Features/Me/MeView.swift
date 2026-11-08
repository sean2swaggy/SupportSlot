import SwiftUI

/// The "Me" tab: your profile, your preferences, help and the staff tools.
struct MeView: View {
    @Environment(AppStore.self) private var store
    @State private var alertsError: String?
    @State private var alertsOn: Bool?        // what the switch shows while a change is being saved
    @State private var savingAlerts = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                if store.role == .artist { artistSection } else { promoterSection }
                common
            }
            .padding(20)
        }
        .refreshable { await store.refresh() }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { NotificationsButton() } }
    }

    private var header: some View {
        HStack(spacing: 14) {
            Avatar(imageUrl: store.ownImage, name: store.displayName, size: 72)
            VStack(alignment: .leading, spacing: 6) {
                Text(store.displayName).font(Theme.display(24)).foregroundStyle(Theme.paper).lineLimit(2)
                HStack(spacing: 8) { Tag(store.role.title, tint: Theme.acid); if (store.artist?.isVerified ?? store.promoter?.isVerified) == true { VerifiedBadge() } }
                if let u = store.profile?.username { Text("@\(u)").font(Theme.mono(12)).foregroundStyle(Theme.paperDim) }
            }
        }
    }

    // MARK: Artist

    @ViewBuilder private var artistSection: some View {
        if let artist = store.artist {
            let c = ProfileChecklist.completion(ProfileChecklist.items(for: artist))
            row("Edit your profile", detail: "\(c.done)/\(c.total) done", icon: "person.crop.square") { ProfileEditorView() }
            row("Your public page", detail: "How promoters see you", icon: "eye") { ArtistProfileView(handle: artist.handle, preloaded: artist) }
            row("Gig diary", detail: "A private log of your shows", icon: "book.closed") { GigDiaryView() }
            row("Saved searches", detail: "Get told about matching slots", icon: "bell.badge") { SavedSearchesView() }
            Card {
                let isOn = alertsOn ?? artist.lastMinuteAlerts
                // The whole row is the button (the switch itself is only a picture of the state),
                // so tapping the words works as well as tapping the switch.
                Button { Task { await setAlerts(!isOn, artist) } } label: {
                    HStack(alignment: .center, spacing: 14) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Last-minute alerts").font(Theme.body(15, weight: .medium)).foregroundStyle(Theme.paper)
                            Text("Tell me when a promoter within my travel radius needs a support act at short notice.").font(Theme.body(12)).foregroundStyle(Theme.paperDim)
                                .multilineTextAlignment(.leading)
                        }
                        Spacer(minLength: 8)
                        Toggle("", isOn: .constant(isOn)).labelsHidden().tint(Theme.acid)
                            .allowsHitTesting(false).accessibilityHidden(true)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(savingAlerts)
                .accessibilityLabel("Last-minute alerts")
                .accessibilityValue(isOn ? "On" : "Off")
                .accessibilityAddTraits(.isToggle)
                FieldError(message: alertsError)
            }
        }
        row("Requests & invitations", detail: "From promoters", icon: "calendar.badge.questionmark") { ArtistRequestsView() }
    }

    private func setAlerts(_ v: Bool, _ artist: Artist) async {
        alertsError = nil
        alertsOn = v            // show the new state at once, not after the round trip
        savingAlerts = true
        defer { savingAlerts = false; alertsOn = nil } // afterwards the server's answer is what is shown
        do { try await store.perform { try await store.db.setLastMinuteAlerts(id: artist.id, enabled: v) } }
        catch { alertsError = (error as? AppError)?.message ?? "That setting couldn’t be saved. Try again." }
    }

    // MARK: Promoter

    @ViewBuilder private var promoterSection: some View {
        if let promoter = store.promoter {
            row("Your details", detail: promoter.location ?? "", icon: "building.2") { PromoterDetailsView(promoter: promoter) }
            row("Build a team", detail: store.isTeamMember ? "You’re on a team" : (store.teamInvitesForMe.isEmpty ? "Invite people to help book" : "You have an invitation"), icon: "person.2") { TeamView() }
        }
    }

    // MARK: Common

    @ViewBuilder private var common: some View {
        if store.profile?.isStaff == true { row("Staff tools", detail: store.adminRole ?? "", icon: "shield") { StaffView() } }
        row("Settings", detail: "Password, data, account", icon: "gearshape") { SettingsView() }
        row("Help & support", detail: "Contact us", icon: "questionmark.circle") { SupportView() }
        row("Trust & safety", detail: "No pay-to-play. Ever.", icon: "checkmark.shield") { LegalView(document: LegalContent.trust).navigationTitle("Trust & safety") }
        LogOutButton { Text("Log out") }.buttonStyle(.appOutline).padding(.top, 6)
    }

    private func row<Destination: View>(_ title: String, detail: String, icon: String, @ViewBuilder destination: @escaping () -> Destination) -> some View {
        NavigationLink { destination() } label: {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.system(size: 18)).foregroundStyle(Theme.acid).frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(Theme.body(16, weight: .medium)).foregroundStyle(Theme.paper)
                    if !detail.isEmpty { Text(detail).font(Theme.body(12)).foregroundStyle(Theme.paperDim) }
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(Theme.paperDim)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.inkCard)
            .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A promoter's company details (name shown on every listing, city, photo).
struct PromoterDetailsView: View {
    @Environment(AppStore.self) private var store
    let promoter: Promoter
    @State private var company: String
    @State private var place: Place?
    @State private var avatar: String?
    @State private var error: String?
    @State private var saved = false

    init(promoter: Promoter) {
        self.promoter = promoter
        _company = State(initialValue: promoter.company); _place = State(initialValue: promoter.place); _avatar = State(initialValue: promoter.avatarUrl)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) { Eyebrow("Promoter"); DisplayTitle("Your details", size: 30) }
                Text("This appears on every slot you post.").dimBody(14)
                PhotoField(label: "Profile photo", imageUrl: $avatar, maxDimension: ProfilePhoto.size, cropSquare: true)
                LabeledField(label: "Company / collective name") { TextField("Your company", text: $company).fieldStyle() }
                PlaceField(label: "Based in", place: $place, hint: "Shown on your promoter page. Your listings use their venue’s place.")
                if saved { Text("Saved ✓").font(Theme.mono(11)).foregroundStyle(Theme.ok).textCase(.uppercase) }
                if let error { Banner(kind: .error, text: error) }
                AsyncButton { await save() } label: { Text("Save") }
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
    }

    private func save() async {
        error = nil; saved = false
        let name = company.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { error = "Enter your company or collective name."; return }
        do { try await store.perform { try await store.db.updatePromoter(id: promoter.id, company: name, avatarUrl: avatar)
            if let place, place != promoter.place { try await store.db.setMyLocation(place) } }; saved = true }
        catch { self.error = (error as? AppError)?.message }
    }
}
