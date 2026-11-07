import SwiftUI
import MapKit

/// Choose a real place anywhere in the UK: search, "use my current location"
/// (only if you tap it), or type it in. Typed places have no coordinates, which
/// is said plainly — they just can't be used for radius search.
struct PlacePicker: View {
    enum Mode { case town, venue }

    @Environment(\.dismiss) private var dismiss
    let mode: Mode
    let title: String
    let onPick: (PlaceResult) -> Void

    @State private var search = PlaceSearchService()
    @State private var finder = CurrentLocationFinder()
    @State private var message: String?
    @State private var showManual = false
    @State private var manualName = ""
    @State private var manualRegion = ""
    @State private var manualNation: UKNation = .england
    @State private var manualError: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(mode == .venue ? "Search for the venue, or the town it’s in. We use Apple Maps; results outside the UK are ignored." : "Search for your town, city or village anywhere in England, Scotland, Wales or Northern Ireland.")
                        .dimBody(14)

                    TextField(mode == .venue ? "Venue or town" : "Town, city or village", text: $search.query)
                        .fieldStyle()
                        .focused($focused)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .accessibilityLabel("Search for a place")

                    if let message { Banner(kind: .error, text: message) }
                    if search.unavailable {
                        Banner(kind: .info, text: "Place search isn’t available right now (are you offline?). You can still type your place in below.")
                    }

                    if search.resolving { ProgressView().tint(Theme.acid) }

                    VStack(spacing: 0) {
                        ForEach(Array(search.suggestions.prefix(8).enumerated()), id: \.offset) { _, s in
                            Button { Task { await choose(s) } } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(s.title).font(Theme.body(16)).foregroundStyle(Theme.paper)
                                    if !s.subtitle.isEmpty { Text(s.subtitle).font(Theme.body(13)).foregroundStyle(Theme.paperDim) }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 12).padding(.horizontal, 14)
                                .frame(minHeight: 48)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityElement(children: .combine)
                            Divider1()
                        }
                    }

                    if !search.query.isEmpty && search.suggestions.isEmpty && !search.unavailable {
                        Text("No places found yet. Check the spelling, or type it in below.").dimBody(13)
                    }

                    Divider1()
                    MonoLabel("Other ways")
                    if mode == .town {
                        AsyncButton(kind: .outline) { await useCurrentLocation() } label: { Label("Use my current location", systemImage: "location") }
                        Text("Only asked when you tap this. Your phone’s position is turned into a town and rounded to about 1 km; it isn’t tracked.").dimBody(12)
                        locationStatusView
                    }
                    Button { showManual.toggle() } label: { Label(showManual ? "Hide typing it in" : "Type it in instead", systemImage: "keyboard") }
                        .buttonStyle(.appOutline)
                    if showManual { manualForm }
                }
                .padding(24)
            }
            .scrollDismissesKeyboard(.interactively)
            .screenBackground()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } } }
            .onAppear { search.includePointsOfInterest = mode == .venue; focused = true }
        }
    }

    @ViewBuilder private var locationStatusView: some View {
        switch finder.status {
        case .denied:
            VStack(alignment: .leading, spacing: 8) {
                Banner(kind: .error, text: "Location access is turned off for Support Slot. You can search or type your place instead, or allow it in Settings.")
                if let url = URL(string: UIApplication.openSettingsURLString) { Link("Open Settings", destination: url).font(Theme.body(14)).foregroundStyle(Theme.acid) }
            }
        case .restricted: Banner(kind: .error, text: "Location access is restricted on this device. Search or type your place instead.")
        case .failed(let m): Banner(kind: .error, text: m)
        case .asking, .locating: HStack { ProgressView().tint(Theme.acid); Text("Finding your town…").dimBody(13) }
        case .idle: EmptyView()
        }
    }

    private var manualForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("A typed-in place has no map position, so it won’t appear in distance searches and we can’t show how far away it is.").dimBody(13)
            LabeledField(label: "Town, city or village", error: manualError) {
                TextField("e.g. Aberystwyth", text: $manualName).fieldStyle(invalid: manualError != nil).textInputAutocapitalization(.words)
            }
            LabeledField(label: "Nation") {
                Picker("Nation", selection: $manualNation) { ForEach(UKNation.allCases) { Text($0.rawValue).tag($0) } }
                    .pickerStyle(.menu).tint(Theme.acid).fieldStyle()
            }
            LabeledField(label: "County or area (optional)", hint: "Helps tell places with the same name apart, e.g. Newport in Shropshire or on the Isle of Wight.") {
                TextField("e.g. Ceredigion", text: $manualRegion).fieldStyle().textInputAutocapitalization(.words)
            }
            Button("Use this place") {
                let place = Place.manual(name: manualName, region: manualRegion, country: manualNation)
                if let problem = place.validationError { manualError = problem; return }
                onPick(PlaceResult(place: place, venueName: nil, street: nil)); dismiss()
            }.buttonStyle(.appPrimary)
        }
    }

    private func choose(_ s: MKLocalSearchCompletion) async {
        message = nil
        switch await search.resolve(s) {
        case .success(let r): onPick(r); dismiss()
        case .failure(let e): if !search.unavailable { message = e.message }
        }
    }

    private func useCurrentLocation() async {
        message = nil
        if let result = await finder.find() {
            switch result {
            case .success(let r): onPick(r); dismiss()
            case .failure(let e): message = e.message
            }
        }
    }
}

/// A button-like field that shows the chosen place and opens the picker.
struct PlaceField: View {
    let label: String
    @Binding var place: Place?
    var mode: PlacePicker.Mode = .town
    var error: String? = nil
    var hint: String? = nil
    var onPick: ((PlaceResult) -> Void)? = nil
    @State private var showing = false

    var body: some View {
        LabeledField(label: label, error: error, hint: hint ?? (place.map { $0.hasCoordinates ? nil : "Typed in, so it has no map position and can’t be used for distance." } ?? nil)) {
            Button { showing = true } label: {
                HStack {
                    Text(place?.label ?? "Choose a place").foregroundStyle(place == nil ? Theme.paperDim : Theme.paper).multilineTextAlignment(.leading)
                    Spacer()
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.paperDim)
                }
                .fieldStyle(invalid: error != nil)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(label): \(place?.label ?? "not chosen")")
            .accessibilityHint("Opens place search")
        }
        .sheet(isPresented: $showing) {
            PlacePicker(mode: mode, title: label) { result in
                place = result.place
                onPick?(result)
            }
        }
    }
}
