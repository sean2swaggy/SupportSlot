import SwiftUI

/// Choose a venue anywhere in the UK from those already on Support Slot, or add
/// a new one. New venues are shown as unverified until our team checks them.
struct VenuePickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let venues: [Venue]
    let selectedId: String
    let onSelect: (Venue) -> Void
    let onAdded: (Venue) -> Void
    @State private var query = ""
    @State private var adding = false

    private var filtered: [Venue] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return venues }
        return venues.filter { [$0.name, $0.city, $0.region ?? "", $0.country].joined(separator: " ").lowercased().contains(q) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack { Image(systemName: "magnifyingglass").foregroundStyle(Theme.paperDim); TextField("Search venues by name or place", text: $query).autocorrectionDisabled() }.fieldStyle()
                    ForEach(filtered) { v in
                        Button { onSelect(v); dismiss() } label: {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 6) { Text(v.name).font(Theme.body(16, weight: .medium)).foregroundStyle(Theme.paper); if v.isVerified { VerifiedBadge() } }
                                    Text("\(v.city) · capacity \(Money.number(v.capacity))").font(Theme.body(13)).foregroundStyle(Theme.paperDim)
                                    if !v.isVerified { Text("Added by a promoter · not yet checked").font(Theme.mono(10)).foregroundStyle(Theme.paperDim).textCase(.uppercase) }
                                }
                                Spacer()
                                if v.id == selectedId { Image(systemName: "checkmark").foregroundStyle(Theme.acid) }
                            }
                            .padding(.vertical, 10).frame(minHeight: 48).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .combine)
                        Divider1()
                    }
                    if filtered.isEmpty { Text("No venue matches “\(query)”. Add it below.").dimBody(14) }
                    Button { adding = true } label: { Label("Add a venue that isn’t listed", systemImage: "plus") }.buttonStyle(.appOutline)
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .screenBackground()
            .navigationTitle("Venue").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } } }
            .sheet(isPresented: $adding) { AddVenueSheet { v in onAdded(v); dismiss() }.presentationBackground(Theme.ink) }
        }
    }
}

struct AddVenueSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let onAdded: (Venue) -> Void
    @State private var name = ""
    @State private var address = ""
    @State private var capacity: Int?
    @State private var place: Place?
    @State private var submitted = false
    @State private var error: String?

    private var problems: [String: String] {
        var p: [String: String] = [:]
        if name.trimmingCharacters(in: .whitespaces).count < 2 { p["name"] = "Enter the venue’s name." }
        if address.trimmingCharacters(in: .whitespaces).count < 3 { p["address"] = "Enter the venue’s address." }
        if (capacity ?? 0) < 1 { p["capacity"] = "Enter the capacity (at least 1)." }
        if place == nil { p["place"] = "Choose where the venue is." }
        return p
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Anywhere in England, Scotland, Wales or Northern Ireland. The venue is shown as unverified until our team has checked it.").dimBody(14)
                    PlaceField(label: "Where is it?", place: $place, mode: .venue, error: submitted ? problems["place"] : nil,
                               hint: "Search for the venue or its town. Apple Maps gives the map position used for distances.") { result in
                        if name.isEmpty, let n = result.venueName { name = n }
                        if address.isEmpty, let s = result.street { address = s }
                    }
                    LabeledField(label: "Venue name", error: submitted ? problems["name"] : nil) { TextField("e.g. The Old Hall", text: $name).fieldStyle(invalid: submitted && problems["name"] != nil) }
                    LabeledField(label: "Address", error: submitted ? problems["address"] : nil) { TextField("Street, town, postcode", text: $address).fieldStyle(invalid: submitted && problems["address"] != nil) }
                    LabeledField(label: "Capacity", error: submitted ? problems["capacity"] : nil) { IntField(value: $capacity, placeholder: "250", invalid: submitted && problems["capacity"] != nil) }
                    if let error { Banner(kind: .error, text: error) }
                    AsyncButton { await save() } label: { Text("Add venue") }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .screenBackground()
            .navigationTitle("Add a venue").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } } }
        }
    }

    private func save() async {
        submitted = true; error = nil
        guard problems.isEmpty, let place, let capacity else { return }
        do {
            let id = try await store.db.createVenue(name: name.trimmingCharacters(in: .whitespacesAndNewlines), address: address.trimmingCharacters(in: .whitespacesAndNewlines), capacity: capacity, place: place)
            guard let venue = try await store.db.venue(id: id) else { throw AppError.generic("The venue was added but couldn’t be loaded. Pull to refresh.") }
            onAdded(venue); dismiss()
        } catch { self.error = (error as? AppError)?.message ?? "We couldn’t add that venue." }
    }
}
