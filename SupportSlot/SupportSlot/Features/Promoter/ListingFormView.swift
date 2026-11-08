import SwiftUI

/// Post or edit a listing: fill it in, check a preview, then publish. Nothing is
/// public until it's published. Once an offer or a confirmed booking exists the
/// date, venue, times and fee are locked (the database enforces it too).
struct ListingFormView: View {
    @Environment(AppStore.self) private var store
    @Environment(PurchaseStore.self) private var purchases
    @Environment(\.dismiss) private var dismiss
    var editing: Slot?

    @State private var draft: ListingDraft
    @State private var headlinerImage: String?
    @State private var artistPhoto: String?
    @State private var venues: [Venue] = []
    @State private var venuesError: AppError?
    @State private var showPreview = false
    @State private var pickingVenue = false
    @State private var submitted = false          // show field errors after the first attempt
    @State private var error: String?
    @State private var publishedId: ID?
    @State private var imagesLoaded = false
    @State private var initial: ListingDraft
    @State private var initialImages: [String?]
    @State private var confirmDiscard = false

    init(editing: Slot? = nil) {
        self.editing = editing
        var d = ListingDraft()
        if let s = editing {
            d.headliner = s.headliner; d.venueId = s.venueId; d.date = s.date; d.doorsTime = UKDates.clock(s.doorsTime); d.setTime = UKDates.clock(s.setTime)
            d.performanceLengthMins = s.performanceLengthMins; d.expectedAttendance = s.expectedAttendance; d.genres = s.genres
            d.artistSizeFit = s.artistSizeFit; d.supportFee = s.supportFee; d.travelContribution = s.travelContribution
            d.applicationDeadline = s.applicationDeadline; d.requirementsText = s.requirements.joined(separator: "\n")
            d.description = s.description; d.isUrgent = s.isUrgent
        } else {
            d.date = UKDates.adding(days: 14, to: UKDates.today())
            d.applicationDeadline = UKDates.adding(days: 7, to: UKDates.today())
        }
        _draft = State(initialValue: d)
        _initial = State(initialValue: d)
        _initialImages = State(initialValue: [editing?.headlinerImageUrl, editing?.artistPhotoUrl])
        _headlinerImage = State(initialValue: editing?.headlinerImageUrl)
        _artistPhoto = State(initialValue: editing?.artistPhotoUrl)
    }

    private var locked: Bool {
        guard let editing else { return false }
        return store.bookings.contains { $0.slotId == editing.id && ($0.bookingStatus == .offered || $0.bookingStatus == .confirmed) }
    }
    private var errors: [ListingField: String] {
        ListingRules.validate(draft, today: UKDates.today(), existing: editing.map { (date: $0.date, applicationDeadline: $0.applicationDeadline) })
    }
    private func show(_ f: ListingField) -> String? { submitted ? errors[f] : nil }
    private var venue: Venue? { venues.first { $0.id == draft.venueId } }
    /// Anything typed or chosen that hasn't been published/saved yet.
    private var hasUnsavedChanges: Bool { publishedId == nil && (draft != initial || [headlinerImage, artistPhoto] != initialImages) }

    var body: some View {
        ScrollView {
            if let publishedId { published(publishedId) }
            else if showPreview { preview }
            else { form }
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(hasUnsavedChanges)
        .toolbar {
            if hasUnsavedChanges {
                ToolbarItem(placement: .topBarLeading) { Button { confirmDiscard = true } label: { Label("Back", systemImage: "chevron.left") }.accessibilityHint("Asks before discarding your changes") }
            }
        }
        .confirmationDialog("Discard your changes?", isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("Discard changes", role: .destructive) { dismiss() }
            Button("Keep editing", role: .cancel) {}
        } message: { Text("This listing hasn’t been \(editing == nil ? "published" : "saved") yet.") }
        .sheet(isPresented: $pickingVenue) {
            VenuePickerSheet(venues: venues, selectedId: draft.venueId,
                             onSelect: { draft.venueId = $0.id },
                             onAdded: { v in venues.append(v); draft.venueId = v.id })
                .environment(store).presentationBackground(Theme.ink)
        }
        .task {
            await loadVenues()
            if let editing, !imagesLoaded, let full = try? await store.db.slot(id: editing.id) { headlinerImage = full.headlinerImageUrl; artistPhoto = full.artistPhotoUrl; initialImages = [full.headlinerImageUrl, full.artistPhotoUrl]; imagesLoaded = true }
        }
    }

    // MARK: Step 1 — the form

    private var form: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow(editing == nil ? "Step 1 of 2" : "Edit listing")
                DisplayTitle(editing == nil ? "Post a support slot" : "Edit your listing", size: 30)
                Text("Tell artists what you need — the clearer the brief, the better the applications.").dimBody(14)
            }
            if locked {
                Banner(kind: .info, text: "This listing has an offer or a confirmed booking, so the date, venue, times and fee are locked. Use “Change date or times” on the applicants screen, or withdraw the offer first.")
            }
            if let venuesError { ErrorState(error: venuesError) { Task { await loadVenues() } } }

            LabeledField(label: "Headliner / show name", error: show(.headliner)) {
                TextField("Who’s headlining?", text: $draft.headliner).fieldStyle(invalid: show(.headliner) != nil)
            }
            PhotoField(label: "Poster image (optional)", imageUrl: $headlinerImage, maxDimension: 1000, square: false, height: 90)
            PhotoField(label: "Reference photo of the artist you’re picturing (optional)", imageUrl: $artistPhoto, maxDimension: 800, square: false, height: 90)

            LabeledField(label: "Venue", error: show(.venueId), hint: "Any venue in the UK. Add yours if it isn’t listed. The listing takes its place from the venue.") {
                Button { pickingVenue = true } label: {
                    HStack { Text(venue.map { "\($0.name), \($0.city)" } ?? "Choose a venue").foregroundStyle(venue == nil ? Theme.paperDim : Theme.paper).multilineTextAlignment(.leading); Spacer(); Image(systemName: "chevron.up.chevron.down").foregroundStyle(Theme.paperDim) }
                        .fieldStyle(invalid: show(.venueId) != nil)
                }
                .buttonStyle(.plain).disabled(locked)
                .accessibilityLabel("Venue: \(venue.map { "\($0.name), \($0.city)" } ?? "not chosen")")
            }
            LabeledField(label: "Show date", error: show(.date)) { ISODatePicker(title: "Show date", iso: $draft.date).disabled(locked) }
            HStack(spacing: 12) {
                LabeledField(label: "Doors", error: show(.doorsTime)) { ISOTimePicker(title: "Doors", time: $draft.doorsTime).disabled(locked) }
                LabeledField(label: "Set time", error: show(.setTime)) { ISOTimePicker(title: "Set time", time: $draft.setTime).disabled(locked) }
            }
            HStack(spacing: 12) {
                LabeledField(label: "Set length (min)", error: show(.performanceLengthMins)) { IntField(value: $draft.performanceLengthMins, placeholder: "30", invalid: show(.performanceLengthMins) != nil).disabled(locked) }
                LabeledField(label: "Expected crowd", error: show(.expectedAttendance)) { IntField(value: $draft.expectedAttendance, placeholder: "250", invalid: show(.expectedAttendance) != nil) }
            }
            LabeledField(label: "Genres this slot suits", error: show(.genres)) { ChoiceChips(options: Catalog.genres, selection: $draft.genres) }
            LabeledField(label: "Suits which artist size? (optional)") { ChoiceChips(options: Catalog.artistSizes, selection: $draft.artistSizeFit, label: Catalog.artistSizeLabel) }

            HStack(spacing: 12) {
                LabeledField(label: "Support fee (£)", error: show(.supportFee)) { IntField(value: $draft.supportFee, placeholder: "150", invalid: show(.supportFee) != nil).disabled(locked) }
                LabeledField(label: "Travel (£)", error: show(.travelContribution)) { IntField(value: $draft.travelContribution, placeholder: "20", invalid: show(.travelContribution) != nil).disabled(locked) }
            }
            Text("You pay the artist directly if you book them — Support Slot doesn’t handle payment. If the artist’s base is more than \(Travel.longJourneyMiles) miles from the venue in a straight line (or we can’t tell), travel is raised to a \(Money.pence(Travel.minimumLongTravelPence)) minimum automatically. That’s a distance rule, not a journey time.")
                .font(Theme.body(12)).foregroundStyle(Theme.paperDim)

            LabeledField(label: "Applications close", error: show(.applicationDeadline)) { ISODatePicker(title: "Applications close", iso: $draft.applicationDeadline) }
            LabeledField(label: "Requirements (one per line, max 10)", error: show(.requirementsText)) { TextArea(text: $draft.requirementsText, placeholder: "Own backline\n30 minute set", minHeight: 90, invalid: show(.requirementsText) != nil) }
            LabeledField(label: "Description", error: show(.description), hint: "\(draft.description.count)/2000") { TextArea(text: $draft.description, placeholder: "What’s the night, who’s the crowd?", minHeight: 110, invalid: show(.description) != nil) }
            Toggle(isOn: $draft.isUrgent) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("This is last-minute").font(Theme.body(15, weight: .medium)).foregroundStyle(Theme.paper)
                    Text("List it under Needed tonight. Artists nearby who’ve turned alerts on are told.").font(Theme.body(12)).foregroundStyle(Theme.paperDim)
                }
            }.tint(Theme.acid)

            if submitted, !errors.isEmpty { Banner(kind: .error, text: "Fix the highlighted fields to continue.") }
            Button("Review listing") { submitted = true; if errors.isEmpty { showPreview = true } }.buttonStyle(.appPrimary)
            Text("Your first open listing is free. Nothing is public until you publish.").font(Theme.mono(10)).foregroundStyle(Theme.paperDim).textCase(.uppercase).frame(maxWidth: .infinity)
        }
        .padding(20)
    }

    // MARK: Step 2 — preview

    private var preview: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow(editing == nil ? "Step 2 of 2" : "Check your changes")
                DisplayTitle("Check your listing", size: 30)
                Text("This is how artists will see it in search. Nothing is public until you publish.").dimBody(14)
            }
            Card {
                VStack(alignment: .leading, spacing: 12) {
                    if let headlinerImage, !headlinerImage.isEmpty { RemoteImage(source: headlinerImage).frame(height: 130).clipped() }
                    Text(draft.headliner).font(Theme.display(24)).foregroundStyle(Theme.paper)
                    previewRow("Venue", venue.map { "\($0.name), \($0.city)" } ?? "")
                    previewRow("Date", UKDates.formatShowDate(draft.date, withYear: true))
                    previewRow("Doors / on stage", "\(draft.doorsTime) / \(draft.setTime) (\(draft.performanceLengthMins ?? 0) min)")
                    previewRow("Applications close", UKDates.formatShowDate(draft.applicationDeadline, withYear: true))
                    previewRow("Support fee", "\(Money.gbp(draft.supportFee ?? 0)) + \(Money.gbp(draft.travelContribution ?? 0)) travel")
                    previewRow("Payment", "You pay the artist directly if you book them.")
                    FlowLayout(spacing: 6) { ForEach(draft.genres, id: \.self) { Tag($0) } }
                    if draft.isUrgent { Text("Marked last-minute: artists nearby with alerts on are notified.").font(Theme.body(13)).foregroundStyle(Theme.signal) }
                }
            }
            if let error { Banner(kind: .error, text: error) }
            HStack(spacing: 12) {
                Button("Back") { showPreview = false; error = nil }.buttonStyle(.appOutline)
                AsyncButton { await publish() } label: { Text(editing == nil ? "Publish" : "Save changes") }
            }
        }
        .padding(20)
    }

    private func previewRow(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) { MonoLabel(label); Text(value).font(Theme.body(15)).foregroundStyle(Theme.paper) }
    }

    private func published(_ id: ID) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark").font(.system(size: 28, weight: .bold)).foregroundStyle(Theme.acid).frame(width: 64, height: 64).overlay(Rectangle().stroke(Theme.acid, lineWidth: 1))
            Text(editing == nil ? "Your listing is live." : "Changes saved.").font(Theme.display(28)).foregroundStyle(Theme.paper)
            Text(editing == nil ? "Artists can find it and apply now. We’ll tell you as applications arrive." : "Applicants are told about any material changes.").dimBody().multilineTextAlignment(.center)
            NavigationLink { ApplicantsView(slotId: id) } label: { Text("Manage applicants") }.buttonStyle(.appPrimary)
            Button("Done") { dismiss() }.buttonStyle(.appOutline)
        }
        .padding(30)
    }

    // MARK: Actions

    private func loadVenues() async {
        do { venues = try await store.db.venues(); venuesError = nil }
        catch { if venues.isEmpty { venuesError = (error as? AppError) ?? .generic() } }
    }

    private func publish() async {
        error = nil
        guard let venue else { error = "Choose a venue."; return }
        do {
            if let editing {
                try await store.perform { try await store.db.updateListing(id: editing.id, draft, headlinerImage: headlinerImage, artistPhoto: artistPhoto) }
                publishedId = editing.id
            } else {
                guard let uid = store.userId else { error = AppError.sessionExpired.message; return }
                let open = store.myListings.filter { $0.slotStatus == .open }.count
                guard PlanRules.canPostAnother(openListings: open, hasTeam: purchases.hasTeam) else {
                    error = "The free plan has \(PlanRules.freeLiveListings) open listing at a time. Close or fill it first, or get the Team plan."
                    return
                }
                publishedId = try await store.perform { try await store.db.createListing(promoterId: uid, draft, headlinerImage: headlinerImage, artistPhoto: artistPhoto) }
            }
        } catch { self.error = (error as? AppError)?.message ?? "We couldn’t save your listing." }
    }
}
