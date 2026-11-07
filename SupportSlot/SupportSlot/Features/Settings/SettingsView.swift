import SwiftUI

struct SettingsView: View {
    @Environment(AppStore.self) private var store
    @State private var notifyRequests = true
    @State private var settingError: String?
    @State private var blocked: [BlockedPromoter] = []
    @State private var blockedError: String?
    @State private var exportURL: URL?
    @State private var exportError: String?
    @State private var showDelete = false
    @State private var showPassword = false
    @State private var legal: LegalPage?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 8) { Eyebrow("Account"); DisplayTitle("Settings", size: 32) }

                section("Account") {
                    Text("Signed in as \(store.accountEmail ?? "your account") (\(store.role.title.lowercased())).").dimBody(14)
                    Button("Change password") { showPassword = true }.buttonStyle(.appOutline)
                }

                if store.role == .artist {
                    section("Notifications") {
                        Toggle(isOn: Binding(get: { notifyRequests }, set: { v in Task { await setNotify(v) } })) {
                            Text("Tell me when a promoter sends an availability request").font(Theme.body(15)).foregroundStyle(Theme.paper)
                        }.tint(Theme.acid)
                        Text("Everything important also appears in the bell, always. Support Slot doesn’t send email notifications.").dimBody(12)
                        FieldError(message: settingError)
                    }
                    section("Blocked promoters") {
                        if blocked.isEmpty { Text("You haven’t blocked anyone. You can block a promoter from a conversation.").dimBody(14) }
                        ForEach(blocked) { b in
                            HStack {
                                Text(b.company).font(Theme.body(15)).foregroundStyle(Theme.paper)
                                Spacer()
                                AsyncButton(kind: .outline, compact: true) { await unblock(b) } label: { Text("Unblock") }.frame(width: 120)
                            }
                        }
                        FieldError(message: blockedError)
                    }
                }

                section("Your data") {
                    Text("Download everything the app holds about you as a JSON file.").dimBody(14)
                    if let exportURL {
                        ShareLink(item: exportURL) { Label("Share your data file", systemImage: "square.and.arrow.up") }.buttonStyle(.appPrimary)
                    } else {
                        AsyncButton(kind: .outline) { await export() } label: { Text("Prepare my data") }
                    }
                    FieldError(message: exportError)
                }

                section("Legal and help") {
                    ForEach(LegalPage.allCases) { p in
                        Button { legal = p } label: { HStack { Text(p.label); Spacer(); Image(systemName: "chevron.right").font(.system(size: 12)) }.font(Theme.body(15)).foregroundStyle(Theme.paper).frame(minHeight: 44) }
                        Divider1()
                    }
                    NavigationLink { SupportView() } label: { HStack { Text("Help & support"); Spacer(); Image(systemName: "chevron.right").font(.system(size: 12)) }.font(Theme.body(15)).foregroundStyle(Theme.paper).frame(minHeight: 44) }
                }

                section("Delete account") {
                    Text("Permanently deletes your login, profile and saved gigs, and withdraws anything still open. Conversations you took part in are deleted for the other person too. Past booking records are kept for the other side, with the names they were made under, but no longer linked to your account; support requests you sent are kept until they’re dealt with. You can’t delete while you have an upcoming confirmed booking — cancel it first.").dimBody(13)
                    Button("Delete my account") { showDelete = true }.buttonStyle(.appDanger)
                }

                Button("Log out") { Task { await store.signOut() } }.buttonStyle(.appOutline)
            }
            .padding(20)
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task {
            notifyRequests = store.profile?.notifyAvailabilityRequests ?? true
            await loadBlocked()
        }
        .sheet(isPresented: $showPassword) { NavigationStack { SetNewPasswordView() }.environment(store).presentationBackground(Theme.ink) }
        .sheet(isPresented: $showDelete) { NavigationStack { DeleteAccountView() }.environment(store).presentationBackground(Theme.ink) }
        .sheet(item: $legal) { page in NavigationStack { LegalView(document: page.document).navigationTitle(page.label) }.presentationBackground(Theme.ink) }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        Card { VStack(alignment: .leading, spacing: 12) { MonoLabel(title); content() } }
    }

    private func setNotify(_ v: Bool) async {
        guard let uid = store.userId else { return }
        let old = notifyRequests
        notifyRequests = v; settingError = nil
        do { try await store.perform { try await store.db.setNotifyAvailabilityRequests(profileId: uid, enabled: v) } }
        catch { notifyRequests = old; settingError = (error as? AppError)?.message }
    }

    private func loadBlocked() async {
        guard store.role == .artist, let uid = store.userId else { return }
        do { blocked = try await store.db.blockedPromoters(artistId: uid) }
        catch { blockedError = "We couldn’t load your blocked list." }
    }

    private func unblock(_ b: BlockedPromoter) async {
        guard let uid = store.userId else { return }
        blockedError = nil
        do { try await store.db.unblockPromoter(artistId: uid, promoterId: b.promoterId); await loadBlocked() }
        catch { blockedError = (error as? AppError)?.message ?? "Couldn’t unblock them." }
    }

    private func export() async {
        exportError = nil
        do {
            let data = try await store.db.exportMyData()
            let pretty = (try? JSONSerialization.data(withJSONObject: JSONSerialization.jsonObject(with: data), options: [.prettyPrinted, .sortedKeys])) ?? data
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("support-slot-my-data.json")
            try pretty.write(to: url, options: .atomic)
            exportURL = url
        } catch { exportError = (error as? AppError)?.message ?? "We couldn’t prepare your data." }
    }
}

struct DeleteAccountView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var confirm = ""
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Eyebrow("This can’t be undone", color: Theme.signal)
                DisplayTitle("Delete your account?", size: 28)
                Text("Type DELETE to confirm. Your login and profile will be removed and you’ll be logged out. Conversations you took part in are deleted for the other person too. We only tell you it worked once the server has confirmed it.").dimBody()
                TextField("DELETE", text: $confirm).textInputAutocapitalization(.characters).autocorrectionDisabled().fieldStyle(invalid: error != nil)
                if let error { Banner(kind: .error, text: error) }
                HStack(spacing: 12) {
                    Button("Keep my account") { dismiss() }.buttonStyle(.appOutline)
                    AsyncButton(kind: .danger) { await delete() } label: { Text("Delete") }.disabled(confirm != "DELETE")
                }
            }
            .padding(24)
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
    }

    private func delete() async {
        error = nil
        do { try await store.db.deleteMyAccount(); dismiss(); await store.signOut() }
        catch { self.error = (error as? AppError)?.message ?? "We couldn’t delete your account. Please contact support." }
    }
}
