import SwiftUI

/// Availability requests and gig invitations from promoters.
struct ArtistRequestsView: View {
    @Environment(AppStore.self) private var store
    @State private var requests: [AvailabilityRecipient] = []
    @State private var invitations: [GigInvitation] = []
    @State private var state: LoadState = .loading
    @State private var error: String?
    @State private var reporting: AvailabilityRecipient?
    enum LoadState: Equatable { case loading, loaded, failed(AppError) }

    private var sortedRequests: [AvailabilityRecipient] {
        requests.filter { $0.availabilityRequests != nil }.sorted { ($0.availabilityRequests?.createdAt ?? .distantPast) > ($1.availabilityRequests?.createdAt ?? .distantPast) }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("From promoters")
                    DisplayTitle("Requests & invitations", size: 30)
                    Text("Promoters ask if you’re free before committing to a booking, or invite you to apply for one of their gigs. Answering is free and never commits you to anything.").dimBody(14)
                }
                switch state {
                case .loading where requests.isEmpty && invitations.isEmpty: LoadingView()
                case .failed(let e): ErrorState(error: e) { Task { await load() } }
                default:
                    if requests.isEmpty && invitations.isEmpty { EmptyState(title: "Nothing yet", message: "When a promoter asks about your availability or invites you to a gig, it shows up here.") }
                    if !invitations.isEmpty { MonoLabel("Gig invitations"); ForEach(invitations) { inv in invitationCard(inv) } }
                    if !sortedRequests.isEmpty { MonoLabel("Availability requests"); ForEach(sortedRequests) { r in requestCard(r) } }
                    if let error { Banner(kind: .error, text: error) }
                }
            }
            .padding(20)
        }
        .refreshable { await load() }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $reporting) { r in
            if let req = r.availabilityRequests {
                NavigationStack { ReportSheet(contextType: "availability_request", contextId: req.id, reportedProfileId: req.promoterId, subject: req.eventName) }.environment(store).presentationBackground(Theme.ink)
            }
        }
    }

    // MARK: Cards

    private func requestCard(_ r: AvailabilityRecipient) -> some View {
        let req = r.availabilityRequests!
        let open = req.status == "sent" && !req.isExpired
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Avatar(imageUrl: req.promoters?.avatarUrl, name: req.promoters?.company ?? "Promoter", size: 40)
                VStack(alignment: .leading, spacing: 2) { MonoLabel("From"); Text(req.promoters?.company ?? "A promoter").font(Theme.body(15, weight: .semibold)).foregroundStyle(Theme.paper) }
                Spacer()
                Tag(req.label.rawValue, tint: req.label == .open ? Theme.ok : Theme.paperDim)
            }
            Text(req.eventName).font(Theme.display(20)).foregroundStyle(Theme.paper)
            VStack(alignment: .leading, spacing: 4) {
                Text("\(UKDates.formatShowDate(req.eventDate, withYear: true)) · \(UKDates.clock(req.eventTime))").dimBody(14)
                Text("\(req.venueName), \(req.venueLocation)").dimBody(14)
                Text("Proposed fee \(req.currency) \(req.proposedFee) · \(req.setLengthMins) min set").font(Theme.mono(12)).foregroundStyle(Theme.acid)
                Text("Reply by \(req.responseDeadline.ukDateTime)").font(Theme.mono(11)).foregroundStyle(Theme.paperDim)
            }
            if let m = req.message, !m.isEmpty { Text("“\(m)”").font(Theme.body(14)).foregroundStyle(Theme.paper) }
            Text("An enquiry, not a booking. Replying “available” doesn’t commit you or reserve the date.").font(Theme.body(11)).foregroundStyle(Theme.paperDim)
            if open {
                HStack(spacing: 8) {
                    choice("Available", r, "available", on: r.response == "available")
                    choice("Unavailable", r, "unavailable", on: r.response == "unavailable")
                }
                AsyncButton(kind: .outline, compact: true) { await ask(r, req) } label: { Label("Ask a question", systemImage: "bubble.left") }
            } else {
                Text(r.response == "pending" ? "No reply was sent." : "You replied: \(r.response).").dimBody(13)
            }
            Button { reporting = r } label: { Label("Report", systemImage: "flag") }.font(Theme.mono(10)).foregroundStyle(Theme.paperDim)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Theme.inkCard).overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
    }

    private func choice(_ title: String, _ r: AvailabilityRecipient, _ value: String, on: Bool) -> some View {
        AsyncButton(kind: on ? .primary : .outline, compact: true) { await respond(r, value) } label: { Text(title) }
    }

    private func invitationCard(_ inv: GigInvitation) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Avatar(imageUrl: inv.promoters?.avatarUrl, name: inv.promoters?.company ?? "Promoter", size: 40)
                VStack(alignment: .leading, spacing: 2) { MonoLabel("Invitation from"); Text(inv.promoters?.company ?? "A promoter").font(Theme.body(15, weight: .semibold)).foregroundStyle(Theme.paper) }
                Spacer()
                Tag(inv.status, tint: inv.status == "pending" ? Theme.acid : Theme.paperDim)
            }
            if let slot = inv.slots {
                NavigationLink { SlotDetailView(slotId: slot.id, preloaded: slot) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(slot.headliner).font(Theme.display(19)).foregroundStyle(Theme.paper)
                        Text("\(slot.venue?.name ?? slot.city) · \(UKDates.shortDate(slot.date)) · \(Money.gbp(slot.supportFee))").dimBody(13)
                    }
                }.buttonStyle(.plain)
            }
            if let m = inv.message, !m.isEmpty { Text("“\(m)”").font(Theme.body(14)).foregroundStyle(Theme.paper) }
            if inv.status == "pending" {
                Text("Accepting applies to this gig for you. The promoter reviews you like any other applicant — nothing is booked until they make an offer and you accept it.").font(Theme.body(11)).foregroundStyle(Theme.paperDim)
                HStack(spacing: 8) {
                    AsyncButton(compact: true) { await reply(inv, accept: true) } label: { Text("Accept & apply") }
                    AsyncButton(kind: .outline, compact: true) { await reply(inv, accept: false) } label: { Text("Decline") }
                }
            } else if inv.status == "accepted" { Text("You accepted and applied.").dimBody(13) }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Theme.inkCard).overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
    }

    // MARK: Actions

    private func load() async {
        guard let uid = store.userId else { return }
        do {
            async let r = store.db.availabilityRequests(forArtist: uid)
            async let i = store.db.invitations(forArtist: uid)
            (requests, invitations) = try await (r, i)
            state = .loaded
        } catch is CancellationError {}
        catch { if requests.isEmpty && invitations.isEmpty { state = .failed((error as? AppError) ?? .generic()) } }
    }

    private func respond(_ r: AvailabilityRecipient, _ value: String) async {
        error = nil
        do { try await store.db.respondToAvailability(recipientId: r.id, response: value); await load() }
        catch { self.error = (error as? AppError)?.message ?? "Couldn’t send your reply." }
    }

    private func ask(_ r: AvailabilityRecipient, _ req: AvailabilityRequest) async {
        guard let uid = store.userId else { return }
        error = nil
        do {
            let thread = try await store.db.startAvailabilityQuestion(recipientId: r.id, artistId: uid, promoterId: req.promoterId, requestId: req.id)
            await store.refreshThreads()
            store.pendingThreadID = thread
            store.selectedTab = .messages
        } catch { self.error = (error as? AppError)?.message ?? "Couldn’t start a conversation." }
    }

    private func reply(_ inv: GigInvitation, accept: Bool) async {
        guard let uid = store.userId else { return }
        error = nil
        do { try await store.perform { try await store.db.respondToInvitation(inv, artistId: uid, accept: accept) }; await load() }
        catch { self.error = (error as? AppError)?.message ?? "Couldn’t send your reply." }
    }
}
