import SwiftUI

/// "Build a team": invite other promoters to help book people, accept an invitation, or leave a team.
struct TeamView: View {
    @Environment(AppStore.self) private var store
    @Environment(PurchaseStore.self) private var purchases
    @State private var email = ""
    @State private var error: String?
    @State private var note: String?
    @State private var showPaywall = false
    @State private var confirmRemove: TeamRow?
    @State private var confirmLeave: TeamRow?

    private var mine: [TeamRow] { store.myTeamRows }
    private var memberOf: [TeamRow] { store.team.filter { $0.memberId == store.userId && $0.isActive } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Help booking people")
                    DisplayTitle("Build a team", size: 32)
                    Text("Invite other promoters on Support Slot to help you book. Once they accept, they can post and edit your listings, review applicants, make offers, cancel bookings and message artists for you. They can’t see your roster, requests, templates or schedules.").dimBody(14)
                }
                if let error { Banner(kind: .error, text: error) }
                if let note { Banner(kind: .success, text: note) }

                invitationsForMe
                memberships

                if store.isTeamMember {
                    Banner(kind: .info, text: "You’re on someone else’s team, so you can’t build your own at the same time. Leave their team first if you want to.")
                } else {
                    inviteSection
                }
                teamList
            }
            .padding(20)
        }
        .refreshable { await store.refresh() }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.refresh() }
        .sheet(isPresented: $showPaywall) { PaywallSheet(feature: .team).environment(store).environment(purchases) }
        .alert("Remove from your team?", isPresented: Binding(get: { confirmRemove != nil }, set: { if !$0 { confirmRemove = nil } })) {
            Button("Remove", role: .destructive) { if let r = confirmRemove { Task { await remove(r) } } }
            Button("Keep", role: .cancel) {}
        } message: { Text("\(confirmRemove?.memberName ?? "They") will lose access to your listings straight away.") }
        .alert("Leave this team?", isPresented: Binding(get: { confirmLeave != nil }, set: { if !$0 { confirmLeave = nil } })) {
            Button("Leave", role: .destructive) { if let r = confirmLeave { Task { await remove(r) } } }
            Button("Stay", role: .cancel) {}
        } message: { Text("You’ll lose access to \(confirmLeave?.ownerName ?? "their") listings and conversations.") }
    }

    @ViewBuilder private var invitationsForMe: some View {
        ForEach(store.teamInvitesForMe) { inv in
            Card {
                VStack(alignment: .leading, spacing: 10) {
                    MonoLabel("Invitation", color: Theme.acid)
                    Text("\(inv.ownerName) invited you to join their team.").font(Theme.body(15, weight: .medium)).foregroundStyle(Theme.paper)
                    Text("You’d be able to post and edit their listings, review applicants, make offers and message artists for them.").dimBody(13)
                    HStack(spacing: 10) {
                        AsyncButton(compact: true) { await respond(inv, accept: true) } label: { Text("Accept") }
                        AsyncButton(kind: .outline, compact: true) { await respond(inv, accept: false) } label: { Text("Decline") }
                    }
                }
            }
        }
    }

    @ViewBuilder private var memberships: some View {
        ForEach(memberOf) { row in
            Card {
                VStack(alignment: .leading, spacing: 10) {
                    MonoLabel("You’re on a team", color: Theme.ok)
                    Text("\(row.ownerName)’s team").font(Theme.body(16, weight: .medium)).foregroundStyle(Theme.paper)
                    Text("Their listings, applicants and conversations are in your My gigs and Messages tabs.").dimBody(13)
                    Button("Leave this team") { confirmLeave = row }.buttonStyle(.app(.danger, compact: true))
                }
            }
        }
    }

    @ViewBuilder private var inviteSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            MonoLabel("Invite someone")
            if !purchases.hasTeam {
                Text("Building a team is part of the Team plan.").dimBody(13)
                Button { showPaywall = true } label: { Label("See the Team plan", systemImage: "lock") }.buttonStyle(.appPrimary)
            } else {
                LabeledField(label: "Their email", hint: "They need a Support Slot promoter account with this email. Up to \(TeamRules.maxPeople) people.") {
                    TextField("name@email.com", text: $email).emailField().fieldStyle()
                }
                AsyncButton { await invite() } label: { Text("Send invitation") }
            }
        }
    }

    @ViewBuilder private var teamList: some View {
        if !mine.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                MonoLabel("Your team (\(mine.count))")
                ForEach(mine) { row in
                    Card {
                        HStack(alignment: .center, spacing: 12) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(row.memberName).font(Theme.body(15, weight: .medium)).foregroundStyle(Theme.paper)
                                if let e = row.memberEmail { Text(e).font(Theme.body(12)).foregroundStyle(Theme.paperDim) }
                                Text(row.isActive ? "On your team" : "Invitation sent").font(Theme.mono(10)).foregroundStyle(row.isActive ? Theme.ok : Theme.paperDim).textCase(.uppercase)
                            }
                            Spacer(minLength: 8)
                            Button(row.isActive ? "Remove" : "Cancel") { confirmRemove = row }.buttonStyle(.app(.outline, compact: true))
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        } else if !store.isTeamMember {
            Text("No one on your team yet.").dimBody(13)
        }
    }

    private func invite() async {
        error = nil; note = nil
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard EmailRules.isValid(address) else { error = "Enter a valid email address."; return }
        do {
            try await store.perform { try await store.db.inviteTeamMember(email: address) }
            note = "Invitation sent. They’ll see it in their notifications."
            email = ""
        } catch { self.error = (error as? AppError)?.message ?? "We couldn’t send that invitation." }
    }

    private func respond(_ row: TeamRow, accept: Bool) async {
        error = nil; note = nil
        do {
            try await store.perform { try await store.db.respondTeamInvite(promoterId: row.promoterId, accept: accept) }
            note = accept ? "You’ve joined \(row.ownerName)’s team." : "Invitation declined."
        } catch { self.error = (error as? AppError)?.message ?? "Something went wrong. Please try again." }
    }

    private func remove(_ row: TeamRow) async {
        error = nil; note = nil
        confirmRemove = nil; confirmLeave = nil
        do {
            try await store.perform { try await store.db.removeTeamMember(promoterId: row.promoterId, memberId: row.memberId) }
        } catch { self.error = (error as? AppError)?.message ?? "Something went wrong. Please try again." }
    }
}
