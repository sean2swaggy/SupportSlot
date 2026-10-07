import SwiftUI

/// The landing screen for signed-out visitors.
struct HomeView: View {
    @Environment(AppStore.self) private var store
    var onDiscover: () -> Void = {}
    var onTonight: () -> Void = {}
    var onLogin: () -> Void = {}

    @State private var open: [Slot] = []
    @State private var urgent: [Slot] = []
    @State private var artists: [Artist] = []
    @State private var status: Status = .loading
    enum Status: Equatable { case loading, loaded, failed(AppError) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 34) {
                hero
                switch status {
                case .loading: LoadingView(label: "Loading listings…")
                case .failed(let e): ErrorState(error: e) { Task { await load() } }.padding(.horizontal, 20)
                case .loaded:
                    section(eyebrow: "Open now", title: "Support needed") {
                        if open.isEmpty {
                            EmptyState(title: "No open slots yet", message: "Check back soon, or see what’s needed tonight.", actionTitle: "See last-minute slots", action: onTonight)
                        } else {
                            ForEach(open.prefix(6)) { slot in NavigationLink(value: slot) { SlotCard(slot: slot) }.buttonStyle(.plain) }
                            Button("View all slots", action: onDiscover).buttonStyle(.appOutline)
                        }
                    }
                    if !urgent.isEmpty {
                        section(eyebrow: "Last-minute support", title: "Needed tonight") {
                            ForEach(urgent.prefix(4)) { slot in NavigationLink(value: slot) { SlotCard(slot: slot) }.buttonStyle(.plain) }
                        }
                    }
                }
                howItWorks
                if !artists.isEmpty { artistStrip }
                noPayToPlay
            }
            .padding(.bottom, 40)
        }
        .refreshable { await load() }
        .screenBackground()
        .navigationDestination(for: Slot.self) { SlotDetailView(slotId: $0.id, preloaded: $0) }
        .navigationDestination(for: Artist.self) { ArtistProfileView(handle: $0.handle, preloaded: $0) }
        .task { await load() }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 16) {
            Logo(size: 20)
            Eyebrow("A marketplace for support slots")
            DisplayTitle("Find your next stage.", size: 46)
            Text("Discover support opportunities. Apply in seconds. Play in front of audiences that actually fit your music.").dimBody(16)
            VStack(spacing: 10) {
                Button("Find support slots", action: onDiscover).buttonStyle(.appPrimary)
                Button("Last-minute support", action: onTonight).buttonStyle(.appOutline)
                Button("Create an account or log in", action: onLogin).buttonStyle(.app(.ghost))
            }
            VStack(alignment: .leading, spacing: 8) {
                MonoLabel("Now booking in")
                FlowLayout(spacing: 6) { ForEach(Catalog.cities, id: \.self) { Tag($0) } }
            }
        }
        .padding(.horizontal, 20).padding(.top, 8)
    }

    private func section<Content: View>(eyebrow: String, title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) { Eyebrow(eyebrow); DisplayTitle(title, size: 28) }
            content()
        }
        .padding(.horizontal, 20)
    }

    private var howItWorks: some View {
        section(eyebrow: "How it works", title: "Play in front of the right room") {
            VStack(spacing: 12) {
                step("01", "Discover a slot", "Browse support opportunities near you, filtered by genre, date, pay and audience size.")
                step("02", "See how it fits", "A plain explanation of whether the genre, location and act size line up with your profile — information, not a score.")
                step("03", "Apply in seconds", "Pick a track from your profile and add a short note. Your links and live clip are already on your profile for the promoter to open.")
            }
        }
    }

    private func step(_ n: String, _ title: String, _ text: String) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 6) {
                Text(n).font(Theme.mono(12, weight: .bold)).foregroundStyle(Theme.acid)
                Text(title).font(Theme.display(19)).foregroundStyle(Theme.paper)
                Text(text).dimBody(14)
            }
        }
    }

    private var artistStrip: some View {
        section(eyebrow: "Artists", title: "Newly joined") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(artists) { a in NavigationLink(value: a) { ArtistTile(artist: a) }.buttonStyle(.plain) }
                }
            }
        }
    }

    private var noPayToPlay: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("No pay-to-play. No application fees.").font(Theme.display(24)).foregroundStyle(Theme.acidInk)
            Text("Artists keep their full agreed fee, paid directly by the promoter. Support Slot never charges artists or takes a cut.").font(Theme.body(15)).foregroundStyle(Theme.acidInk.opacity(0.8))
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.acid)
    }

    private func load() async {
        do {
            async let o = store.db.openSlots(limit: 12)
            async let u = store.db.urgentSlots()
            async let a = store.db.featuredArtists(limit: 8)
            let (openSlots, urgentSlots, featured) = try await (o, u, a)
            open = openSlots.filter { !$0.isUrgent }; urgent = urgentSlots; artists = featured
            status = .loaded
        } catch is CancellationError {
        } catch {
            if status != .loaded { status = .failed((error as? AppError) ?? .generic()) }
        }
    }
}
