import SwiftUI

/// The artist's private Gig diary (a one-time purchase). Only the artist can see it.
struct GigDiaryView: View {
    @Environment(AppStore.self) private var store
    @Environment(PurchaseStore.self) private var purchases
    @State private var entries: [GigDiaryEntry] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var editing: DiaryDraftTarget?
    @State private var exportURL: URL?
    @State private var note: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if purchases.hasGigDiary { diary } else { PaywallView(feature: .gigDiary) }
            }
            .padding(20)
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task(id: purchases.hasGigDiary) { if purchases.hasGigDiary { await load() } }
        .sheet(item: $editing) { target in
            NavigationStack { DiaryEntrySheet(target: target) { await load() } }.environment(store).presentationBackground(Theme.ink)
        }
    }

    private var importable: [Booking] {
        let have = Set(entries.compactMap(\.bookingId))
        return store.bookings.filter { $0.bookingStatus == .confirmed && UKDates.daysUntil($0.eventDate) < 0 && !have.contains($0.id) }
    }

    @ViewBuilder private var diary: some View {
        Eyebrow("Private to you")
        DisplayTitle("Gig diary", size: 30)
        Text("Every show you play, what you earned and spent. Promoters never see this and it never changes how you appear.").dimBody(14)
        if let error { Banner(kind: .error, text: error) }
        if let note { Banner(kind: .success, text: note) }

        FlowLayout(spacing: 10) {
            Button { editing = DiaryDraftTarget(entry: nil, draft: DiaryDraft()) } label: { Label("Add a show", systemImage: "plus") }.buttonStyle(.app(.primary, compact: true))
            if !importable.isEmpty {
                AsyncButton(kind: .outline, compact: true) { await importShows() } label: { Text("Import \(importable.count) past show\(importable.count == 1 ? "" : "s")") }
            }
            if let exportURL { ShareLink(item: exportURL) { Label("Share CSV", systemImage: "square.and.arrow.up") }.buttonStyle(.app(.outline, compact: true)) }
            else if !entries.isEmpty { Button("Prepare CSV") { prepareExport() }.buttonStyle(.app(.outline, compact: true)) }
        }

        if !loaded { LoadingView(label: "Loading your diary…") }
        else if entries.isEmpty { EmptyState(title: "Nothing logged yet", message: "Add a show, or import the gigs you’ve played through Support Slot.") }
        ForEach(DiaryMath.byTaxYear(entries), id: \.year) { group in
            let t = DiaryMath.totals(group.entries)
            VStack(alignment: .leading, spacing: 8) {
                MonoLabel("Tax year \(group.year)")
                Card {
                    HStack(alignment: .top) {
                        total("Shows", "\(t.count)"); Spacer()
                        total("Fees", Money.pence(t.fee)); Spacer()
                        total("Expenses", Money.pence(t.expenses)); Spacer()
                        total("Net", Money.pence(t.net))
                    }
                }
                ForEach(group.entries) { e in
                    Button { editing = DiaryDraftTarget(entry: e, draft: DiaryDraft(e)) } label: { row(e) }.buttonStyle(.plain)
                }
            }
        }
        Text("This is a record for your own use, not tax advice. Check what applies to you with an accountant or HMRC.").dimBody(11)
    }

    private func total(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) { Text(value).font(Theme.body(15, weight: .medium)).foregroundStyle(Theme.paper); MonoLabel(label) }
    }

    private func row(_ e: GigDiaryEntry) -> some View {
        Card {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(e.venue).font(Theme.body(15, weight: .medium)).foregroundStyle(Theme.paper)
                    Text([UKDates.formatShowDate(e.showDate, withYear: true), e.city, e.promoter].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(Theme.body(12)).foregroundStyle(Theme.paperDim)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 3) {
                    Text(Money.pence(e.feePence)).font(Theme.mono(13)).foregroundStyle(Theme.acid)
                    if e.expensesPence > 0 { Text("−" + Money.pence(e.expensesPence)).font(Theme.mono(11)).foregroundStyle(Theme.paperDim) }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens this entry to edit")
    }

    private func load() async {
        do { entries = try await store.db.diaryEntries(); error = nil; exportURL = nil }
        catch { self.error = (error as? AppError)?.message ?? "Couldn’t load your diary." }
        loaded = true
    }

    private func importShows() async {
        guard let uid = store.userId else { return }
        var added = 0
        for b in importable {
            do { try await store.db.addDiaryEntry(artistId: uid, DiaryDraft(booking: b)); added += 1 }
            catch { self.error = (error as? AppError)?.message ?? "Couldn’t import every show."; break }
        }
        if added > 0 { note = "Imported \(added) show\(added == 1 ? "" : "s"). Add your expenses by opening an entry." }
        await load()
    }

    private func prepareExport() {
        do {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("support-slot-gig-diary.csv")
            try DiaryMath.csv(entries).write(to: url, atomically: true, encoding: .utf8)
            exportURL = url
        } catch { self.error = "Couldn’t prepare the export." }
    }
}

struct DiaryDraftTarget: Identifiable {
    let id = UUID()
    let entry: GigDiaryEntry?
    var draft: DiaryDraft
}

struct DiaryEntrySheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let target: DiaryDraftTarget
    let onSaved: () async -> Void
    @State private var draft: DiaryDraft
    @State private var error: String?
    @State private var confirmDelete = false

    init(target: DiaryDraftTarget, onSaved: @escaping () async -> Void) {
        self.target = target; self.onSaved = onSaved
        _draft = State(initialValue: target.draft)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                DisplayTitle(target.entry == nil ? "Add a show" : "Edit show", size: 26)
                LabeledField(label: "Date") { ISODatePicker(title: "Show date", iso: $draft.showDate, range: nil) }
                LabeledField(label: "Venue") { TextField("Where you played", text: $draft.venue).fieldStyle() }
                LabeledField(label: "Town or city (optional)") { TextField("e.g. Leeds", text: $draft.city).fieldStyle() }
                LabeledField(label: "Promoter (optional)") { TextField("Who booked you", text: $draft.promoter).fieldStyle() }
                HStack(spacing: 12) {
                    LabeledField(label: "Fee (£)") { TextField("150", text: $draft.fee).keyboardType(.decimalPad).fieldStyle() }
                    LabeledField(label: "Expenses (£)") { TextField("20", text: $draft.expenses).keyboardType(.decimalPad).fieldStyle() }
                }
                LabeledField(label: "Set list (optional)", hint: "\(draft.setList.count)/2000") { TextArea(text: $draft.setList, placeholder: "Songs you played", minHeight: 90) }
                LabeledField(label: "Notes (optional)", hint: "\(draft.notes.count)/2000") { TextArea(text: $draft.notes, placeholder: "How it went, gear, travel…", minHeight: 90) }
                if let error { Banner(kind: .error, text: error) }
                AsyncButton { await save() } label: { Text("Save") }
                if target.entry != nil {
                    Button("Delete this entry") { confirmDelete = true }.buttonStyle(.app(.danger, compact: true))
                }
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } } }
        .alert("Delete this entry?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { Task { await remove() } }
            Button("Keep it", role: .cancel) {}
        } message: { Text("It can’t be undone.") }
    }

    private func save() async {
        error = nil
        if let p = draft.problem { error = p; return }
        guard let uid = store.userId else { return }
        do {
            if let entry = target.entry { try await store.db.updateDiaryEntry(id: entry.id, draft) }
            else { try await store.db.addDiaryEntry(artistId: uid, draft) }
            await onSaved(); dismiss()
        } catch { self.error = (error as? AppError)?.message ?? "Couldn’t save that." }
    }

    private func remove() async {
        guard let entry = target.entry else { return }
        do { try await store.db.deleteDiaryEntry(id: entry.id); await onSaved(); dismiss() }
        catch { self.error = (error as? AppError)?.message ?? "Couldn’t delete that." }
    }
}
