import SwiftUI

/// An artist's applications, with the state of each — viewed, shortlisted,
/// offers waiting for an answer, confirmed bookings.
struct ApplicationsView: View {
    @Environment(AppStore.self) private var store
    @State private var filter: Filter = .all
    enum Filter: String, CaseIterable, Identifiable {
        case all = "All", active = "Active", offers = "Offers", booked = "Booked"
        var id: String { rawValue }
    }

    private var filtered: [Application] {
        let all = store.applications
        switch filter {
        case .all: return all
        case .active: return all.filter { [.submitted, .viewed, .shortlisted].contains($0.applicationStatus) }
        case .offers: return all.filter { $0.applicationStatus == .offered }
        case .booked: return all.filter { $0.applicationStatus == .confirmed }
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) { Eyebrow("Your gigs"); DisplayTitle("Applications", size: 32) }

                Picker("Filter", selection: $filter) { ForEach(Filter.allCases) { Text($0.rawValue).tag($0) } }
                    .pickerStyle(.segmented)

                if let offers = pendingOffers, offers > 0, filter != .offers {
                    Button { filter = .offers } label: {
                        Banner(kind: .info, text: "You have \(offers) offer\(offers == 1 ? "" : "s") waiting for an answer.")
                    }.buttonStyle(.plain)
                }

                if store.applications.isEmpty {
                    EmptyState(title: "No applications yet", message: "Find a slot that fits your sound and apply in seconds.", actionTitle: "Find a slot") { store.selectedTab = .discover }
                } else if filtered.isEmpty {
                    EmptyState(title: "Nothing here", message: "No applications in this view.")
                } else {
                    ForEach(filtered) { app in
                        NavigationLink(value: app) { ApplicationRowView(application: app, booking: store.booking(forApplication: app.id)) }.buttonStyle(.plain)
                    }
                }
            }
            .padding(20)
        }
        .refreshable { await store.refresh() }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Application.self) { ApplicationDetailView(applicationId: $0.id) }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { NotificationsButton() } }
    }

    private var pendingOffers: Int? { store.applications.filter { $0.applicationStatus == .offered }.count }
}

struct ApplicationRowView: View {
    let application: Application
    let booking: Booking?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(application.slot?.headliner ?? booking?.headliner ?? "A listing").font(Theme.display(19)).foregroundStyle(Theme.paper).multilineTextAlignment(.leading)
                    Text([application.slot?.venue?.name, application.slot?.city].compactMap { $0 }.joined(separator: " · ")).dimBody(13)
                }
                Spacer(minLength: 8)
                StatusPill(status: application.applicationStatus)
            }
            if let slot = application.slot {
                HStack(spacing: 14) {
                    Label(UKDates.shortDate(slot.date), systemImage: "calendar").font(Theme.mono(12)).foregroundStyle(Theme.paper)
                    Label(Money.gbp(slot.supportFee), systemImage: "sterlingsign.circle").font(Theme.mono(12)).foregroundStyle(Theme.acid)
                }
            }
            Text(summary).font(Theme.body(13)).foregroundStyle(application.applicationStatus == .offered ? Theme.acid : Theme.paperDim).multilineTextAlignment(.leading)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.inkCard)
        .overlay(Rectangle().stroke(application.applicationStatus == .offered ? Theme.acid.opacity(0.6) : Theme.inkBorder, lineWidth: 1))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var summary: String {
        switch application.applicationStatus {
        case .submitted: return "Submitted \(UKDates.timeAgo(application.submittedAt)). The promoter hasn’t opened it yet."
        case .viewed: return "A promoter has looked at your application."
        case .shortlisted: return "You’re on the shortlist."
        case .offered: if let b = booking { return "Offer received — respond by \(b.offerExpiresAt.ukDateTime)." } else { return "Offer received." }
        case .confirmed: return "Booking confirmed."
        case .declined: return application.closedReason == "slot_filled" ? "The promoter booked another act." : "Not successful this time."
        case .offerDeclined: return "You declined this offer."
        case .withdrawn: return "You withdrew this application."
        case .cancelled: return "This booking was cancelled."
        }
    }
}

struct ApplicationDetailView: View {
    @Environment(AppStore.self) private var store
    let applicationId: ID

    private var application: Application? { store.applications.first { $0.id == applicationId } }

    var body: some View {
        ScrollView {
            if let application {
                let booking = store.booking(forApplication: application.id)
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 10) {
                        StatusPill(status: application.applicationStatus)
                        DisplayTitle(application.slot?.headliner ?? booking?.headliner ?? "Application", size: 30)
                        Text([application.slot?.venue?.name, application.slot?.city].compactMap { $0 }.joined(separator: " · ")).dimBody(15)
                    }
                    if let slot = application.slot {
                        NavigationLink { SlotDetailView(slotId: slot.id, preloaded: slot) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("\(UKDates.weekday(slot.date)), \(UKDates.formatShowDate(slot.date, withYear: true))").font(Theme.body(15, weight: .medium)).foregroundStyle(Theme.paper)
                                    Text("\(Money.gbp(slot.supportFee)) fee · doors \(slot.doors) · on stage \(slot.onStage)").dimBody(13)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(Theme.paperDim)
                            }
                            .padding(14).overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }

                    ArtistApplicationControls(application: application, booking: booking)

                    VStack(alignment: .leading, spacing: 10) {
                        MonoLabel("Your application")
                        Card {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Submitted \(UKDates.timeAgo(application.submittedAt))").dimBody(13)
                                if let viewed = application.viewedAt { Text("Looked at \(UKDates.timeAgo(viewed))").dimBody(13) }
                                if let track = store.artist?.tracks.first(where: { $0.id == application.featuredTrackId }) {
                                    Text("Featured track: **\(track.title)**").font(Theme.body(14)).foregroundStyle(Theme.paper)
                                }
                                if let m = application.message, !m.isEmpty { Text("“\(m)”").font(Theme.body(15)).foregroundStyle(Theme.paper).padding(.top, 4) }
                            }
                        }
                    }
                }
                .padding(20)
            } else {
                EmptyState(title: "This application isn’t available", message: "It may have been removed.").padding(20)
            }
        }
        .refreshable { await store.refresh() }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Gigs an artist has saved for later.
struct SavedView: View {
    @Environment(AppStore.self) private var store
    @State private var slots: [Slot] = []
    @State private var state: LoadState = .loading
    enum LoadState: Equatable { case loading, loaded, failed(AppError) }

    private var openSlots: [Slot] { slots.filter { isOpen($0) } }
    private var closedSlots: [Slot] { slots.filter { !isOpen($0) } }
    private func isOpen(_ s: Slot) -> Bool { s.slotStatus == .open && !UKDates.deadlinePassed(s.applicationDeadline) && UKDates.daysUntil(s.date) >= 0 }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) { Eyebrow("Your shortlist"); DisplayTitle("Saved gigs", size: 32) }
                switch state {
                case .loading where slots.isEmpty: LoadingView()
                case .failed(let e): ErrorState(error: e) { Task { await load() } }
                default:
                    if slots.isEmpty {
                        EmptyState(title: "Nothing saved yet", message: "Tap the bookmark on any listing to keep it here.", actionTitle: "Find a slot") { store.selectedTab = .discover }
                    } else {
                        ForEach(openSlots) { s in NavigationLink(value: s) { SlotCard(slot: s) }.buttonStyle(.plain) }
                        if !closedSlots.isEmpty {
                            MonoLabel("No longer open (\(closedSlots.count))").padding(.top, 10)
                            ForEach(closedSlots) { s in NavigationLink(value: s) { SlotCard(slot: s).opacity(0.6) }.buttonStyle(.plain) }
                        }
                    }
                }
            }
            .padding(20)
        }
        .refreshable { await load() }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Slot.self) { SlotDetailView(slotId: $0.id, preloaded: $0) }
        .task(id: store.savedSlotIDs) { await load() }
    }

    private func load() async {
        do {
            let all = try await store.db.slots(ids: Array(store.savedSlotIDs))
            // Keep only what is still saved (the list reloads when a bookmark is removed).
            slots = all.filter { store.savedSlotIDs.contains($0.id) }.sorted { $0.date < $1.date }
            state = .loaded
        } catch is CancellationError {
        } catch { if slots.isEmpty { state = .failed((error as? AppError) ?? .generic()) } }
    }
}
