import SwiftUI

/// One listing: what, where, when, how much, who's asking, and the right next
/// action for whoever is looking (visitor, artist, the promoter who owns it).
struct SlotDetailView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.openURL) private var openURL
    let slotId: ID
    var preloaded: Slot?

    @State private var slot: Slot?
    @State private var promoter: Promoter?
    @State private var loadError: AppError?
    @State private var showApply = false
    @State private var showReport = false
    @State private var showAuth = false
    @State private var applied = false

    var body: some View {
        ScrollView {
            if let slot {
                content(slot)
            } else if let loadError {
                ErrorState(error: loadError) { Task { await load() } }.padding(20)
            } else {
                LoadingView(label: "Loading listing…").padding(.top, 60)
            }
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task { if slot == nil { slot = preloaded }; await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showApply) {
            if let slot { NavigationStack { ApplySheet(slot: slot) { applied = true } }.environment(store).presentationBackground(Theme.ink) }
        }
        .sheet(isPresented: $showReport) {
            if let slot { NavigationStack { ReportSheet(contextType: "slot", contextId: slot.id, reportedProfileId: slot.promoterId, subject: slot.headliner) }.environment(store).presentationBackground(Theme.ink) }
        }
        .sheet(isPresented: $showAuth) { NavigationStack { AuthView(mode: .signup) }.environment(store).presentationBackground(Theme.ink) }
    }

    private func load() async {
        do {
            guard let fresh = try await store.db.slot(id: slotId) else { loadError = AppError("That listing no longer exists."); slot = nil; return }
            slot = fresh
            loadError = nil
            promoter = try? await store.db.promoter(id: fresh.promoterId)
        } catch is CancellationError {
        } catch {
            if slot == nil { loadError = (error as? AppError) ?? .generic() }
        }
    }

    // MARK: Content

    @ViewBuilder private func content(_ slot: Slot) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            RemoteImage(source: slot.headlinerImageUrl).frame(height: 200).clipped()
                .overlay(LinearGradient(colors: [.clear, Theme.ink], startPoint: .center, endPoint: .bottom))

            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        if slot.isUrgent && slot.slotStatus == .open { Tag("Needed tonight", tint: Theme.signal, filled: true) }
                        if slot.slotStatus != .open { Tag(statusText(slot), tint: Theme.signal) }
                    }
                    DisplayTitle(slot.headliner, size: 32)
                    Text([slot.venue?.name, slot.city].compactMap { $0 }.joined(separator: " · ")).dimBody(16)
                    if let promoter { promoterRow(promoter) }
                }

                facts(slot)
                moneyCard(slot)

                if store.role == .artist, store.isSignedIn, let artist = store.artist { FitSummaryView(fit: Fit.explain(artist: artist, slot: slot)) }

                if !slot.description.isEmpty { section("About the show") { Text(slot.description).dimBody(15).lineSpacing(3) } }
                if !slot.requirements.isEmpty {
                    section("What they need") {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(slot.requirements, id: \.self) { r in HStack(alignment: .top, spacing: 8) { Text("•").foregroundStyle(Theme.acid); Text(r).dimBody(15) } }
                        }
                    }
                }
                section("Suits") {
                    VStack(alignment: .leading, spacing: 8) {
                        FlowLayout(spacing: 6) { ForEach(slot.genres, id: \.self) { Tag($0) } }
                        if !slot.artistSizeFit.isEmpty { Text("Looking for \(slot.artistSizeFit.joined(separator: " or ")) acts.").dimBody(14) }
                    }
                }
                if let venue = slot.venue, !venue.address.isEmpty {
                    section("Venue") {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(venue.name).font(Theme.body(16, weight: .semibold)).foregroundStyle(Theme.paper)
                            Text(venue.address).dimBody(14)
                            Text("Capacity \(Money.number(venue.capacity))").dimBody(13)
                        }
                    }
                }

                actions(slot)

                if store.isSignedIn, store.userId != slot.promoterId {
                    Button { showReport = true } label: { Label("Report this listing", systemImage: "flag") }
                        .font(Theme.mono(11)).foregroundStyle(Theme.paperDim).frame(maxWidth: .infinity)
                }
            }
            .padding(20)
        }
    }

    private func statusText(_ s: Slot) -> String {
        switch s.slotStatus { case .filled: return "Filled"; case .closed: return "Closed"; case .cancelled: return "Cancelled"; case .open: return "" }
    }

    private func promoterRow(_ p: Promoter) -> some View {
        HStack(spacing: 10) {
            Avatar(imageUrl: p.avatarUrl, name: p.company, size: 34)
            VStack(alignment: .leading, spacing: 2) {
                MonoLabel("Posted by")
                HStack(spacing: 6) { Text(p.company).font(Theme.body(14, weight: .semibold)).foregroundStyle(Theme.paper); if p.isVerified { VerifiedBadge() } }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func facts(_ s: Slot) -> some View {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 14) {
            GridRow { fact("Date", "\(UKDates.weekday(s.date)), \(UKDates.formatShowDate(s.date, withYear: true))"); fact("Applications", UKDates.applicationCloseText(s.applicationDeadline).replacingOccurrences(of: "Applications ", with: "")) }
            GridRow { fact("Doors", s.doors); fact("On stage", "\(s.onStage) · \(s.performanceLengthMins) min") }
            GridRow { fact("Expected crowd", Money.number(s.expectedAttendance)); fact("Applicants", "\(s.applicantCount)") }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
    }

    private func fact(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) { MonoLabel(label); Text(value).font(Theme.body(15, weight: .medium)).foregroundStyle(Theme.paper) }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
    }

    private func moneyCard(_ s: Slot) -> some View {
        Card(accent: Theme.acid.opacity(0.4)) {
            VStack(alignment: .leading, spacing: 10) {
                MonoLabel("What you’re offered")
                HStack(alignment: .firstTextBaseline) {
                    Text(Money.gbp(s.supportFee)).font(Theme.display(34)).foregroundStyle(Theme.acid)
                    Text("support fee").dimBody(14)
                }
                if s.travelContribution > 0 || store.role == .artist {
                    Text(travelLine(s)).dimBody(14)
                }
                Text("The promoter pays you directly — Support Slot doesn’t take a cut or handle payment. No application fees.").font(Theme.body(12)).foregroundStyle(Theme.paperDim.opacity(0.9))
            }
        }
    }

    private func travelLine(_ s: Slot) -> String {
        if store.role == .artist, let artist = store.artist {
            let effective = Travel.effectiveContribution(pounds: s.travelContribution, artistCity: artist.location, venueCity: s.city)
            if effective != s.travelContribution { return "+ \(Money.gbp(effective)) travel for you (topped up to the £10 minimum for journeys over an hour)" }
            return "+ \(Money.gbp(effective)) travel contribution"
        }
        return "+ \(Money.gbp(s.travelContribution)) travel contribution (journeys over an hour are topped up to £10)"
    }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) { MonoLabel(title); content() }
    }

    // MARK: Actions

    @ViewBuilder private func actions(_ slot: Slot) -> some View {
        let isOwner = store.userId == slot.promoterId
        VStack(spacing: 12) {
            if !store.isSignedIn {
                Text("Create a free artist account (or log in) to apply for this slot.").dimBody(14)
                Button("Create an account") { showAuth = true }.buttonStyle(.appPrimary)
            } else if isOwner {
                NavigationLink { ApplicantsView(slotId: slot.id) } label: { Text("Manage applicants") }.buttonStyle(.appPrimary)
                NavigationLink { ListingFormView(editing: slot) } label: { Text("Edit listing") }.buttonStyle(.appOutline)
            } else if store.role == .promoter {
                Text("Promoter accounts can’t apply to listings.").dimBody(14)
            } else if let application = store.application(forSlot: slot.id) {
                Card {
                    VStack(alignment: .leading, spacing: 10) {
                        MonoLabel("Your application")
                        StatusPill(status: application.applicationStatus)
                        NavigationLink { ApplicationDetailView(applicationId: application.id) } label: { Text("View application") }.buttonStyle(.app(.outline, compact: true))
                    }
                }
            } else if applied {
                Banner(kind: .success, text: "Application submitted. We’ll tell you when the promoter responds.")
            } else if slot.slotStatus != .open {
                Text("This listing isn’t taking applications.").dimBody(14)
            } else if UKDates.deadlinePassed(slot.applicationDeadline) {
                Text("Applications for this listing have closed.").dimBody(14)
            } else {
                Button("Apply for this slot") { showApply = true }.buttonStyle(.appPrimary)
                SaveGigButton(slotId: slot.id, showLabel: true).frame(maxWidth: .infinity)
                Text("No application fees.").font(Theme.mono(10)).foregroundStyle(Theme.paperDim).textCase(.uppercase)
            }
        }
    }
}
