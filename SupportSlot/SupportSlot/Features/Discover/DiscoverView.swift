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

    init(urgentOnly: Bool = false) {
        var f = SlotFilters()
        f.urgentOnly = urgentOnly
        _filters = State(initialValue: f)
    }

    private var artistCity: String? { store.role == .artist ? store.artist?.location : nil }
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
                         : "Browse slots by city, genre, date and fee. Applying is always free.").dimBody(14)
                }

                filterBar

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
                            NavigationLink(value: slot) { SlotCard(slot: slot) }
                                .buttonStyle(.plain)
                                .onAppear {
                                    if slot.id == model.slots.last?.id { Task { await model.loadMore(db: store.db, filters: filters, artistCity: artistCity) } }
                                }
                        }
                        if model.loadingMore { LoadingView(label: "Loading more…") }
                        if let e = model.loadMoreError {
                            ErrorState(error: e) { Task { await model.loadMore(db: store.db, filters: filters, artistCity: artistCity) } }
                        }
                    }
                }
            }
            .padding(20)
        }
        .refreshable { await reload() }
        .screenBackground()
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Slot.self) { SlotDetailView(slotId: $0.id, preloaded: $0) }
        .sheet(isPresented: $showFilters) {
            NavigationStack { FilterSheet(filters: $filters, canFilterByDistance: artistCity != nil) }
                .presentationDetents([.large]).presentationBackground(Theme.ink)
        }
        .task(id: key) { await reload() }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { if store.isSignedIn { NotificationsButton() } } }
    }

    private var filterBar: some View {
        HStack(spacing: 10) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.paperDim)
                TextField("Search headliner, venue, city…", text: $searchText)
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

    private func reload() async {
        await model.reload(db: store.db, filters: filters, artistCity: artistCity)
    }
}

struct FilterSheet: View {
    @Binding var filters: SlotFilters
    var canFilterByDistance: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                menu("Where", selection: Binding(get: { filters.city ?? "" }, set: { filters.city = $0.isEmpty ? nil : $0 }),
                     options: [("", "Any location")] + Catalog.cities.map { ($0, $0) })
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
                if canFilterByDistance {
                    menu("Distance from you", selection: Binding(get: { filters.distance.map(String.init) ?? "" }, set: { filters.distance = Int($0) }),
                         options: [("", "Any distance")] + SlotFilters.distanceOptions.map { (String($0), "Within \($0) miles") })
                }
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
