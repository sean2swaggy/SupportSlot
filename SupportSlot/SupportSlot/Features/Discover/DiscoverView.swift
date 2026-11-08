import SwiftUI

/// Public gig discovery. Works signed out: searching, filtering, sorting and
/// paging happen in one server-side query. Closed, filled, cancelled and past
/// listings never appear. For artists each listing also explains how it fits
/// their profile (information only — never a ranking that affects booking).
struct DiscoverView: View {
    @Environment(AppStore.self) private var store
    @State private var model = DiscoverModel()
    @State private var filters: SlotFilters
    @State private var searchText = ""
    @State private var showFilters = false
    @State private var showMap = false
    @State private var savingSearch = false
    @State private var searchName = ""
    @State private var saveNote: String?

    init(urgentOnly: Bool = false) {
        var f = SlotFilters()
        f.urgentOnly = urgentOnly
        _filters = State(initialValue: f)
    }

    /// The artist's own private position, used only when they ask for "near my base".
    private var base: Coordinate? { store.role == .artist ? store.myCoordinate : nil }
    private var title: String { filters.urgentOnly ? "Needed tonight" : "Support opportunities" }
    private var key: SlotFilters { filters }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow(filters.urgentOnly ? "Last-minute support" : "Find a slot")
                    DisplayTitle(title, size: 32)
                    Text(filters.urgentOnly
                         ? "Promoters who need a support act at short notice. Turn on last-minute alerts in your profile to hear about these first."
                         : "Browse slots anywhere in the UK by place, genre, date and fee. Applying is always free.").dimBody(14)
                }

                filterBar
                if !model.slots.isEmpty {
                    Button { showMap = true } label: { Label("Show on map", systemImage: "map") }.buttonStyle(.app(.outline, compact: true))
                }
                if canSaveSearch { saveSearchBar }

                switch model.status {
                case .idle where model.slots.isEmpty, .loading where model.slots.isEmpty:
                    LoadingView(label: "Finding listings…")
                case .failed(let error):
                    ErrorState(error: error) { Task { await reload() } }
                default:
                    if model.slots.isEmpty {
                        EmptyState(title: filters.isFiltering ? "No listings match" : (filters.urgentOnly ? "Nothing needed tonight" : "No open listings yet"),
                                   message: filters.isFiltering ? "Try widening your search or clearing a filter." : "Check back soon.",
                                   actionTitle: filters.isFiltering ? "Clear filters" : nil,
                                   action: filters.isFiltering ? { filters.clear(); searchText = "" } : nil)
                    } else {
                        Text("\(model.total) listing\(model.total == 1 ? "" : "s")").font(Theme.mono(11)).foregroundStyle(Theme.paperDim).textCase(.uppercase)
                        ForEach(model.slots) { slot in
                            NavigationLink(value: slot) { SlotCard(slot: slot, distanceMiles: model.distances[slot.id]) }
                                .buttonStyle(.plain)
                                .onAppear {
                                    if slot.id == model.slots.last?.id { Task { await model.loadMore(db: store.db, filters: filters, base: base) } }
                                }
                        }
                        if model.loadingMore { LoadingView(label: "Loading more…") }
                        if let e = model.loadMoreError {
                            ErrorState(error: e) { Task { await model.loadMore(db: store.db, filters: filters, base: base) } }
                        }
                    }
                }
            }
            .padding(20)
        }
        .refreshable { await reload() }
        .sheet(isPresented: $showMap) { SlotMapView(slots: model.slots).environment(store) }
        .screenBackground()
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Slot.self) { SlotDetailView(slotId: $0.id, preloaded: $0) }
        .sheet(isPresented: $showFilters) {
            NavigationStack { FilterSheet(filters: $filters, baseLabel: store.role == .artist && base != nil ? store.artist?.location : nil) }
                .presentationDetents([.large]).presentationBackground(Theme.ink)
        }
        .task(id: key) { await reload() }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { if store.isSignedIn { NotificationsButton() } } }
    }

    private var filterBar: some View {
        HStack(spacing: 10) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.paperDim)
                TextField("Search headliner, venue, town…", text: $searchText)
                    .submitLabel(.search)
                    .onSubmit { filters.query = searchText }
                    .autocorrectionDisabled()
                if !searchText.isEmpty {
                    Button { searchText = ""; filters.query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.paperDim) }
                        .accessibilityLabel("Clear search")
                }
            }
            .fieldStyle()
            Button { showFilters = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: "slider.horizontal.3")
                    if filters.activeCount > 0 { Text("\(filters.activeCount)").font(Theme.mono(11, weight: .bold)) }
                }
                .foregroundStyle(filters.activeCount > 0 ? Theme.acidInk : Theme.paper)
                .padding(.horizontal, 14).frame(minHeight: 48)
                .background(filters.activeCount > 0 ? Theme.acid : .clear)
                .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
            }
            .accessibilityLabel(filters.activeCount > 0 ? "Filters, \(filters.activeCount) active" : "Filters")
        }
    }

    /// A search can be saved when an artist has chosen a genre, or a distance from their own base.
    private var canSaveSearch: Bool { store.role == .artist && (filters.genre != nil || (filters.distance != nil && filters.nearMyBase && base != nil)) }

    private var saveSearchBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { searchName = suggestedName; savingSearch = true } label: { Label("Save this search", systemImage: "bell.badge") }
                .buttonStyle(.app(.outline, compact: true))
            if let saveNote { Text(saveNote).font(Theme.body(12)).foregroundStyle(Theme.paperDim) }
        }
        .alert("Save this search", isPresented: $savingSearch) {
            TextField("Name", text: $searchName)
            Button("Save") { Task { await saveSearch() } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("We’ll tell you in the app when a new slot matches.") }
    }

    private var suggestedName: String {
        [filters.genre, filters.distance.map { "within \($0) mi" }].compactMap { $0 }.joined(separator: ", ")
    }

    private func saveSearch() async {
        let name = searchName.trimmingCharacters(in: .whitespaces)
        do {
            try await store.db.saveSearch(label: name.isEmpty ? suggestedName : name, genres: filters.genre.map { [$0] } ?? [],
                                          maxMiles: (filters.nearMyBase && base != nil) ? filters.distance : nil)
            saveNote = "Saved. Manage your searches in Me → Saved searches."
        } catch { saveNote = (error as? AppError)?.message ?? "Couldn’t save that search." }
    }

    private func reload() async {
        await model.reload(db: store.db, filters: filters, base: base)
    }
}

struct FilterSheet: View {
    @Binding var filters: SlotFilters
    /// The artist's base place name, when they have a private map position to measure from.
    var baseLabel: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                menu("Nation", selection: Binding(get: { filters.country?.rawValue ?? "" }, set: { filters.country = UKNation(rawValue: $0) }),
                     options: [("", "Anywhere in the UK")] + UKNation.allCases.map { ($0.rawValue, $0.rawValue) })
                nearSection
                menu("Genre", selection: Binding(get: { filters.genre ?? "" }, set: { filters.genre = $0.isEmpty ? nil : $0 }),
                     options: [("", "Any genre")] + Catalog.genres.map { ($0, $0) })
                menu("When", selection: Binding(get: { filters.when.rawValue }, set: { filters.when = SlotFilters.When(rawValue: $0) ?? .any }),
                     options: SlotFilters.When.allCases.map { ($0.rawValue, $0.label) })
                menu("Pay", selection: Binding(get: { filters.minPay.map(String.init) ?? "" }, set: { filters.minPay = Int($0) }),
                     options: [("", "Any pay")] + SlotFilters.payOptions.map { (String($0), "£\($0)+") })
                menu("Venue", selection: Binding(get: { filters.venueSize.rawValue }, set: { filters.venueSize = SlotFilters.VenueSize(rawValue: $0) ?? .any }),
                     options: SlotFilters.VenueSize.allCases.map { ($0.rawValue, $0.label) })
                menu("Artist size", selection: Binding(get: { filters.artistSize ?? "" }, set: { filters.artistSize = $0.isEmpty ? nil : $0 }),
                     options: [("", "Any artist size")] + Catalog.artistSizes.map { ($0, Catalog.artistSizeLabel($0)) })
                menu("Sort", selection: Binding(get: { filters.sort.rawValue }, set: { filters.sort = SlotFilters.Sort(rawValue: $0) ?? .date }),
                     options: SlotFilters.Sort.allCases.map { ($0.rawValue, $0.label) })
                HStack(spacing: 12) {
                    Button("Clear all") { filters.clear() }.buttonStyle(.appOutline)
                    Button("Show results") { dismiss() }.buttonStyle(.appPrimary)
                }
            }
            .padding(20)
        }
        .screenBackground()
        .navigationTitle("Filters")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
    }

    @ViewBuilder private var nearSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            PlaceField(label: "Near (optional)", place: Binding(get: { filters.near }, set: { filters.near = $0; if $0 != nil { filters.nearMyBase = false; if filters.distance == nil { filters.distance = 25 } } }),
                       hint: "Pick a town or city to search around. Distances are straight-line miles, not journey times.")
            if let baseLabel {
                TapToggle(isOn: Binding(get: { filters.nearMyBase }, set: { filters.nearMyBase = $0; if $0 { filters.near = nil; if filters.distance == nil { filters.distance = 25 } } })) {
                    Text("Near my base (\(baseLabel))").font(Theme.body(15)).foregroundStyle(Theme.paper)
                }
            }
            if filters.near != nil || filters.nearMyBase {
                menu("Within", selection: Binding(get: { filters.distance.map(String.init) ?? "" }, set: { filters.distance = Int($0) }),
                     options: [("", "Any distance")] + SlotFilters.distanceOptions.map { (String($0), "\($0) miles") })
                if let near = filters.near, !near.hasCoordinates {
                    Banner(kind: .info, text: "“\(near.label)” was typed in, so it has no map position and can’t be used for distance. Choose it from the search instead.")
                }
                Button("Clear location") { filters.near = nil; filters.nearMyBase = false; filters.distance = nil }.buttonStyle(.app(.outline, compact: true))
            }
        }
    }

    private func menu(_ label: String, selection: Binding<String>, options: [(String, String)]) -> some View {
        LabeledField(label: label) {
            Menu {
                Picker(label, selection: selection) { ForEach(options, id: \.0) { Text($0.1).tag($0.0) } }
            } label: {
                HStack {
                    Text(options.first { $0.0 == selection.wrappedValue }?.1 ?? options.first?.1 ?? "").foregroundStyle(Theme.paper)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").foregroundStyle(Theme.paperDim)
                }
                .fieldStyle()
            }
            .accessibilityLabel("\(label), \(options.first { $0.0 == selection.wrappedValue }?.1 ?? "")")
        }
    }
}
