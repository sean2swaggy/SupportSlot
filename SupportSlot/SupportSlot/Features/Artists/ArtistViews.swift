import SwiftUI

/// A small artist tile for horizontal strips.
struct ArtistTile: View {
    let artist: Artist
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            RemoteImage(source: artist.imageUrl).frame(width: 150, height: 150).overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1)).overlay {
                if artist.imageUrl == nil || artist.imageUrl!.isEmpty { Text(String(artist.name.prefix(1))).font(Theme.display(40)).foregroundStyle(Theme.paperDim) }
            }
            HStack(spacing: 4) { Text(artist.name).font(Theme.display(16)).foregroundStyle(Theme.paper).lineLimit(1); if artist.isVerified { Image(systemName: "checkmark.seal.fill").foregroundStyle(Theme.acid).font(.system(size: 12)) } }
            Text("\(artist.location) · \(artist.genres.prefix(2).joined(separator: ", "))").font(Theme.body(12)).foregroundStyle(Theme.paperDim).lineLimit(1)
        }
        .frame(width: 150, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// An artist as a list row.
struct ArtistRow: View {
    let artist: Artist
    var trailing: AnyView? = nil
    var body: some View {
        HStack(spacing: 14) {
            Avatar(imageUrl: artist.imageUrl, name: artist.name, size: 56)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) { Text(artist.name).font(Theme.display(18)).foregroundStyle(Theme.paper).lineLimit(1); if artist.isVerified { VerifiedBadge() } }
                Text("\(artist.location) · \(Catalog.artistSizeLabel(artist.artistSize))").font(Theme.body(13)).foregroundStyle(Theme.paperDim)
                FlowLayout(spacing: 4) { ForEach(artist.genres.prefix(3), id: \.self) { Tag($0) } }
            }
            Spacer(minLength: 0)
            if let trailing { trailing }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.inkCard)
        .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// The public artist page — what a promoter sees before booking.
struct ArtistProfileView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.openURL) private var openURL
    let handle: String
    var preloaded: Artist?

    @State private var artist: Artist?
    @State private var loadError: AppError?
    @State private var showReport = false

    var body: some View {
        ScrollView {
            if let artist { content(artist) }
            else if let loadError { ErrorState(error: loadError) { Task { await load() } }.padding(20) }
            else { LoadingView(label: "Loading profile…").padding(.top, 60) }
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task { if artist == nil { artist = preloaded }; await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showReport) {
            if let artist { NavigationStack { ReportSheet(contextType: "profile", contextId: artist.id, reportedProfileId: artist.id, subject: artist.name) }.environment(store).presentationBackground(Theme.ink) }
        }
    }

    private func load() async {
        do {
            guard let fresh = try await store.db.artist(handle: handle) else { loadError = AppError("That artist page doesn’t exist."); artist = nil; return }
            artist = fresh; loadError = nil
        } catch is CancellationError {
        } catch { if artist == nil || artist?.artistTracks == nil { loadError = (error as? AppError) ?? .generic() } }
    }

    @ViewBuilder private func content(_ a: Artist) -> some View {
        let links = ArtistLinks(artist: a)
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                RemoteImage(source: a.bannerImageUrl ?? a.imageUrl).frame(height: 190).clipped()
                    .overlay(LinearGradient(colors: [.clear, Theme.ink], startPoint: .top, endPoint: .bottom))
            }
            VStack(alignment: .leading, spacing: 22) {
                HStack(alignment: .bottom, spacing: 14) {
                    Avatar(imageUrl: a.imageUrl, name: a.name, size: 84)
                    VStack(alignment: .leading, spacing: 6) {
                        DisplayTitle(a.name, size: 28)
                        if a.isVerified { VerifiedBadge() }
                    }
                }
                .padding(.top, -60)

                FlowLayout(spacing: 6) {
                    Tag(a.location, tint: Theme.paper)
                    Tag(Catalog.artistSizeLabel(a.artistSize))
                    ForEach(a.genres, id: \.self) { Tag($0) }
                }
                HStack(spacing: 8) {
                    Circle().fill(a.availability == "available" ? Theme.ok : a.availability == "limited" ? Theme.acid : Theme.paperDim).frame(width: 8, height: 8)
                    Text(Catalog.availabilityLabel(a.availability)).font(Theme.body(14)).foregroundStyle(Theme.paper)
                    Spacer()
                    if let n = a.monthlyListeners, n > 0 {
                        Text("\(Money.number(n)) monthly listeners").font(Theme.body(13)).foregroundStyle(Theme.paperDim)
                            .accessibilityLabel("\(Money.number(n)) monthly listeners, self-reported by the artist")
                    }
                }
                if let n = a.monthlyListeners, n > 0 { Text("Listener count is self-reported by the artist and not verified by Support Slot.").font(Theme.body(11)).foregroundStyle(Theme.paperDim.opacity(0.8)) }

                if !a.bio.isEmpty { section("About") { Text(a.bio).dimBody(15).lineSpacing(3) } }

                if !a.tracks.isEmpty {
                    section("Tracks") {
                        VStack(spacing: 0) {
                            ForEach(a.tracks) { t in
                                HStack {
                                    Text(t.title).foregroundStyle(Theme.paper)
                                    Spacer()
                                    Text(t.duration).font(Theme.mono(12)).foregroundStyle(Theme.paperDim)
                                    if let url = SafeLink.url(t.url) {
                                        Button { openURL(url) } label: { Image(systemName: "play.circle.fill").font(.system(size: 22)).foregroundStyle(Theme.acid) }
                                            .accessibilityLabel("Listen to \(t.title)").frame(minWidth: 44, minHeight: 44)
                                    }
                                }
                                .padding(.horizontal, 14).frame(minHeight: 50)
                                if t.id != a.tracks.last?.id { Divider1() }
                            }
                        }
                        .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
                    }
                }

                if let video = SafeLink.url(a.liveVideoUrl) {
                    section("Live") {
                        Button { openURL(video) } label: {
                            HStack { Image(systemName: "play.rectangle.fill").foregroundStyle(Theme.acid); Text("Watch a live performance"); Spacer(); Image(systemName: "arrow.up.right").font(.system(size: 12)) }
                                .font(Theme.body(15, weight: .medium)).foregroundStyle(Theme.paper).padding(.horizontal, 14).frame(minHeight: 52)
                                .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }

                if !links.list.isEmpty {
                    section("Listen & follow") {
                        FlowLayout(spacing: 8) {
                            ForEach(links.list) { link in
                                if let url = URL(string: link.url) {
                                    Button { openURL(url) } label: { Text(link.label.uppercased()).font(Theme.mono(11)).tracking(1).foregroundStyle(Theme.paper).padding(.horizontal, 12).frame(minHeight: 40).overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1)) }
                                        .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }

                if !a.upcomingShows.isEmpty { section("Upcoming shows") { showList(a.upcomingShows) } }
                if !a.pastShows.isEmpty { section("Previous shows") { showList(a.pastShows) } }

                if store.isSignedIn, store.role == .promoter { PromoterArtistActions(artist: a) }
                if store.userId == a.id {
                    Banner(kind: .info, text: "This is how promoters see your profile. Edit it from the Profile tab.")
                } else if store.isSignedIn {
                    Button { showReport = true } label: { Label("Report this profile", systemImage: "flag") }
                        .font(Theme.mono(11)).foregroundStyle(Theme.paperDim).frame(maxWidth: .infinity)
                }
            }
            .padding(20)
        }
    }

    private func showList(_ shows: [PastShow]) -> some View {
        VStack(spacing: 0) {
            ForEach(shows) { s in
                VStack(alignment: .leading, spacing: 3) {
                    Text(s.headliner).font(Theme.body(15, weight: .medium)).foregroundStyle(Theme.paper)
                    Text("\(s.venue), \(s.city) · \(UKDates.formatShowDate(s.date, withYear: true))").font(Theme.body(13)).foregroundStyle(Theme.paperDim)
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                if s.id != shows.last?.id { Divider1() }
            }
        }
        .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
    }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) { MonoLabel(title); content() }
    }
}
