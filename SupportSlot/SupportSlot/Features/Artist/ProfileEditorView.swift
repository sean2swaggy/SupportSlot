import SwiftUI

/// Edit what promoters see. Every section saves on its own, to the public
/// profile, straight away — and says plainly when it couldn't.
struct ProfileEditorView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        ScrollView {
            if let artist = store.artist {
                let items = ProfileChecklist.items(for: artist)
                let c = ProfileChecklist.completion(items)
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 8) {
                        Eyebrow("Your page")
                        DisplayTitle("Your profile", size: 32)
                        Text("What promoters see when you apply. Changes save to your public profile straight away.").dimBody(14)
                    }
                    checklist(items, c)
                    PhotosEditor(artist: artist)
                    BasicsEditor(artist: artist).id(artist.name + artist.bio + artist.location + artist.locationCountry + artist.genres.joined() + artist.availability + String(artist.travelRadiusMiles) + (artist.liveVideoUrl ?? "") + artist.artistSize)
                    TracksEditor(artist: artist)
                    LinksEditor(artist: artist)
                    ListenersEditor(artist: artist)
                    NavigationLink { ArtistProfileView(handle: artist.handle, preloaded: artist) } label: { Text("Open public profile") }.buttonStyle(.appOutline)
                }
                .padding(20)
            } else {
                LoadingView().padding(.top, 60)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await store.refresh() }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
    }

    private func checklist(_ items: [ChecklistItem], _ c: (done: Int, total: Int, percent: Int)) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack { MonoLabel("Profile checklist"); Spacer(); Text("\(c.done)/\(c.total) done").font(Theme.mono(12)).foregroundStyle(Theme.paper) }
                GeometryReader { g in
                    ZStack(alignment: .leading) { Rectangle().fill(Theme.inkBorder); Rectangle().fill(Theme.acid).frame(width: g.size.width * CGFloat(c.percent) / 100) }
                }
                .frame(height: 6)
                .accessibilityElement().accessibilityLabel("Profile completion").accessibilityValue("\(c.percent) percent")
                ForEach(items) { i in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: i.done ? "checkmark.circle.fill" : "circle").foregroundStyle(i.done ? Theme.ok : Theme.paperDim)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(i.label).font(Theme.body(14)).foregroundStyle(i.done ? Theme.paperDim : Theme.paper).strikethrough(i.done)
                            if !i.done { Text(i.hint).font(Theme.body(12)).foregroundStyle(Theme.paperDim) }
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

/// "Saved ✓" / error line shared by every editor section.
private struct SaveStatus: View {
    let error: String?
    let saved: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if saved { Text("Saved ✓").font(Theme.mono(11)).foregroundStyle(Theme.ok).textCase(.uppercase) }
            if let error { Banner(kind: .error, text: error) }
        }
    }
}

private struct EditorSection<Content: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var content: Content
    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) { MonoLabel(title); if let subtitle { Text(subtitle).font(Theme.body(12)).foregroundStyle(Theme.paperDim) } }
                content
            }
        }
    }
}

// MARK: - Photos

private struct PhotosEditor: View {
    @Environment(AppStore.self) private var store
    let artist: Artist
    @State private var image: String?
    @State private var banner: String?
    @State private var error: String?
    @State private var saved = false
    @State private var loadedBanner = false

    var body: some View {
        EditorSection(title: "Photos") {
            PhotoField(label: "Profile photo", imageUrl: $image, maxDimension: 640)
            PhotoField(label: "Banner", imageUrl: $banner, maxDimension: 1200, square: false, height: 80)
            AsyncButton(compact: true) { await save() } label: { Text("Save photos") }
            SaveStatus(error: error, saved: saved)
        }
        .task {
            image = artist.imageUrl
            if !loadedBanner, let full = try? await store.db.artist(id: artist.id) { banner = full.bannerImageUrl; loadedBanner = true }
        }
    }

    private func save() async {
        error = nil; saved = false
        do { try await store.perform { try await store.db.updateArtistPhotos(id: artist.id, imageUrl: image, bannerImageUrl: banner) }; saved = true }
        catch { self.error = (error as? AppError)?.message }
    }
}

// MARK: - About you

private struct BasicsEditor: View {
    @Environment(AppStore.self) private var store
    let artist: Artist
    @State private var name: String
    @State private var place: Place?
    @State private var genres: [String]
    @State private var bio: String
    @State private var availability: String
    @State private var artistSize: String
    @State private var radius: Int?
    @State private var video: String
    @State private var error: String?
    @State private var saved = false

    init(artist: Artist) {
        self.artist = artist
        _name = State(initialValue: artist.name); _place = State(initialValue: artist.place)
        _genres = State(initialValue: artist.genres); _bio = State(initialValue: artist.bio)
        _availability = State(initialValue: artist.availability); _artistSize = State(initialValue: artist.artistSize)
        _radius = State(initialValue: artist.travelRadiusMiles); _video = State(initialValue: artist.liveVideoUrl ?? "")
    }

    var body: some View {
        EditorSection(title: "About you") {
            LabeledField(label: "Artist name") { TextField("Your name", text: $name).fieldStyle() }
            PlaceField(label: "Based in", place: $place, hint: "Promoters see this place, not your exact position. Choose it from the search to appear in distance searches.")
            LabeledField(label: "Availability") { picker($availability, Catalog.availabilities.map { ($0, Catalog.availabilityLabel($0)) }) }
            LabeledField(label: "Artist size", hint: "Used to show how well a listing fits you.") { picker($artistSize, Catalog.artistSizes.map { ($0, Catalog.artistSizeLabel($0)) }) }
            LabeledField(label: "Travel radius (miles)") { IntField(value: $radius, placeholder: "50") }
            LabeledField(label: "Genres (up to 5)") { ChoiceChips(options: Catalog.genres, selection: $genres, limit: 5) }
            LabeledField(label: "Bio", hint: "\(bio.count)/1000") {
                TextArea(text: $bio, placeholder: "What do you sound like, and what’s your live show like?", minHeight: 120)
                    .onChange(of: bio) { _, new in if new.count > 1000 { bio = String(new.prefix(1000)) } }
            }
            LabeledField(label: "Live performance video (link)", hint: "Shown to promoters as a link to watch you play live. We don’t host the video.") {
                TextField("https://youtube.com/watch?v=…", text: $video).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().fieldStyle()
            }
            AsyncButton(compact: true) { await save() } label: { Text("Save") }
            SaveStatus(error: error, saved: saved)
        }
    }

    private func picker(_ selection: Binding<String>, _ options: [(String, String)]) -> some View {
        Menu {
            Picker("", selection: selection) { ForEach(options, id: \.0) { Text($0.1).tag($0.0) } }
        } label: {
            HStack { Text(options.first { $0.0 == selection.wrappedValue }?.1 ?? "").foregroundStyle(Theme.paper); Spacer(); Image(systemName: "chevron.up.chevron.down").foregroundStyle(Theme.paperDim) }.fieldStyle()
        }
    }

    private func save() async {
        error = nil; saved = false
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedName.isEmpty { error = "Enter your artist name."; return }
        if genres.isEmpty { error = "Choose at least one genre."; return }
        guard let place, place.validationError == nil else { error = place?.validationError ?? "Choose where you’re based."; return }
        guard let miles = radius, (0...500).contains(miles) else { error = "Travel radius must be a whole number of miles between 0 and 500."; return }
        let link = video.trimmingCharacters(in: .whitespaces)
        if !link.isEmpty, !SafeLink.isSafe(link) { error = "The live video link must start with https://"; return }
        do {
            try await store.perform {
                if place != artist.place { try await store.db.setMyLocation(place) }
                try await store.db.updateArtistBasics(id: artist.id, name: trimmedName, genres: genres, bio: bio.trimmingCharacters(in: .whitespacesAndNewlines),
                                                      availability: availability, travelRadiusMiles: miles, artistSize: artistSize, liveVideoUrl: link.isEmpty ? nil : link)
            }
            saved = true
        } catch { self.error = (error as? AppError)?.message }
    }
}

// MARK: - Tracks

private struct TracksEditor: View {
    @Environment(AppStore.self) private var store
    let artist: Artist
    @State private var title = ""
    @State private var duration = ""
    @State private var url = ""
    @State private var error: String?

    var body: some View {
        EditorSection(title: "Your tracks", subtitle: "When you apply, you pick one track to feature. Add a link so promoters can listen.") {
            ForEach(Array(artist.tracks.enumerated()), id: \.element.id) { i, t in
                TrackRowEditor(artist: artist, track: t, index: i).id(t.id + t.title + t.duration + (t.url ?? ""))
            }
            MonoLabel("Add a track")
            TextField("Title", text: $title).fieldStyle()
            HStack(spacing: 10) {
                TextField("3:24", text: $duration).keyboardType(.numbersAndPunctuation).fieldStyle().frame(width: 100)
                TextField("Link to the song (optional)", text: $url).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().fieldStyle()
            }
            if let error { Banner(kind: .error, text: error) }
            AsyncButton(compact: true) { await add() } label: { Text("Add track") }
        }
    }

    private func add() async {
        error = nil
        if title.trimmingCharacters(in: .whitespaces).isEmpty { error = "Give the track a title."; return }
        if !TrackRules.isValidDuration(duration) { error = "Enter the length as m:ss, e.g. 3:24."; return }
        if let problem = TrackRules.urlError(url) { error = problem; return }
        do {
            let link = url.trimmingCharacters(in: .whitespaces)
            try await store.perform { try await store.db.addTrack(artistId: artist.id, title: title, duration: duration, url: link.isEmpty ? nil : link, sortOrder: artist.tracks.count) }
            title = ""; duration = ""; url = ""
        } catch { self.error = (error as? AppError)?.message }
    }
}

private struct TrackRowEditor: View {
    @Environment(AppStore.self) private var store
    let artist: Artist
    let track: Track
    let index: Int
    @State private var title: String
    @State private var duration: String
    @State private var url: String
    @State private var error: String?
    @State private var saved = false
    @State private var confirmDelete = false

    init(artist: Artist, track: Track, index: Int) {
        self.artist = artist; self.track = track; self.index = index
        _title = State(initialValue: track.title); _duration = State(initialValue: track.duration); _url = State(initialValue: track.url ?? "")
    }

    private var dirty: Bool { title != track.title || duration != track.duration || url != (track.url ?? "") }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Title", text: $title).fieldStyle().accessibilityLabel("Track \(index + 1) title")
            HStack(spacing: 10) {
                TextField("3:24", text: $duration).keyboardType(.numbersAndPunctuation).fieldStyle().frame(width: 100).accessibilityLabel("Track \(index + 1) length")
                TextField("Link (optional)", text: $url).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().fieldStyle().accessibilityLabel("Track \(index + 1) link")
            }
            HStack(spacing: 12) {
                AsyncButton(compact: true) { await save() } label: { Text("Save track") }.disabled(!dirty)
                Button("Remove") { confirmDelete = true }.buttonStyle(.app(.ghost, compact: true)).foregroundStyle(Theme.signal)
            }
            SaveStatus(error: error, saved: saved)
        }
        .padding(12)
        .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
        .alert("Remove “\(track.title)”?", isPresented: $confirmDelete) {
            Button("Remove", role: .destructive) { Task { await remove() } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Applications already sent keep working.") }
    }

    private func save() async {
        error = nil; saved = false
        if title.trimmingCharacters(in: .whitespaces).isEmpty { error = "Give the track a title."; return }
        if !TrackRules.isValidDuration(duration) { error = "Enter the length as m:ss, e.g. 3:24."; return }
        if let problem = TrackRules.urlError(url) { error = problem; return }
        do {
            let link = url.trimmingCharacters(in: .whitespaces)
            try await store.perform { try await store.db.updateTrack(artistId: artist.id, trackId: track.id, title: title, duration: duration, url: link.isEmpty ? nil : link) }
            saved = true
        } catch { self.error = (error as? AppError)?.message }
    }

    private func remove() async {
        do { try await store.perform { try await store.db.deleteTrack(artistId: artist.id, trackId: track.id) } }
        catch { self.error = (error as? AppError)?.message }
    }
}

// MARK: - Links

private struct LinksEditor: View {
    @Environment(AppStore.self) private var store
    let artist: Artist
    @State private var links: ArtistLinks
    @State private var error: String?
    @State private var saved = false

    init(artist: Artist) { self.artist = artist; _links = State(initialValue: ArtistLinks(artist: artist)) }

    var body: some View {
        EditorSection(title: "Links", subtitle: "Where promoters can listen to you and find you. Full links starting with https://") {
            ForEach(PlatformLink.Platform.allCases, id: \.self) { p in
                LabeledField(label: p.label, error: links.errors[p]) {
                    TextField(placeholder(p), text: Binding(get: { links.value(p) }, set: { links.set(p, $0) }))
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().fieldStyle(invalid: links.errors[p] != nil)
                }
            }
            AsyncButton(compact: true) { await save() } label: { Text("Save links") }
            SaveStatus(error: error, saved: saved)
        }
    }

    private func placeholder(_ p: PlatformLink.Platform) -> String {
        switch p {
        case .spotify: return "https://open.spotify.com/artist/…"
        case .instagram: return "https://instagram.com/…"
        case .tiktok: return "https://tiktok.com/@…"
        case .youtube: return "https://youtube.com/@…"
        case .soundcloud: return "https://soundcloud.com/…"
        case .bandcamp: return "https://….bandcamp.com"
        case .website: return "https://…"
        }
    }

    private func save() async {
        error = nil; saved = false
        if !links.errors.isEmpty { error = "Fix the highlighted links first."; return }
        do { try await store.perform { try await store.db.updateArtistLinks(id: artist.id, links: links) }; saved = true }
        catch { self.error = (error as? AppError)?.message }
    }
}

// MARK: - Monthly listeners

private struct ListenersEditor: View {
    @Environment(AppStore.self) private var store
    let artist: Artist
    @State private var value: Int?
    @State private var error: String?
    @State private var saved = false

    init(artist: Artist) { self.artist = artist; _value = State(initialValue: artist.monthlyListeners) }

    var body: some View {
        EditorSection(title: "Monthly listeners", subtitle: "Self-reported and shown as such on your profile. We don’t pull this from Spotify and don’t verify it.") {
            IntField(value: $value, placeholder: "e.g. 3200")
            AsyncButton(compact: true) { await save() } label: { Text("Save") }
            SaveStatus(error: error, saved: saved)
        }
    }

    private func save() async {
        error = nil; saved = false
        do { try await store.perform { try await store.db.updateMonthlyListeners(id: artist.id, value: value) }; saved = true }
        catch { self.error = (error as? AppError)?.message }
    }
}
