import SwiftUI

/// One listing's applicants and the promoter's controls for it. Opening this
/// screen marks new applications as "viewed" (the applicant is told a promoter
/// has looked) — that's the only thing that sets "viewed".
struct ApplicantsView: View {
    @Environment(AppStore.self) private var store
    @Environment(PurchaseStore.self) private var purchases
    let slotId: ID

    @State private var slot: Slot?
    @State private var loadError: AppError?
    @State private var markedViewed = false

    private var applicants: [Application] { store.applications.filter { $0.slotId == slotId } }
    private var bookings: [Booking] { store.bookings.filter { $0.slotId == slotId } }

    var body: some View {
        ScrollView {
            if let slot {
                VStack(alignment: .leading, spacing: 22) {
                    header(slot)
                    ListingActionsView(slot: slot) { await reload() }
                    if slot.promoterId == store.userId {   // schedules stay with the listing's owner
                        NavigationLink { if purchases.hasTeam { ShowScheduleView(slot: slot) } else { PaywallScreen(feature: .team) } } label: {
                            Label("Show schedule", systemImage: purchases.hasTeam ? "list.bullet.rectangle" : "lock")
                        }.buttonStyle(.appOutline)
                    }
                    if slot.slotStatus != .open && slot.slotStatus != .filled {
                        Banner(kind: .info, text: slot.slotStatus == .closed ? "Applications are closed. Existing applicants keep their status and you can still make offers." : "This listing was cancelled.")
                    }
                    applicantSections(slot)
                    InvitationsSection(slotId: slotId)
                }
                .padding(20)
            } else if let loadError {
                ErrorState(error: loadError) { Task { await reload() } }.padding(20)
            } else {
                LoadingView(label: "Loading applicants…").padding(.top, 60)
            }
        }
        .refreshable { await reload() }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload(); await markNewAsViewed() }
        .navigationDestination(for: Artist.self) { ArtistProfileView(handle: $0.handle, preloaded: $0) }
    }

    private func header(_ slot: Slot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow("Applicants")
            DisplayTitle(slot.headliner, size: 28)
            Text([slot.venue?.name, slot.city].compactMap { $0 }.joined(separator: " · ") + " · " + UKDates.shortDate(slot.date)).dimBody(14)
            Text("\(Money.gbp(slot.supportFee)) fee · \(UKDates.applicationCloseText(slot.applicationDeadline))").font(Theme.mono(11)).foregroundStyle(Theme.paperDim)
        }
    }

    @ViewBuilder private func applicantSections(_ slot: Slot) -> some View {
        let toReview = applicants.filter { [.submitted, .viewed].contains($0.applicationStatus) }
        let shortlisted = applicants.filter { $0.applicationStatus == .shortlisted }
        let offersAndBookings = applicants.filter { [.offered, .confirmed].contains($0.applicationStatus) }
        let closed = applicants.filter { ![.submitted, .viewed, .shortlisted, .offered, .confirmed].contains($0.applicationStatus) }

        if applicants.isEmpty {
            EmptyState(title: "No applications yet", message: "Artists who apply appear here. You can also invite artists from the Artists tab.")
        }
        group("Offers & bookings", offersAndBookings, slot)
        group("To review", toReview, slot)
        group("Shortlisted", shortlisted, slot)
        group("Closed", closed, slot)
    }

    @ViewBuilder private func group(_ title: String, _ apps: [Application], _ slot: Slot) -> some View {
        if !apps.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                MonoLabel("\(title) (\(apps.count))")
                ForEach(apps) { app in ApplicantCard(application: app, slot: slot, booking: store.booking(forApplication: app.id)) }
            }
        }
    }

    private func reload() async {
        do {
            guard let fresh = try await store.db.slot(id: slotId) else { loadError = AppError("That listing no longer exists."); slot = nil; return }
            slot = fresh; loadError = nil
            await store.refresh()
        } catch is CancellationError {
        } catch { if slot == nil { loadError = (error as? AppError) ?? .generic() } }
    }

    private func markNewAsViewed() async {
        guard !markedViewed else { return }
        markedViewed = true
        let fresh = applicants.filter { $0.applicationStatus == .submitted }
        if fresh.isEmpty { return }
        for app in fresh { try? await store.db.markViewed(applicationId: app.id) }
        await store.refresh()
    }
}

struct ApplicantCard: View {
    @Environment(AppStore.self) private var store
    let application: Application
    let slot: Slot
    let booking: Booking?
    @State private var showFit = false
    @State private var terms: TermsPreview?

    var body: some View {
        let artist = application.artist
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                if let artist {
                    NavigationLink(value: artist) { Avatar(imageUrl: artist.imageUrl, name: artist.name, size: 56) }.buttonStyle(.plain)
                }
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 6) {
                        Text(artist?.name ?? "Artist").font(Theme.display(19)).foregroundStyle(Theme.paper)
                        if artist?.isVerified == true { VerifiedBadge() }
                    }
                    if let artist { Text("\(artist.location) · \(Catalog.artistSizeLabel(artist.artistSize))").font(Theme.body(13)).foregroundStyle(Theme.paperDim) }
                    StatusPill(status: application.applicationStatus)
                }
                Spacer(minLength: 0)
            }
            if let artist {
                FlowLayout(spacing: 6) { ForEach(artist.genres, id: \.self) { Tag($0) } }
                if let track = artist.tracks.first(where: { $0.id == application.featuredTrackId }) {
                    HStack(spacing: 8) {
                        Image(systemName: "music.note").foregroundStyle(Theme.acid)
                        Text(track.title).font(Theme.body(14, weight: .medium)).foregroundStyle(Theme.paper)
                        Text(track.duration).font(Theme.mono(11)).foregroundStyle(Theme.paperDim)
                        Spacer()
                        if let url = SafeLink.url(track.url) { Link(destination: url) { Image(systemName: "play.circle.fill").font(.system(size: 24)).foregroundStyle(Theme.acid) }.accessibilityLabel("Listen to \(track.title)") }
                    }
                }
            }
            if let m = application.message, !m.isEmpty { Text("“\(m)”").font(Theme.body(15)).foregroundStyle(Theme.paper) }
            if let artist {
                DisclosureGroup(isExpanded: $showFit) { FitSummaryView(fit: Fit.explain(artist: artist, slot: slot, approxDistanceMiles: terms?.basis == "straight_line" ? terms?.distanceMiles : nil)).padding(.top, 8) } label: {
                    MonoLabel("How it fits")
                }
                .tint(Theme.paperDim)
            }
            Divider1()
            PromoterApplicantControls(application: application, booking: booking, slot: slot)
        }
        .task(id: application.id) { terms = try? await store.db.termsPreview(slotId: slot.id, artistId: application.artistId) }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.inkCard)
        .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
    }
}

/// What a promoter can do with one applicant, depending on where it is.
struct PromoterApplicantControls: View {
    @Environment(AppStore.self) private var store
    let application: Application
    let booking: Booking?
    let slot: Slot
    @State private var sheet: Sheet?
    @State private var error: String?
    private enum Sheet: String, Identifiable { case offer, decline, withdraw, cancel; var id: String { rawValue } }

    private var live: Bool { slot.slotStatus == .open || slot.slotStatus == .closed }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch application.applicationStatus {
            case .offered:
                if let booking { Banner(kind: .info, text: "Offer sent — \(booking.artistName) has until \(booking.offerExpiresAt.ukDateTime) to respond. Nothing is confirmed until they accept.") }
            case .confirmed:
                if let booking {
                    VStack(alignment: .leading, spacing: 12) {
                        MonoLabel("Confirmed by \(booking.artistName)", color: Theme.ok)
                        BookingTermsView(booking: booking, viewer: .promoter)
                        Text("Agree payment with the artist directly — Support Slot doesn’t take or hold payment.").dimBody(12)
                    }
                }
            case .cancelled:
                if let reason = booking?.cancelReason { Text("Cancelled. Reason: \(reason)").dimBody(13) }
            default: EmptyView()
            }

            FlowLayout(spacing: 10) {
                switch application.applicationStatus {
                case .submitted, .viewed, .shortlisted:
                    if live {
                        if application.applicationStatus != .shortlisted {
                            AsyncButton(kind: .outline, compact: true) { _ = await run { try await store.db.shortlist(applicationId: application.id) } } label: { Text("Shortlist") }
                        }
                        Button("Make offer") { sheet = .offer }.buttonStyle(.app(.primary, compact: true))
                        Button("Decline") { sheet = .decline }.buttonStyle(.app(.danger, compact: true))
                    }
                case .offered:
                    Button("Withdraw offer") { sheet = .withdraw }.buttonStyle(.app(.outline, compact: true))
                case .confirmed:
                    Button("Cancel booking") { sheet = .cancel }.buttonStyle(.app(.danger, compact: true))
                default: EmptyView()
                }
                if application.applicationStatus.isLive { MessageButton(applicationId: application.id) }
            }
            if let error { Banner(kind: .error, text: error) }
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .offer:
                NavigationStack { OfferSheet(application: application, slot: slot) }.environment(store).presentationBackground(Theme.ink)
            case .decline:
                ReasonSheet(title: "Decline this applicant?", message: "They’re told it wasn’t successful this time. This can’t be undone.", confirmLabel: "Decline") { reason in
                    await run { try await store.db.decline(applicationId: application.id, reason: reason.isEmpty ? nil : reason) }
                }
            case .withdraw:
                ReasonSheet(title: "Withdraw your offer?", message: "The artist is told, and goes back to shortlisted. You can offer again or choose someone else.", confirmLabel: "Withdraw offer", destructive: false) { _ in
                    await run { try await store.db.withdrawOffer(applicationId: application.id) }
                }
            case .cancel:
                ReasonSheet(title: "Cancel this booking?", message: "The artist is told straight away and the slot goes back on the market.", confirmLabel: "Cancel booking", requireReason: true) { reason in
                    await run { try await store.db.cancelBooking(applicationId: application.id, reason: reason) }
                }
            }
        }
    }

    @discardableResult
    private func run(_ work: @escaping () async throws -> some Any) async -> String? {
        do { _ = try await store.perform { try await work() }; error = nil; return nil }
        catch { let m = (error as? AppError)?.message ?? "Something went wrong. Please try again."; self.error = m; return m }
    }
}

/// Make an offer: shows exactly the terms that will be locked in.
struct OfferSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let application: Application
    let slot: Slot
    @State private var message = ""
    @State private var error: String?

    @State private var terms: TermsPreview?
    @State private var termsFailed = false
    private var travelPence: Int { terms?.travelPence ?? slot.travelContribution * 100 }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Eyebrow("Offer")
                DisplayTitle("Make an offer", size: 28)
                Text("The terms come from your listing and are locked in when you send this. \(application.artist?.name ?? "The artist") then accepts or declines; only an accepted offer becomes a booking, and you then settle payment with them directly.").dimBody(14)
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        MonoLabel("Terms")
                        line("Performance fee", Money.gbp(slot.supportFee))
                        line("Travel contribution", Money.pence(travelPence))
                        if let terms {
                            if terms.minimumApplies { Text("Raised to the \(Money.pence(Travel.minimumLongTravelPence)) minimum because the venue is more than \(Travel.longJourneyMiles) miles away in a straight line, or we can’t tell how far.").font(Theme.body(12)).foregroundStyle(Theme.paperDim) }
                            if let sentence = terms.distanceSentence { Text(sentence).font(Theme.body(12)).foregroundStyle(Theme.paperDim) }
                        } else if termsFailed {
                            Banner(kind: .error, text: "We couldn’t check the travel terms just now. Go back and try again before sending.")
                        } else { ProgressView().tint(Theme.acid) }
                        Divider1()
                        line("You pay the artist (directly, outside the app)", Money.pence(slot.supportFee * 100 + travelPence), bold: true)
                        Text("The offer expires after up to 7 days, or sooner if the show is closer.").font(Theme.body(12)).foregroundStyle(Theme.paperDim)
                    }
                }
                LabeledField(label: "Message (optional)", hint: "\(message.count)/1000") {
                    TextArea(text: $message, placeholder: "Say something to the artist", minHeight: 100)
                        .onChange(of: message) { _, new in if new.count > 1000 { message = String(new.prefix(1000)) } }
                }
                if let error { Banner(kind: .error, text: error) }
                HStack(spacing: 12) {
                    Button("Go back") { dismiss() }.buttonStyle(.appOutline)
                    AsyncButton { await send() } label: { Text("Send offer") }.disabled(terms == nil)
                }
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task { do { terms = try await store.db.termsPreview(slotId: slot.id, artistId: application.artistId) } catch { termsFailed = true } }
    }

    private func line(_ label: String, _ value: String, bold: Bool = false) -> some View {
        HStack { Text(label).font(bold ? Theme.display(16) : Theme.body(14)).foregroundStyle(bold ? Theme.paper : Theme.paperDim); Spacer(); Text(value).font(bold ? Theme.display(18) : Theme.body(14)).foregroundStyle(Theme.paper) }
    }

    private func send() async {
        error = nil
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        do { try await store.perform { try await store.db.makeOffer(applicationId: application.id, message: text.isEmpty ? nil : text) }; dismiss() }
        catch { self.error = (error as? AppError)?.message ?? "We couldn’t send that offer." }
    }
}

/// Owner-only lifecycle controls for one listing. Every action is enforced in
/// SQL (owner check, state check, confirmed-booking check); this only offers
/// the ones that make sense for the listing's current status.
struct ListingActionsView: View {
    @Environment(AppStore.self) private var store
    @Environment(PurchaseStore.self) private var purchases
    @State private var showPaywall = false
    let slot: Slot
    var onChanged: () async -> Void
    @State private var sheet: Sheet?
    @State private var error: String?
    private enum Sheet: String, Identifiable { case close, cancel, reschedule; var id: String { rawValue } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            FlowLayout(spacing: 10) {
                if slot.slotStatus == .open || slot.slotStatus == .closed {
                    NavigationLink { ListingFormView(editing: slot) } label: { Text("Edit") }.buttonStyle(.app(.outline, compact: true))
                }
                if slot.slotStatus == .open || slot.slotStatus == .filled {
                    Button("Change date or times") { sheet = .reschedule }.buttonStyle(.app(.outline, compact: true))
                }
                if slot.slotStatus == .open { Button("Close applications") { sheet = .close }.buttonStyle(.app(.outline, compact: true)) }
                if slot.slotStatus == .closed { AsyncButton(kind: .outline, compact: true) { await reopen() } label: { Text("Reopen") } }
                if slot.slotStatus == .open || slot.slotStatus == .filled { Button("Cancel listing") { sheet = .cancel }.buttonStyle(.app(.danger, compact: true)) }
            }
            if let error, sheet == nil { Banner(kind: .error, text: error) }
        }
        .sheet(isPresented: $showPaywall) { PaywallSheet(feature: .team).environment(store).environment(purchases) }
        .sheet(item: $sheet) { which in
            switch which {
            case .close:
                ReasonSheet(title: "Close applications?", message: "No new applications can be sent. Existing applicants keep their status and you can still make offers. You can reopen later.", confirmLabel: "Close applications", destructive: false) { _ in
                    await run { try await store.db.closeSlot(id: slot.id) }
                }
            case .cancel:
                ReasonSheet(title: "Cancel this listing?", message: slot.slotStatus == .filled ? "This listing has a confirmed artist. Cancelling it cancels their booking and tells them." : "Everyone who applied is told the listing was cancelled, and any outstanding offer is withdrawn.", confirmLabel: "Cancel listing") { reason in
                    await run { try await store.db.cancelSlot(id: slot.id, reason: reason.isEmpty ? nil : reason) }
                }
            case .reschedule:
                NavigationStack { RescheduleSheet(slot: slot) { await onChanged() } }.environment(store).presentationBackground(Theme.ink)
            }
        }
    }

    private func reopen() async {
        error = nil
        let forTeam = slot.promoterId != store.userId
        if !forTeam && !PlanRules.canPostAnother(openListings: store.myListings.filter { $0.slotStatus == .open && $0.promoterId == slot.promoterId }.count, hasTeam: purchases.hasTeam) {
            showPaywall = true; return
        }
        do { try await store.perform { try await store.db.reopenSlot(id: slot.id) }; await onChanged() }
        catch { self.error = (error as? AppError)?.message ?? "Couldn’t reopen this listing." }
    }

    private func run(_ work: @escaping () async throws -> Void) async -> String? {
        do { try await store.perform { try await work() }; error = nil; await onChanged(); return nil }
        catch { let m = (error as? AppError)?.message ?? "Something went wrong."; self.error = m; return m }
    }
}

struct RescheduleSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let slot: Slot
    var onDone: () async -> Void
    @State private var date: String
    @State private var doors: String
    @State private var set: String
    @State private var error: String?

    init(slot: Slot, onDone: @escaping () async -> Void) {
        self.slot = slot; self.onDone = onDone
        _date = State(initialValue: slot.date); _doors = State(initialValue: slot.doors); _set = State(initialValue: slot.onStage)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Eyebrow("Reschedule")
                DisplayTitle("Change date or times", size: 28)
                Text("A confirmed artist is told straight away and can cancel if the new date doesn’t work. You can’t reschedule while an offer is waiting for an answer.").dimBody(14)
                LabeledField(label: "New date") { ISODatePicker(title: "New date", iso: $date) }
                HStack(spacing: 12) {
                    LabeledField(label: "Doors") { ISOTimePicker(title: "Doors", time: $doors) }
                    LabeledField(label: "Set time") { ISOTimePicker(title: "Set time", time: $set) }
                }
                if let error { Banner(kind: .error, text: error) }
                HStack(spacing: 12) {
                    Button("Cancel") { dismiss() }.buttonStyle(.appOutline)
                    AsyncButton { await save() } label: { Text("Save") }
                }
            }
            .padding(24)
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
    }

    private func save() async {
        error = nil
        if date < UKDates.today() { error = "The new date can’t be in the past."; return }
        if set < doors { error = "The set can’t start before doors."; return }
        do { try await store.perform { try await store.db.rescheduleSlot(id: slot.id, date: date, doors: doors, set: set) }; await onDone(); dismiss() }
        catch { self.error = (error as? AppError)?.message ?? "We couldn’t change that." }
    }
}
