import SwiftUI

/// A private running order for one show: arrival, load-in, soundcheck, doors,
/// performances, changeovers and breaks, across one or more stages. Only the
/// promoter who owns the listing can see it; nothing here is ever visible to
/// artists, sends a notification, or changes a booking.
struct ShowScheduleView: View {
    @Environment(AppStore.self) private var store
    let slot: Slot

    @State private var schedule: ShowSchedule?
    @State private var entries: [ScheduleEntry] = []
    @State private var artists: [Artist] = []
    @State private var cancelledArtists: Set<ID> = []
    @State private var templates: [ScheduleTemplate] = []
    @State private var loadError: AppError?
    @State private var viewStage: String?          // nil = all stages (time-ordered overview)
    @State private var newStages: [String] = []
    @State private var editing: EditTarget?
    @State private var error: String?
    @State private var conflictNotice = false
    @State private var saving = false
    @State private var saveTemplateName = ""
    @State private var showSaveTemplate = false
    @State private var addingStage = false
    @State private var stageName = ""

    private struct EditTarget: Identifiable { let id = UUID(); let entry: ScheduleEntry? }

    private var stages: [String] {
        var s = ScheduleRules.stages(of: entries)
        for n in newStages where !s.contains(n) { s.append(n) }
        return s
    }
    private var shown: [ScheduleEntry] { viewStage.map { ScheduleRules.entries(entries, onStage: $0) } ?? ScheduleRules.combinedTimeline(entries) }
    private var conflicts: [ScheduleRules.Conflict] { ScheduleRules.allConflicts(entries) }
    private var unscheduled: [Artist] { artists.filter { a in !entries.contains { $0.artistId == a.id } } }

    var body: some View {
        ScrollView {
            if let schedule {
                VStack(alignment: .leading, spacing: 18) {
                    header(schedule)
                    if conflictNotice {
                        Banner(kind: .error, text: "This schedule was changed somewhere else, so your edit wasn’t saved. It has been reloaded — please make the change again.")
                    }
                    if let error { Banner(kind: .error, text: error) }
                    stagePicker
                    if !conflicts.isEmpty { conflictsView }
                    list
                    Button { editing = EditTarget(entry: nil) } label: { Label("Add entry", systemImage: "plus") }.buttonStyle(.appPrimary)
                    if !unscheduled.isEmpty {
                        Card {
                            VStack(alignment: .leading, spacing: 8) {
                                MonoLabel("Booked artists not on the schedule yet")
                                FlowLayout(spacing: 6) { ForEach(unscheduled) { Tag($0.name, tint: Theme.acid) } }
                            }
                        }
                    }
                    templatesSection
                }
                .padding(20)
            } else if let loadError {
                ErrorState(error: loadError) { Task { await load() } }.padding(20)
            } else {
                LoadingView(label: "Loading schedule…").padding(.top, 60)
            }
        }
        .refreshable { await load() }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $editing) { target in
            NavigationStack { EntryEditor(slot: slot, entry: target.entry, stages: stages, artists: artists, defaultStage: viewStage ?? stages.first ?? ScheduleRules.defaultStage,
                                          nextOrder: { ScheduleRules.nextSortOrder(entries, stage: $0) }) { draft in await save(draft, editing: target.entry) } }
                .environment(store).presentationBackground(Theme.ink)
        }
        .alert("Save as template", isPresented: $showSaveTemplate) {
            TextField("Template name", text: $saveTemplateName)
            Button("Save") { Task { await saveTemplate() } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Saves the structure only — no artists, notes or dates.") }
        .alert("New stage", isPresented: $addingStage) {
            TextField("Stage name", text: $stageName)
            Button("Add") { let n = stageName.trimmingCharacters(in: .whitespaces); if !n.isEmpty, !stages.contains(n) { newStages.append(n); viewStage = n }; stageName = "" }
            Button("Cancel", role: .cancel) {}
        }
    }

    // MARK: Sections

    private func header(_ s: ShowSchedule) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow("Private to you")
            DisplayTitle("Show schedule", size: 30)
            Text("\(slot.headliner) · \(UKDates.formatShowDate(slot.date, withYear: true))").dimBody(14)
            HStack(spacing: 8) {
                Tag(s.status == "final" ? "Final" : "Draft", tint: s.status == "final" ? Theme.ok : Theme.paperDim)
                AsyncButton(kind: .outline, compact: true) { await toggleStatus(s) } label: { Text(s.status == "final" ? "Back to draft" : "Mark as final") }.frame(width: 190)
            }
            Text("“Final” is just a label for your own planning. It never notifies an artist or changes a booking.").font(Theme.body(12)).foregroundStyle(Theme.paperDim)
        }
    }

    private var stagePicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("All stages", on: viewStage == nil) { viewStage = nil }
                ForEach(stages, id: \.self) { s in chip(s, on: viewStage == s) { viewStage = s } }
                Button { addingStage = true } label: { Label("Stage", systemImage: "plus").font(Theme.mono(11)).textCase(.uppercase) }.buttonStyle(.app(.outline, compact: true)).frame(width: 110)
            }
        }
    }

    private func chip(_ text: String, on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text.uppercased()).font(Theme.mono(11)).tracking(1).foregroundStyle(on ? Theme.acidInk : Theme.paper).padding(.horizontal, 12).frame(minHeight: 38)
                .background(on ? Theme.acid : .clear).overlay(Rectangle().stroke(on ? Theme.acid : Theme.inkBorder, lineWidth: 1))
        }.buttonStyle(.plain).accessibilityAddTraits(on ? .isSelected : [])
    }

    private var conflictsView: some View {
        VStack(alignment: .leading, spacing: 6) {
            MonoLabel("Things to check", color: Theme.signal)
            ForEach(conflicts) { c in Text("• \(c.message)").font(Theme.body(13)).foregroundStyle(Theme.paper) }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading).background(Theme.signal.opacity(0.08)).overlay(Rectangle().stroke(Theme.signal.opacity(0.5), lineWidth: 1))
    }

    @ViewBuilder private var list: some View {
        if shown.isEmpty {
            EmptyState(title: "Nothing scheduled yet", message: "Add arrival, load-in, soundcheck, doors, sets and changeovers — or start from a template below.")
        } else {
            VStack(spacing: 10) {
                ForEach(shown) { e in entryRow(e) }
            }
            if viewStage == nil { Text("The overview is ordered by start time. Choose a stage to reorder its running order.").font(Theme.body(12)).foregroundStyle(Theme.paperDim) }
        }
    }

    private func entryRow(_ e: ScheduleEntry) -> some View {
        let artist = artists.first { $0.id == e.artistId }
        let flagged = e.artistId.map { cancelledArtists.contains($0) } ?? false
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) { Tag(e.scheduleKind.label, tint: Theme.acid); if viewStage == nil { Tag(e.stage) } }
                    Text(e.title).font(Theme.display(18)).foregroundStyle(Theme.paper)
                    HStack(spacing: 6) {
                        Text("\(ScheduleRules.time(e.startAt)) – \(ScheduleRules.time(e.endAt))").font(Theme.mono(13)).foregroundStyle(Theme.paper)
                        if ScheduleRules.crossesIntoNextDay(e.startAt, eventDate: slot.date) { Tag("\(ScheduleRules.dayLabel(e.startAt))", tint: Theme.signal) }
                        else if ScheduleRules.crossesIntoNextDay(e.endAt, eventDate: slot.date) { Tag("ends \(ScheduleRules.dayLabel(e.endAt))", tint: Theme.signal) }
                    }
                }
                Spacer()
                Menu {
                    Button { editing = EditTarget(entry: e) } label: { Label("Edit", systemImage: "pencil") }
                    Button { Task { await save(ScheduleRules.duplicate(e), editing: nil) } } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
                    if viewStage != nil {
                        Button { Task { await move(e, up: true) } } label: { Label("Move up", systemImage: "arrow.up") }
                        Button { Task { await move(e, up: false) } } label: { Label("Move down", systemImage: "arrow.down") }
                    }
                    Button(role: .destructive) { Task { await remove(e) } } label: { Label("Delete", systemImage: "trash") }
                } label: { Image(systemName: "ellipsis.circle").font(.system(size: 20)).foregroundStyle(Theme.paper).frame(width: 44, height: 44) }
                .accessibilityLabel("Actions for \(e.title)")
            }
            if let artist { Label(artist.name, systemImage: "music.mic").font(Theme.body(14)).foregroundStyle(Theme.paper) }
            if flagged { Text("This artist’s booking was cancelled — review this entry.").font(Theme.body(12)).foregroundStyle(Theme.signal) }
            if !e.notes.isEmpty { Text(e.notes).font(Theme.body(13)).foregroundStyle(Theme.paperDim) }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading).background(Theme.inkCard).overlay(Rectangle().stroke(flagged ? Theme.signal.opacity(0.6) : Theme.inkBorder, lineWidth: 1))
    }

    private var templatesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            MonoLabel("Templates")
            if !templates.isEmpty {
                ForEach(templates) { t in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) { Text(t.name).font(Theme.body(15, weight: .medium)).foregroundStyle(Theme.paper); Text("\(t.entries.count) items").font(Theme.body(12)).foregroundStyle(Theme.paperDim) }
                        Spacer()
                        Menu {
                            Button { Task { await apply(t) } } label: { Label("Add to this schedule", systemImage: "square.and.arrow.down") }
                            Button(role: .destructive) { Task { await deleteTemplate(t) } } label: { Label("Delete template", systemImage: "trash") }
                        } label: { Text("Use").font(Theme.mono(11)).textCase(.uppercase).foregroundStyle(Theme.paper).padding(.horizontal, 14).frame(minHeight: 40).overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1)) }
                    }
                }
            } else { Text("No templates yet.").dimBody(13) }
            if !entries.isEmpty { Button("Save this schedule as a template") { saveTemplateName = ""; showSaveTemplate = true }.buttonStyle(.app(.outline, compact: true)) }
            Text("Applying a template adds its items starting from your doors time. It never copies artists, notes or dates from another show.").font(Theme.body(12)).foregroundStyle(Theme.paperDim)
        }
    }

    // MARK: Loading and saving

    private func load() async {
        guard let uid = store.userId else { return }
        do {
            guard let s = try await store.db.schedule(slotId: slot.id, promoterId: uid) else { loadError = AppError("This schedule isn’t available."); return }
            schedule = s
            entries = try await store.db.scheduleEntries(scheduleId: s.id)
            async let a = store.db.confirmedArtists(slotId: slot.id)
            async let c = store.db.cancelledArtistIDs(slotId: slot.id)
            async let t = store.db.scheduleTemplates(promoterId: uid)
            (artists, cancelledArtists, templates) = try await (a, c, t)
            loadError = nil
        } catch is CancellationError {
        } catch { if schedule == nil { loadError = (error as? AppError) ?? .generic() } }
    }

    /// Runs one write with the current version. A lost race reloads and tells the person.
    private func write(_ work: (ShowSchedule) async throws -> Int) async -> String? {
        guard let s = schedule else { return "The schedule isn’t loaded." }
        error = nil; conflictNotice = false
        do {
            let version = try await work(s)
            schedule = ShowSchedule(id: s.id, slotId: s.slotId, promoterId: s.promoterId, status: s.status, version: version, updatedAt: Date())
            entries = try await store.db.scheduleEntries(scheduleId: s.id)
            return nil
        } catch is ScheduleStale {
            conflictNotice = true
            await load()
            return "stale"
        } catch {
            let m = (error as? AppError)?.message ?? "Couldn’t save that change."
            self.error = m
            return m
        }
    }

    private func save(_ draft: ScheduleEntryDraft, editing existing: ScheduleEntry?) async -> String? {
        await write { s in
            if let existing { return try await store.db.updateScheduleEntry(scheduleId: s.id, version: s.version, entryId: existing.id, draft) }
            return try await store.db.addScheduleEntry(scheduleId: s.id, version: s.version, draft)
        }
    }

    private func remove(_ e: ScheduleEntry) async { _ = await write { s in try await store.db.deleteScheduleEntry(scheduleId: s.id, version: s.version, entryId: e.id) } }

    private func move(_ e: ScheduleEntry, up: Bool) async {
        guard let pairs = ScheduleRules.reorder(entries, stage: e.stage, entryId: e.id, up: up) else { return }
        _ = await write { s in try await store.db.reorderScheduleEntries(scheduleId: s.id, version: s.version, pairs: pairs) }
    }

    private func toggleStatus(_ s: ShowSchedule) async {
        let next = s.status == "final" ? "draft" : "final"
        if await write({ cur in try await store.db.setScheduleStatus(scheduleId: cur.id, version: cur.version, status: next) }) == nil, let cur = schedule {
            schedule = ShowSchedule(id: cur.id, slotId: cur.slotId, promoterId: cur.promoterId, status: next, version: cur.version, updatedAt: cur.updatedAt)
        }
    }

    private func apply(_ t: ScheduleTemplate) async {
        let anchor = "\(slot.date)T\(slot.doors):00"
        let drafts = ScheduleRules.apply(t, anchorStart: anchor)
        _ = await write { s in try await store.db.applyScheduleTemplate(scheduleId: s.id, version: s.version, entries: drafts) }
    }

    private func saveTemplate() async {
        guard let uid = store.userId else { return }
        let name = saveTemplateName.trimmingCharacters(in: .whitespaces)
        if name.isEmpty { error = "Name your template."; return }
        do { try await store.db.saveScheduleTemplate(promoterId: uid, name: name, entries: ScheduleRules.captureTemplate(entries)); templates = try await store.db.scheduleTemplates(promoterId: uid) }
        catch { self.error = (error as? AppError)?.message ?? "Couldn’t save that template." }
    }

    private func deleteTemplate(_ t: ScheduleTemplate) async {
        do { try await store.db.deleteScheduleTemplate(id: t.id); templates.removeAll { $0.id == t.id } }
        catch { self.error = (error as? AppError)?.message ?? "Couldn’t delete that template." }
    }
}

/// Add or edit one schedule entry.
private struct EntryEditor: View {
    @Environment(\.dismiss) private var dismiss
    let slot: Slot
    let entry: ScheduleEntry?
    let stages: [String]
    let artists: [Artist]
    let defaultStage: String
    let nextOrder: (String) -> Int
    let onSave: (ScheduleEntryDraft) async -> String?

    @State private var draft = ScheduleEntryDraft()
    @State private var newStage = ""
    @State private var error: String?
    @State private var seeded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                DisplayTitle(entry == nil ? "Add entry" : "Edit entry", size: 26)
                LabeledField(label: "Type") {
                    Menu { Picker("Type", selection: $draft.kind) { ForEach(ScheduleKind.allCases) { Text($0.label).tag($0) } } } label: {
                        HStack { Text(draft.kind.label).foregroundStyle(Theme.paper); Spacer(); Image(systemName: "chevron.up.chevron.down").foregroundStyle(Theme.paperDim) }.fieldStyle()
                    }
                }
                LabeledField(label: "Title") { TextField("e.g. Support set", text: $draft.title).fieldStyle() }
                LabeledField(label: "Stage") {
                    Menu { Picker("Stage", selection: $draft.stage) { ForEach(stages, id: \.self) { Text($0).tag($0) } } } label: {
                        HStack { Text(draft.stage).foregroundStyle(Theme.paper); Spacer(); Image(systemName: "chevron.up.chevron.down").foregroundStyle(Theme.paperDim) }.fieldStyle()
                    }
                }
                LabeledField(label: "Starts") { NaiveDateTimePicker(title: "Starts", value: $draft.startAt) }
                LabeledField(label: "Ends", hint: "Can be after midnight.") { NaiveDateTimePicker(title: "Ends", value: $draft.endAt) }
                if !artists.isEmpty {
                    LabeledField(label: "Assigned artist (booked artists only)") {
                        Menu {
                            Picker("Artist", selection: Binding(get: { draft.artistId ?? "" }, set: { draft.artistId = $0.isEmpty ? nil : $0 })) {
                                Text("No artist").tag(""); ForEach(artists) { Text($0.name).tag($0.id) }
                            }
                        } label: { HStack { Text(artists.first { $0.id == draft.artistId }?.name ?? "No artist").foregroundStyle(Theme.paper); Spacer(); Image(systemName: "chevron.up.chevron.down").foregroundStyle(Theme.paperDim) }.fieldStyle() }
                    }
                }
                LabeledField(label: "Private notes") { TextArea(text: $draft.notes, placeholder: "Only you see these", minHeight: 80) }
                if let error { Banner(kind: .error, text: error) }
                HStack(spacing: 12) {
                    Button("Cancel") { dismiss() }.buttonStyle(.appOutline)
                    AsyncButton { await save() } label: { Text("Save") }
                }
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            guard !seeded else { return }
            seeded = true
            if let e = entry {
                draft = ScheduleEntryDraft(kind: e.scheduleKind, title: e.title, stage: e.stage, startAt: e.startAt, endAt: e.endAt, artistId: e.artistId, notes: e.notes, sortOrder: e.sortOrder)
            } else {
                draft.stage = defaultStage
                draft.startAt = "\(slot.date)T\(slot.onStage):00"
                draft.endAt = ScheduleRules.format((ScheduleRules.parse(draft.startAt) ?? 0) + TimeInterval(slot.performanceLengthMins * 60))
                draft.sortOrder = nextOrder(defaultStage)
            }
        }
    }

    private func save() async {
        error = nil
        if draft.title.trimmingCharacters(in: .whitespaces).isEmpty { error = "Give this entry a title."; return }
        if let problem = ScheduleRules.timesError(start: draft.startAt, end: draft.endAt) { error = problem; return }
        if entry == nil { draft.sortOrder = nextOrder(draft.stage) }
        if let failure = await onSave(draft) { if failure != "stale" { error = failure }; if failure == "stale" { dismiss() } } else { dismiss() }
    }
}

/// A date-and-time picker for a naive Europe/London wall-clock string.
struct NaiveDateTimePicker: View {
    let title: String
    @Binding var value: String

    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = UKDates.london; f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return f
    }()

    var body: some View {
        DatePicker(title, selection: Binding(
            get: { Self.formatter.date(from: value) ?? Date() },
            set: { value = Self.formatter.string(from: $0) }
        ), displayedComponents: [.date, .hourAndMinute])
        .labelsHidden().colorScheme(.dark)
        .environment(\.timeZone, UKDates.london)
        .padding(.horizontal, 14).frame(minHeight: 48, alignment: .leading).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.inkRaised).overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
        .accessibilityLabel(title)
    }
}
