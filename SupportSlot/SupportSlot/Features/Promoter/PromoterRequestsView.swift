import SwiftUI

/// Availability requests a promoter has sent to roster artists. An "available"
/// reply is guidance, not a reservation — you still invite them to apply, make
/// an offer and settle payment through the normal flow.
struct PromoterRequestsView: View {
    @Environment(AppStore.self) private var store
    @State private var requests: [AvailabilityRequest] = []
    @State private var state: LoadState = .loading
    @State private var composing = false
    enum LoadState: Equatable { case loading, loaded, failed(AppError) }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Private")
                    DisplayTitle("Availability requests", size: 30)
                    Text("Ask roster artists if they’re free before you commit to a booking. An “available” reply is guidance, not a reservation.").dimBody(14)
                }
                Button { composing = true } label: { Label("New request", systemImage: "plus") }.buttonStyle(.appPrimary)
                switch state {
                case .loading where requests.isEmpty: LoadingView()
                case .failed(let e): ErrorState(error: e) { Task { await load() } }
                default:
                    if requests.isEmpty { EmptyState(title: "No requests sent yet", message: "Save a few artists to your roster, then send your first availability request.") }
                    ForEach(requests) { r in RequestCard(request: r) { await load() } }
                }
            }
            .padding(20)
        }
        .refreshable { await load() }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(isPresented: $composing) { NavigationStack { RequestComposerView { await load() } }.environment(store).presentationBackground(Theme.ink) }
    }

    private func load() async {
        guard let uid = store.userId else { return }
        do { requests = try await store.db.availabilityRequests(promoterId: uid); state = .loaded }
        catch is CancellationError {}
        catch { if requests.isEmpty { state = .failed((error as? AppError) ?? .generic()) } }
    }
}

private struct RequestCard: View {
    @Environment(AppStore.self) private var store
    let request: AvailabilityRequest
    var onChanged: () async -> Void
    @State private var error: String?
    @State private var pickingFor: AvailabilityRecipient?

    private var openGigs: [Slot] { store.myListings.filter { $0.slotStatus == .open && !UKDates.deadlinePassed($0.applicationDeadline) && UKDates.daysUntil($0.date) >= 0 } }

    var body: some View {
        let label = request.label
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(request.eventName).font(Theme.display(19)).foregroundStyle(Theme.paper)
                    Text("\(UKDates.formatShowDate(request.eventDate, withYear: true)) · \(UKDates.clock(request.eventTime)) · \(request.venueName), \(request.venueLocation)").dimBody(13)
                    Text("\(request.currency) \(request.proposedFee) · \(request.setLengthMins) min · reply by \(request.responseDeadline.ukDateTime)").font(Theme.mono(11)).foregroundStyle(Theme.paperDim)
                }
                Spacer(minLength: 8)
                Tag(label.rawValue, tint: label == .open ? Theme.ok : label == .filled ? Theme.acid : Theme.paperDim)
            }
            ForEach(request.recipients) { r in
                HStack(alignment: .top, spacing: 10) {
                    Avatar(imageUrl: r.artists?.imageUrl, name: r.artists?.name ?? "Artist", size: 36)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(r.artists?.name ?? "Artist").font(Theme.body(15, weight: .medium)).foregroundStyle(Theme.paper)
                        Text(responseText(r)).font(Theme.body(12)).foregroundStyle(r.response == "available" ? Theme.ok : r.response == "unavailable" ? Theme.signal : Theme.paperDim)
                        if r.questionAsked { Text("Asked a question — check Messages").font(Theme.body(12)).foregroundStyle(Theme.acid) }
                        if r.response == "available", request.status == "sent", !request.isExpired, r.linkedApplicationId == nil, !openGigs.isEmpty {
                            Button("Invite to apply for a gig…") { pickingFor = r }.buttonStyle(.app(.outline, compact: true))
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            if request.status == "sent", !request.isExpired {
                HStack(spacing: 10) {
                    AsyncButton(kind: .outline, compact: true) { await set("withdrawn") } label: { Text("Withdraw") }
                    AsyncButton(kind: .outline, compact: true) { await set("filled") } label: { Text("Mark as filled") }
                }
            }
            if let error { Banner(kind: .error, text: error) }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Theme.inkCard).overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
        .confirmationDialog("Invite to which gig?", isPresented: Binding(get: { pickingFor != nil }, set: { if !$0 { pickingFor = nil } }), titleVisibility: .visible) {
            ForEach(openGigs) { g in Button("\(g.headliner) · \(UKDates.formatShowDate(g.date))") { if let r = pickingFor { Task { await invite(r, to: g) } } } }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func responseText(_ r: AvailabilityRecipient) -> String {
        if let s = r.applications?.status, let status = ApplicationStatus(rawValue: s) {
            return status == .confirmed ? "Booked ✓" : "Applied — \(status.rawValue.replacingOccurrences(of: "_", with: " "))"
        }
        switch r.response { case "available": return "Available"; case "unavailable": return "Not available"; default: return "Waiting for a reply" }
    }

    private func set(_ status: String) async {
        error = nil
        do { try await store.db.setRequestStatus(id: request.id, status: status); await onChanged() }
        catch { self.error = (error as? AppError)?.message }
    }

    private func invite(_ r: AvailabilityRecipient, to slot: Slot) async {
        guard let uid = store.userId else { return }
        error = nil
        do {
            try await store.db.createInvitation(slotId: slot.id, promoterId: uid, artistId: r.artistId, message: nil)
            try await store.db.linkRequest(id: request.id, toSlot: slot.id)
            await onChanged()
        } catch { self.error = (error as? AppError)?.message ?? "Couldn’t send that invitation." }
    }
}

struct RequestComposerView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var onSent: () async -> Void

    @State private var r = Database.NewAvailabilityRequest()
    @State private var eventDate = UKDates.adding(days: 21, to: UKDates.today())
    @State private var fee: Int?
    @State private var length: Int? = 30
    @State private var deadlineDate = UKDates.adding(days: 3, to: UKDates.today())
    @State private var deadlineTime = "18:00"
    @State private var roster: [RosterEntry] = []
    @State private var templates: [EventTemplate] = []
    @State private var selected: Set<ID> = []
    @State private var saveTemplate = false
    @State private var templateName = ""
    @State private var error: String?
    @State private var sent = false
    @State private var loadError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if sent {
                    Image(systemName: "paperplane.fill").font(.system(size: 26)).foregroundStyle(Theme.acid)
                    DisplayTitle("Request sent", size: 28)
                    Text("The artists are told. This is an availability enquiry, not a booking or a guaranteed offer — nothing is reserved until you make an offer and the artist accepts it.").dimBody()
                    Button("Done") { dismiss() }.buttonStyle(.appPrimary)
                } else { form }
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarLeading) { if !sent { Button("Cancel") { dismiss() } } } }
        .task { await load() }
    }

    @ViewBuilder private var form: some View {
        Eyebrow("New request")
        DisplayTitle("Ask about availability", size: 28)
        if let loadError { Banner(kind: .error, text: loadError) }
        if !templates.isEmpty {
            LabeledField(label: "Start from a template") {
                Menu {
                    ForEach(templates) { t in Button(t.name) { apply(t) } }
                } label: { HStack { Text("Choose a template").foregroundStyle(Theme.paperDim); Spacer(); Image(systemName: "chevron.up.chevron.down").foregroundStyle(Theme.paperDim) }.fieldStyle() }
            }
        }
        LabeledField(label: "Who should we ask? (\(selected.count) selected)") {
            if roster.isEmpty { Text("Your roster is empty. Save artists from their profile first.").dimBody(13) }
            VStack(spacing: 0) {
                ForEach(roster) { e in
                    if let a = e.artist {
                        Button { if selected.contains(a.id) { selected.remove(a.id) } else { selected.insert(a.id) } } label: {
                            HStack { Image(systemName: selected.contains(a.id) ? "checkmark.square.fill" : "square").foregroundStyle(selected.contains(a.id) ? Theme.acid : Theme.paperDim)
                                Text(a.name).foregroundStyle(Theme.paper); Spacer(); Text(a.location).font(Theme.body(12)).foregroundStyle(Theme.paperDim) }
                                .padding(.horizontal, 14).frame(minHeight: 48)
                        }.buttonStyle(.plain).accessibilityAddTraits(selected.contains(a.id) ? .isSelected : [])
                        if e.id != roster.last?.id { Divider1() }
                    }
                }
            }
            .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
        }
        LabeledField(label: "Event / show name") { TextField("e.g. Field Mode", text: $r.eventName).fieldStyle() }
        LabeledField(label: "Date") { ISODatePicker(title: "Date", iso: $eventDate) }
        LabeledField(label: "Time") { ISOTimePicker(title: "Time", time: $r.eventTime) }
        LabeledField(label: "Venue name") { TextField("Strange Brew", text: $r.venueName).fieldStyle() }
        LabeledField(label: "Location") { TextField("Bristol", text: $r.venueLocation).fieldStyle() }
        HStack(spacing: 12) {
            LabeledField(label: "Proposed fee") { IntField(value: $fee, placeholder: "150") }
            LabeledField(label: "Currency") {
                Menu { Picker("Currency", selection: $r.currency) { ForEach(["GBP", "EUR", "USD"], id: \.self) { Text($0).tag($0) } } } label: {
                    HStack { Text(r.currency).foregroundStyle(Theme.paper); Spacer(); Image(systemName: "chevron.up.chevron.down").foregroundStyle(Theme.paperDim) }.fieldStyle()
                }
            }
        }
        LabeledField(label: "Set length (min)") { IntField(value: $length, placeholder: "30") }
        LabeledField(label: "Reply by — date") { ISODatePicker(title: "Reply by", iso: $deadlineDate) }
        LabeledField(label: "Reply by — time") { ISOTimePicker(title: "Reply by time", time: $deadlineTime) }
        LabeledField(label: "Optional message") { TextArea(text: $r.message, placeholder: "Any extra context for the artists…", minHeight: 90) }
        Toggle("Save as a template", isOn: $saveTemplate).tint(Theme.acid).font(Theme.body(15)).foregroundStyle(Theme.paper)
        if saveTemplate { TextField("Template name, e.g. Friday supports", text: $templateName).fieldStyle() }
        Text("This sends an availability check, never a reservation — artists never pay to be asked.").font(Theme.body(12)).foregroundStyle(Theme.paperDim)
        if let error { Banner(kind: .error, text: error) }
        AsyncButton { await send() } label: { Text("Send request") }
    }

    private func load() async {
        guard let uid = store.userId else { return }
        do { roster = try await store.db.roster(promoterId: uid); templates = try await store.db.templates(promoterId: uid) }
        catch { loadError = "We couldn’t load your roster. Pull to try again." }
    }

    private func apply(_ t: EventTemplate) {
        r.eventName = t.eventName; r.venueName = t.venueName; r.venueLocation = t.venueLocation
        fee = t.proposedFee; r.currency = t.currency; length = t.setLengthMins ?? length; r.message = t.message ?? ""
    }

    private func send() async {
        error = nil
        guard let uid = store.userId else { return }
        if r.eventName.trimmingCharacters(in: .whitespaces).isEmpty { error = "Enter the event or show name."; return }
        if r.venueName.trimmingCharacters(in: .whitespaces).isEmpty || r.venueLocation.trimmingCharacters(in: .whitespaces).isEmpty { error = "Enter the venue name and location."; return }
        guard let fee, fee >= 0 else { error = "Enter the proposed fee."; return }
        guard let length, (5...240).contains(length) else { error = "Set length must be between 5 and 240 minutes."; return }
        if eventDate < UKDates.today() { error = "The event date can’t be in the past."; return }
        guard let deadline = Self.deadline(date: deadlineDate, time: deadlineTime), deadline > Date() else { error = "The reply-by time must be in the future."; return }
        if deadline > (Self.deadline(date: eventDate, time: r.eventTime) ?? .distantFuture) { error = "Ask for a reply before the event."; return }
        if saveTemplate, templateName.trimmingCharacters(in: .whitespaces).isEmpty { error = "Name your template."; return }
        var request = r
        request.eventDate = eventDate; request.proposedFee = fee; request.setLengthMins = length; request.responseDeadline = deadline; request.artistIds = Array(selected)
        do {
            try await store.db.createAvailabilityRequest(promoterId: uid, request)
            if saveTemplate {
                try? await store.db.createTemplate(promoterId: uid, name: templateName, eventName: request.eventName, venueName: request.venueName, venueLocation: request.venueLocation,
                                                   proposedFee: fee, currency: request.currency, setLengthMins: length, message: request.message.isEmpty ? nil : request.message)
            }
            await onSent(); sent = true
        } catch { self.error = (error as? AppError)?.message ?? "We couldn’t send that request." }
    }

    /// A UK date and clock time as an instant.
    static func deadline(date: String, time: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = UKDates.london; f.dateFormat = "yyyy-MM-dd HH:mm"
        return f.date(from: "\(date) \(String(time.prefix(5)))")
    }
}
