import SwiftUI

/// Browse every artist on Support Slot (promoters). Search, filter by genre,
/// place and distance, save to your roster, or invite them to one of your gigs.
struct DiscoverArtistsView: View {
    @Environment(AppStore.self) private var store
    @State private var artists: [Artist] = []
    @State private var distances: [ID: Int] = [:]
    @State private var total = 0
    @State private var page = 1
    @State private var state: LoadState = .loading
    @State private var loadingMore = false
    @State private var search = ""
    @State private var genre = ""
    @State private var country: UKNation?
    @State private var near: Place?
    @State private var distance = 25
    @State private var inviting: Artist?
    enum LoadState: Equatable { case loading, loaded, failed(AppError) }

    private struct Key: Equatable { var search: String; var genre: String; var country: UKNation?; var near: Coordinate?; var distance: Int }
    private var key: Key { Key(search: search, genre: genre, country: country, near: near?.coordinate, distance: distance) }
    private var isFiltering: Bool { !search.isEmpty || !genre.isEmpty || country != nil || near != nil }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Find your support act")
                    DisplayTitle("Discover artists", size: 32)
                    Text("Real profiles from artists on Support Slot. Listener counts are self-reported. Distances are rounded straight-line miles; artists’ exact positions are never shown.").dimBody(14)
                }
                HStack { Image(systemName: "magnifyingglass").foregroundStyle(Theme.paperDim); TextField("Search by name or place", text: $search).autocorrectionDisabled() }.fieldStyle()
                HStack(spacing: 10) {
                    menu("Genre", $genre, [("", "Any genre")] + Catalog.genres.map { ($0, $0) })
                    menu("Nation", Binding(get: { country?.rawValue ?? "" }, set: { country = UKNation(rawValue: $0) }), [("", "Anywhere in the UK")] + UKNation.allCases.map { ($0.rawValue, $0.rawValue) })
                }
                PlaceField(label: "Near (optional)", place: $near, hint: "Choose a town or city to see artists within a radius.")
                if let near {
                    menu("Within", Binding(get: { String(distance) }, set: { distance = Int($0) ?? 25 }), SlotFilters.distanceOptions.map { (String($0), "Within \($0) miles") })
                    if !near.hasCoordinates { Banner(kind: .info, text: "“\(near.label)” was typed in, so it has no map position. Choose it from the search to filter by distance.") }
                    Button("Clear location") { self.near = nil }.buttonStyle(.app(.outline, compact: true))
                }

                switch state {
                case .loading where artists.isEmpty: LoadingView(label: "Loading artists…")
                case .failed(let e): ErrorState(error: e) { Task { await reload() } }
                default:
                    if artists.isEmpty {
                        EmptyState(title: isFiltering ? "No artists match those filters" : "No artists on the platform yet",
                                   message: isFiltering ? "Try widening your search or clearing a filter. Artists who typed their place in have no map position and only appear without a distance filter." : "Check back soon.")
                    } else {
                        Text("\(total) artist\(total == 1 ? "" : "s")").font(Theme.mono(11)).foregroundStyle(Theme.paperDim).textCase(.uppercase)
                        ForEach(artists) { a in
                            VStack(spacing: 0) {
                                NavigationLink(value: a) { ArtistRow(artist: a) }.buttonStyle(.plain)
                                if let miles = distances[a.id] { Text("About \(Geo.describe(miles: miles)) away (rounded up, straight line)").font(Theme.mono(10)).foregroundStyle(Theme.paperDim).textCase(.uppercase).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 6) }
                                HStack(spacing: 10) {
                                    Button { inviting = a } label: { Label("Invite to a gig", systemImage: "paperplane") }.buttonStyle(.app(.outline, compact: true))
                                    SaveToRosterButton(artistId: a.id)
                                }
                                .padding(.top, 8)
                            }
                            .onAppear { if a.id == artists.last?.id { Task { await loadMore() } } }
                        }
                        if loadingMore { LoadingView(label: "Loading more…") }
                    }
                }
            }
            .padding(20)
        }
        .refreshable { await reload() }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Artist.self) { ArtistProfileView(handle: $0.handle, preloaded: $0) }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { NotificationsButton() } }
        .task(id: key) {
            try? await Task.sleep(nanoseconds: 300_000_000) // settle while typing
            if Task.isCancelled { return }
            await reload()
        }
        .sheet(item: $inviting) { a in NavigationStack { InviteToGigSheet(artist: a) }.environment(store).presentationBackground(Theme.ink) }
    }

    private func menu(_ label: String, _ selection: Binding<String>, _ options: [(String, String)]) -> some View {
        Menu {
            Picker(label, selection: selection) { ForEach(options, id: \.0) { Text($0.1).tag($0.0) } }
        } label: {
            HStack { Text(options.first { $0.0 == selection.wrappedValue }?.1 ?? label).font(Theme.body(14)).foregroundStyle(Theme.paper).lineLimit(1); Spacer(); Image(systemName: "chevron.up.chevron.down").font(.system(size: 11)).foregroundStyle(Theme.paperDim) }.fieldStyle()
        }
        .accessibilityLabel("\(label), \(options.first { $0.0 == selection.wrappedValue }?.1 ?? "")")
    }

    private func fetch(page: Int) async throws -> (hits: [ArtistSearchHit], artists: [Artist]) {
        let centre = near?.coordinate
        return try await store.db.searchArtists(q: search, genre: genre.isEmpty ? nil : genre, country: country?.rawValue, near: centre, maxMiles: centre == nil ? nil : distance,
                                                sort: centre == nil ? "newest" : "distance", page: page)
    }

    private func reload() async {
        do {
            let r = try await fetch(page: 1)
            artists = r.artists; page = 1; total = r.hits.first?.totalCount ?? 0
            distances = Dictionary(uniqueKeysWithValues: r.hits.compactMap { h in h.distanceMiles.map { (h.id, $0) } })
            state = .loaded
        } catch is CancellationError {}
        catch { if artists.isEmpty || state != .loaded { state = .failed((error as? AppError) ?? .generic("We couldn’t load artists.")) } }
    }

    private func loadMore() async {
        guard state == .loaded, artists.count < total, !loadingMore else { return }
        loadingMore = true; defer { loadingMore = false }
        do {
            let r = try await fetch(page: page + 1)
            let known = Set(artists.map(\.id))
            artists += r.artists.filter { !known.contains($0.id) }
            for h in r.hits { if let d = h.distanceMiles { distances[h.id] = d } }
            page += 1
        } catch {}
    }
}

/// Add or remove an artist from the promoter's private roster.
struct SaveToRosterButton: View {
    @Environment(AppStore.self) private var store
    let artistId: ID
    @State private var entryId: ID?
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            AsyncButton(kind: entryId == nil ? .outline : .primary, compact: true) { await toggle() } label: {
                Label(entryId == nil ? "Save to roster" : "On roster", systemImage: entryId == nil ? "star" : "star.fill")
            }
            .disabled(!loaded)
            FieldError(message: error)
        }
        .task { await load() }
    }

    private func load() async {
        guard let uid = store.userId else { return }
        struct Row: Decodable { let id: ID }
        let row: Row? = try? await store.db.selectOne(Query("artist_roster", "id").eq("promoter_id", uid).eq("artist_id", artistId))
        entryId = row?.id
        loaded = true
    }

    private func toggle() async {
        guard let uid = store.userId else { return }
        error = nil
        do {
            if let entryId { try await store.db.removeFromRoster(entryId: entryId); self.entryId = nil }
            else { try await store.db.addToRoster(promoterId: uid, artistId: artistId); await load() }
        } catch { self.error = (error as? AppError)?.message ?? "Couldn’t update your roster." }
    }
}

/// Shown on an artist's page when a promoter is looking.
struct PromoterArtistActions: View {
    let artist: Artist
    @Environment(AppStore.self) private var store
    @State private var inviting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            MonoLabel("For promoters")
            Button { inviting = true } label: { Label("Invite to a gig", systemImage: "paperplane") }.buttonStyle(.appPrimary)
            SaveToRosterButton(artistId: artist.id)
        }
        .sheet(isPresented: $inviting) { NavigationStack { InviteToGigSheet(artist: artist) }.environment(store).presentationBackground(Theme.ink) }
    }
}


/// Invite one artist to apply for one of the promoter's open gigs.
struct InviteToGigSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let artist: Artist
    @State private var slotId: ID?
    @State private var message = ""
    @State private var invited: Set<ID> = []
    @State private var error: String?
    @State private var done = false

    private var openGigs: [Slot] { store.myListings.filter { $0.slotStatus == .open && !UKDates.deadlinePassed($0.applicationDeadline) && UKDates.daysUntil($0.date) >= 0 } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if done {
                    Image(systemName: "paperplane.fill").font(.system(size: 26)).foregroundStyle(Theme.acid)
                    DisplayTitle("Invitation sent", size: 28)
                    Text("\(artist.name) is notified. If they accept, they apply to your gig and you review them like any other applicant. Nothing is booked until you make an offer and they accept it.").dimBody()
                    Button("Done") { dismiss() }.buttonStyle(.appPrimary)
                } else {
                    Eyebrow("Invite")
                    DisplayTitle("Invite \(artist.name)", size: 28)
                    Text("Choose one of your open gigs. They’ll be asked to apply — it never books anyone by itself.").dimBody(14)
                    if openGigs.isEmpty {
                        EmptyState(title: "No open gigs", message: "Post a support slot first, then invite artists to it.")
                    } else {
                        VStack(spacing: 0) {
                            ForEach(openGigs) { g in
                                let already = invited.contains(g.id)
                                Button { if !already { slotId = g.id } } label: {
                                    HStack {
                                        Image(systemName: slotId == g.id ? "largecircle.fill.circle" : "circle").foregroundStyle(slotId == g.id ? Theme.acid : Theme.paperDim)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(g.headliner).font(Theme.body(15, weight: .medium)).foregroundStyle(Theme.paper)
                                            Text("\(g.venue?.name ?? g.city) · \(UKDates.shortDate(g.date))").font(Theme.body(12)).foregroundStyle(Theme.paperDim)
                                        }
                                        Spacer()
                                        if already { Tag("Invited", tint: Theme.ok) }
                                    }
                                    .padding(.horizontal, 14).frame(minHeight: 56).opacity(already ? 0.6 : 1)
                                }
                                .buttonStyle(.plain).disabled(already)
                                if g.id != openGigs.last?.id { Divider1() }
                            }
                        }
                        .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
                        LabeledField(label: "Message (optional)") { TextArea(text: $message, placeholder: "Why you think they’d be a good fit", minHeight: 90) }
                        if let error { Banner(kind: .error, text: error) }
                        AsyncButton { await send() } label: { Text("Send invitation") }.disabled(slotId == nil)
                    }
                }
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarLeading) { if !done { Button("Cancel") { dismiss() } } } }
        .task(id: openGigs.map(\.id)) {
            var all: Set<ID> = []
            for g in openGigs { if let ids = try? await store.db.invitedArtistIDs(slotId: g.id), ids.contains(artist.id) { all.insert(g.id) } }
            invited = all
            if slotId == nil { slotId = openGigs.first { !all.contains($0.id) }?.id }
        }
    }

    private func send() async {
        error = nil
        guard let slotId, let uid = store.userId else { return }
        do { try await store.db.createInvitation(slotId: slotId, promoterId: uid, artistId: artist.id, message: message); done = true }
        catch { self.error = (error as? AppError)?.message ?? "We couldn’t send that invitation." }
    }
}

/// Invitations a promoter has sent for one listing, and where each stands.
struct InvitationsSection: View {
    @Environment(AppStore.self) private var store
    let slotId: ID
    @State private var invitations: [GigInvitation] = []
    @State private var error: String?

    var body: some View {
        Group {
            if !invitations.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    MonoLabel("Invitations sent (\(invitations.count))")
                    ForEach(invitations) { inv in
                        HStack(spacing: 12) {
                            Avatar(imageUrl: inv.artists?.imageUrl, name: inv.artists?.name ?? "Artist", size: 40)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(inv.artists?.name ?? "Artist").font(Theme.body(15, weight: .medium)).foregroundStyle(Theme.paper)
                                Text(label(inv.status)).font(Theme.body(12)).foregroundStyle(Theme.paperDim)
                            }
                            Spacer()
                            if inv.status == "pending" {
                                AsyncButton(kind: .outline, compact: true) { await withdraw(inv) } label: { Text("Withdraw") }.frame(width: 120)
                            }
                        }
                        .padding(12).overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
                    }
                    FieldError(message: error)
                }
            }
        }
        .task { await load() }
    }

    private func label(_ s: String) -> String {
        switch s { case "pending": return "Waiting for a reply"; case "accepted": return "Accepted — they’ve applied"; case "declined": return "Declined"; default: return "Withdrawn" }
    }
    private func load() async { invitations = (try? await store.db.invitations(forSlot: slotId)) ?? invitations }
    private func withdraw(_ inv: GigInvitation) async {
        error = nil
        do { try await store.db.withdrawInvitation(id: inv.id); await load() } catch { self.error = (error as? AppError)?.message }
    }
}
