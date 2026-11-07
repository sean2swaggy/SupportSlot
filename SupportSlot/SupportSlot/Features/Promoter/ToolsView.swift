import SwiftUI

/// The promoter's private organising tools. Only the owner can see any of it;
/// artists are never notified of roster changes, and nothing here ever affects
/// how an artist appears or whether they get booked.
struct ToolsView: View {
    @Environment(AppStore.self) private var store
    @State private var exportURL: URL?
    @State private var exportError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Private to you")
                    DisplayTitle("Tools", size: 34)
                    Text("Organise your shows and your artist relationships. Artists never see your roster, notes or schedules.").dimBody(14)
                }
                tool("Artist roster", "Artists you’ve saved, with notes and tags", "star") { RosterView() }
                tool("Availability requests", "Ask roster artists if they’re free before you commit", "calendar.badge.questionmark") { PromoterRequestsView() }
                tool("Request templates", "Reuse a show’s details in your next request", "doc.on.doc") { TemplatesView() }
                Card {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 14) { Image(systemName: "tablecells").font(.system(size: 18)).foregroundStyle(Theme.acid).frame(width: 28)
                            VStack(alignment: .leading, spacing: 2) { Text("Export bookings").font(Theme.body(16, weight: .medium)).foregroundStyle(Theme.paper); Text("A spreadsheet (CSV) of your bookings and the terms agreed").font(Theme.body(12)).foregroundStyle(Theme.paperDim) } }
                        if let exportURL { ShareLink(item: exportURL) { Label("Share the CSV", systemImage: "square.and.arrow.up") }.buttonStyle(.app(.primary, compact: true)) }
                        else { AsyncButton(kind: .outline, compact: true) { await export() } label: { Text("Prepare export") } }
                        FieldError(message: exportError)
                    }
                }
                Text("Show schedules live inside each listing: open it from My gigs and choose Show schedule.").dimBody(13).padding(.top, 6)
            }
            .padding(20)
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { NotificationsButton() } }
    }

    private func tool<Destination: View>(_ title: String, _ detail: String, _ icon: String, @ViewBuilder destination: @escaping () -> Destination) -> some View {
        NavigationLink { destination() } label: {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.system(size: 18)).foregroundStyle(Theme.acid).frame(width: 28)
                VStack(alignment: .leading, spacing: 2) { Text(title).font(Theme.body(16, weight: .medium)).foregroundStyle(Theme.paper); Text(detail).font(Theme.body(12)).foregroundStyle(Theme.paperDim) }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(Theme.paperDim)
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Theme.inkCard).overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1)).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    private func export() async {
        exportError = nil
        let rows = store.bookings.filter { $0.promoterId == store.userId }
        let csv = CSV.bookings(rows)
        do {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("support-slot-bookings-\(UKDates.today()).csv")
            try csv.write(to: url, atomically: true, encoding: .utf8)
            exportURL = url
        } catch { exportError = "We couldn’t build that export." }
    }
}

/// Spreadsheet-safe CSV: quoted when needed, and neutralised if a field starts with
/// a character a spreadsheet would treat as a formula (an artist's name is
/// user-typed text going into someone's Excel).
enum CSV {
    static func field(_ value: String) -> String {
        var s = value
        if let first = s.unicodeScalars.first, "=+-@\t\r".unicodeScalars.contains(first) { s = "'" + s }
        if s.contains(",") || s.contains("\"") || s.contains("\n") || s.contains("\r") { s = "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
        return s
    }

    static func pounds(_ pence: Int) -> String { String(format: "%d.%02d", pence / 100, pence % 100) }

    static func bookings(_ bookings: [Booking]) -> String {
        var lines = ["booking_id,status,artist,show,venue,city,event_date,agreed_fee_gbp,agreed_travel_gbp"]
        for b in bookings.sorted(by: { $0.eventDate > $1.eventDate }) {
            lines.append([b.id, b.status, b.artistName, b.headliner, b.venueName, b.venueCity, b.eventDate, pounds(b.feePence), pounds(b.travelPence)].map(field).joined(separator: ","))
        }
        return lines.joined(separator: "\n")
    }
}

// MARK: - Roster

struct RosterView: View {
    @Environment(AppStore.self) private var store
    @State private var entries: [RosterEntry] = []
    @State private var state: LoadState = .loading
    @State private var search = ""
    @State private var tag = ""
    @State private var editing: RosterEntry?
    enum LoadState: Equatable { case loading, loaded, failed(AppError) }

    private var allTags: [String] { Array(Set(entries.flatMap(\.tags))).sorted() }
    private var filtered: [RosterEntry] {
        let q = search.lowercased()
        return entries.filter { e in (q.isEmpty || (e.artist?.name.lowercased().contains(q) ?? false)) && (tag.isEmpty || e.tags.contains(tag)) }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Private")
                    DisplayTitle("Artist roster", size: 30)
                    Text("Artists you’ve saved from profiles. Only you can see this list — artists are never notified, and it never affects how they appear or whether they get booked.").dimBody(14)
                }
                switch state {
                case .loading where entries.isEmpty: LoadingView(label: "Loading roster…")
                case .failed(let e): ErrorState(error: e) { Task { await load() } }
                default:
                    if entries.isEmpty {
                        EmptyState(title: "Your roster is empty", message: "Open an artist’s profile and tap “Save to roster”.", actionTitle: "Discover artists") { store.selectedTab = .artists }
                    } else {
                        HStack { Image(systemName: "magnifyingglass").foregroundStyle(Theme.paperDim); TextField("Search by name", text: $search).autocorrectionDisabled() }.fieldStyle()
                        if !allTags.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    chip("All", on: tag.isEmpty) { tag = "" }
                                    ForEach(allTags, id: \.self) { t in chip(t, on: tag == t) { tag = t } }
                                }
                            }
                        }
                        if filtered.isEmpty { EmptyState(title: "No saved artists match", message: "Try a different search or tag.") }
                        ForEach(filtered) { e in
                            if let a = e.artist {
                                VStack(alignment: .leading, spacing: 10) {
                                    NavigationLink { ArtistProfileView(handle: a.handle, preloaded: a) } label: { ArtistRow(artist: a) }.buttonStyle(.plain)
                                    if !e.tags.isEmpty { FlowLayout(spacing: 6) { ForEach(e.tags, id: \.self) { Tag($0, tint: Theme.acid) } } }
                                    if !e.notes.isEmpty { Text(e.notes).dimBody(14) }
                                    Button("Notes, tags & history") { editing = e }.buttonStyle(.app(.outline, compact: true))
                                }
                            }
                        }
                    }
                }
            }
            .padding(20)
        }
        .refreshable { await load() }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $editing) { e in NavigationStack { RosterEntryEditor(entry: e) { await load() } }.environment(store).presentationBackground(Theme.ink) }
    }

    private func chip(_ text: String, on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text.uppercased()).font(Theme.mono(11)).tracking(1).foregroundStyle(on ? Theme.acidInk : Theme.paper).padding(.horizontal, 12).frame(minHeight: 36)
                .background(on ? Theme.acid : .clear).overlay(Rectangle().stroke(on ? Theme.acid : Theme.inkBorder, lineWidth: 1))
        }.buttonStyle(.plain).accessibilityAddTraits(on ? .isSelected : [])
    }

    private func load() async {
        guard let uid = store.userId else { return }
        do { entries = try await store.db.roster(promoterId: uid); state = .loaded }
        catch is CancellationError {}
        catch { if entries.isEmpty { state = .failed((error as? AppError) ?? .generic()) } }
    }
}

struct RosterEntryEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let entry: RosterEntry
    var onChanged: () async -> Void
    @State private var notes: String
    @State private var tags: [String]
    @State private var newTag = ""
    @State private var history: [Application] = []
    @State private var error: String?
    @State private var confirmRemove = false

    init(entry: RosterEntry, onChanged: @escaping () async -> Void) {
        self.entry = entry; self.onChanged = onChanged
        _notes = State(initialValue: entry.notes); _tags = State(initialValue: entry.tags)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                DisplayTitle(entry.artist?.name ?? "Artist", size: 28)
                LabeledField(label: "Private notes", hint: "Only you can see these.") { TextArea(text: $notes, placeholder: "What you thought of them live, how they were to work with…", minHeight: 110) }
                LabeledField(label: "Tags") {
                    VStack(alignment: .leading, spacing: 10) {
                        FlowLayout(spacing: 6) { ForEach(tags, id: \.self) { t in Button { tags.removeAll { $0 == t } } label: { Tag("\(t)  ✕", tint: Theme.acid) }.buttonStyle(.plain).accessibilityLabel("Remove tag \(t)") } }
                        HStack { TextField("Add a tag", text: $newTag).fieldStyle().submitLabel(.done).onSubmit(addTag); Button("Add", action: addTag).buttonStyle(.app(.outline, compact: true)).frame(width: 90) }
                    }
                }
                if let error { Banner(kind: .error, text: error) }
                AsyncButton { await save() } label: { Text("Save") }

                if !history.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        MonoLabel("Your history with them")
                        ForEach(history) { a in
                            HStack { Text(a.slot?.headliner ?? "A listing").font(Theme.body(14)).foregroundStyle(Theme.paper); Spacer(); StatusPill(status: a.applicationStatus) }
                                .padding(12).overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
                        }
                    }
                }
                Button("Remove from roster") { confirmRemove = true }.buttonStyle(.appDanger)
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } } }
        .task { if let id = entry.artist?.id { history = (try? await store.db.history(withArtist: id)) ?? [] } }
        .alert("Remove from your roster?", isPresented: $confirmRemove) {
            Button("Remove", role: .destructive) { Task { await remove() } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("They aren’t told.") }
    }

    private func addTag() {
        let t = newTag.trimmingCharacters(in: .whitespaces).lowercased()
        if !t.isEmpty, !tags.contains(t), tags.count < 12 { tags.append(t) }
        newTag = ""
    }
    private func save() async {
        error = nil
        do { try await store.db.updateRosterEntry(entryId: entry.id, notes: notes, tags: tags); await onChanged(); dismiss() }
        catch { self.error = (error as? AppError)?.message ?? "Couldn’t save that." }
    }
    private func remove() async {
        do { try await store.db.removeFromRoster(entryId: entry.id); await onChanged(); dismiss() }
        catch { self.error = (error as? AppError)?.message ?? "Couldn’t remove them." }
    }
}

// MARK: - Templates

struct TemplatesView: View {
    @Environment(AppStore.self) private var store
    @State private var templates: [EventTemplate] = []
    @State private var state: Roster = .loading
    @State private var error: String?
    enum Roster: Equatable { case loading, loaded, failed(AppError) }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) { Eyebrow("Private"); DisplayTitle("Request templates", size: 30)
                    Text("Save a show’s details once and reuse them when you ask artists about availability. Templates are made while composing a request.").dimBody(14) }
                switch state {
                case .loading where templates.isEmpty: LoadingView()
                case .failed(let e): ErrorState(error: e) { Task { await load() } }
                default:
                    if templates.isEmpty { EmptyState(title: "No templates yet", message: "When you send an availability request, tick “Save as a template”.") }
                    ForEach(templates) { t in
                        Card {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(t.name).font(Theme.display(18)).foregroundStyle(Theme.paper)
                                Text([t.eventName, t.venueName, t.venueLocation].filter { !$0.isEmpty }.joined(separator: " · ")).dimBody(13)
                                if let fee = t.proposedFee { Text("\(t.currency) \(fee)" + (t.setLengthMins.map { " · \($0) min set" } ?? "")).font(Theme.mono(12)).foregroundStyle(Theme.acid) }
                                AsyncButton(kind: .danger, compact: true) { await delete(t) } label: { Text("Delete") }.frame(width: 140)
                            }
                        }
                    }
                    if let error { Banner(kind: .error, text: error) }
                }
            }
            .padding(20)
        }
        .refreshable { await load() }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        guard let uid = store.userId else { return }
        do { templates = try await store.db.templates(promoterId: uid); state = .loaded }
        catch is CancellationError {}
        catch { if templates.isEmpty { state = .failed((error as? AppError) ?? .generic()) } }
    }
    private func delete(_ t: EventTemplate) async {
        error = nil
        do { try await store.db.deleteTemplate(id: t.id); await load() } catch { self.error = (error as? AppError)?.message }
    }
}
