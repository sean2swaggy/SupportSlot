import SwiftUI

struct RatingStars: View {
    let rating: Double
    var size: CGFloat = 14
    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...5, id: \.self) { i in
                Image(systemName: rating >= Double(i) - 0.25 ? "star.fill" : (rating >= Double(i) - 0.75 ? "star.leadinghalf.filled" : "star"))
                    .font(.system(size: size)).foregroundStyle(Theme.acid)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Real reviews left by the other side after a show: the average, the count, and the latest few notes.
struct ReviewsSummary: View {
    @Environment(AppStore.self) private var store
    let profileId: ID
    @State private var reviews: [Review] = []
    @State private var loaded = false

    var body: some View {
        Group {
            if let avg = ReviewMath.average(reviews) {
                VStack(alignment: .leading, spacing: 10) {
                    MonoLabel("Reviews")
                    HStack(spacing: 8) {
                        RatingStars(rating: avg)
                        Text(String(format: "%.1f", avg)).font(Theme.body(15, weight: .medium)).foregroundStyle(Theme.paper)
                        Text("· \(reviews.count) review\(reviews.count == 1 ? "" : "s")").font(Theme.body(13)).foregroundStyle(Theme.paperDim)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Rated \(String(format: "%.1f", avg)) out of 5 from \(reviews.count) review\(reviews.count == 1 ? "" : "s")")
                    ForEach(reviews.filter { !($0.comment ?? "").isEmpty }.prefix(3)) { r in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("“\(r.comment ?? "")”").font(Theme.body(14)).foregroundStyle(Theme.paper)
                            Text("\(r.reviewerName) · \(UKDates.timeAgo(r.createdAt))").font(Theme.mono(10)).foregroundStyle(Theme.paperDim)
                        }
                        .padding(.leading, 12).overlay(alignment: .leading) { Rectangle().fill(Theme.inkBorder).frame(width: 2) }
                    }
                }
            }
        }
        .task(id: profileId) {
            guard !loaded else { return }
            reviews = (try? await store.db.reviews(about: profileId)) ?? []
            loaded = true
        }
    }
}

/// On a confirmed booking whose show has happened: leave one review, or see the one you left.
struct LeaveReviewSection: View {
    @Environment(AppStore.self) private var store
    let booking: Booking
    @State private var mine: Review?
    @State private var checked = false
    @State private var showing = false

    private var showHasHappened: Bool { UKDates.daysUntil(booking.eventDate) < 0 }

    var body: some View {
        Group {
            if booking.bookingStatus == .confirmed, showHasHappened, checked {
                VStack(alignment: .leading, spacing: 8) {
                    MonoLabel("How did it go?")
                    if let mine {
                        HStack(spacing: 8) { RatingStars(rating: Double(mine.rating)); Text("You reviewed this show.").font(Theme.body(13)).foregroundStyle(Theme.paperDim) }
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel("You gave this show \(mine.rating) out of 5")
                    } else {
                        Button { showing = true } label: { Label("Leave a review", systemImage: "star") }.buttonStyle(.app(.outline, compact: true))
                    }
                }
            }
        }
        .task(id: booking.id) {
            guard booking.bookingStatus == .confirmed, showHasHappened, let uid = store.userId else { return }
            mine = try? await store.db.myReview(bookingId: booking.id, reviewerId: uid)
            checked = true
        }
        .sheet(isPresented: $showing) {
            NavigationStack { ReviewSheet(booking: booking) { review in mine = review } }.environment(store).presentationBackground(Theme.ink)
        }
    }
}

struct ReviewSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let booking: Booking
    let onDone: (Review?) -> Void
    @State private var rating = 0
    @State private var comment = ""
    @State private var error: String?

    private var otherName: String { store.role == .artist ? booking.promoterCompany : booking.artistName }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Review \(otherName)").font(Theme.display(26)).foregroundStyle(Theme.paper)
                Text("\(booking.headliner) · \(UKDates.formatShowDate(booking.eventDate, withYear: true)). Be fair and specific — this is public to signed-in members. You can’t edit it afterwards.").dimBody(14)
                HStack(spacing: 6) {
                    ForEach(1...5, id: \.self) { i in
                        Button { rating = i } label: {
                            Image(systemName: i <= rating ? "star.fill" : "star").font(.system(size: 34)).foregroundStyle(Theme.acid).frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel("\(i) star\(i == 1 ? "" : "s")").accessibilityAddTraits(i == rating ? .isSelected : [])
                    }
                }
                LabeledField(label: "A short note (optional)", hint: "\(comment.count)/500") {
                    TextArea(text: $comment, placeholder: "How was the show to work on?", minHeight: 110)
                }
                if let error { Banner(kind: .error, text: error) }
                AsyncButton { await send() } label: { Text("Post review") }.disabled(rating == 0)
            }
            .padding(20)
        }
        .screenBackground()
        .navigationTitle("Review").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } } }
    }

    private func send() async {
        error = nil
        do {
            try await store.db.submitReview(bookingId: booking.id, rating: rating, comment: comment.count > 500 ? String(comment.prefix(500)) : comment)
            if let uid = store.userId { onDone(try? await store.db.myReview(bookingId: booking.id, reviewerId: uid)) }
            dismiss()
        } catch { self.error = (error as? AppError)?.message ?? "Couldn’t post your review." }
    }
}

/// Artists' saved searches: see them, remove them. Alerts arrive as in-app notifications.
struct SavedSearchesView: View {
    @Environment(AppStore.self) private var store
    @State private var items: [SavedSearch] = []
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Eyebrow("Alerts")
                DisplayTitle("Saved searches", size: 30)
                Text("We’ll tell you in the app when a new slot matches one of these. Save one from Discover after choosing a genre or a distance.").dimBody(14)
                if let error { Banner(kind: .error, text: error) }
                if loaded && items.isEmpty { EmptyState(title: "No saved searches", message: "Choose a genre or distance in Discover, then tap “Save this search”.") }
                ForEach(items) { s in
                    Card {
                        HStack(alignment: .center, spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(s.label).font(Theme.body(16, weight: .medium)).foregroundStyle(Theme.paper)
                                Text(detail(s)).font(Theme.body(12)).foregroundStyle(Theme.paperDim)
                            }
                            Spacer()
                            AsyncButton(kind: .danger, compact: true) { await remove(s) } label: { Text("Delete") }.frame(width: 90)
                        }
                    }
                }
            }
            .padding(20)
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func detail(_ s: SavedSearch) -> String {
        var parts: [String] = []
        if !s.genres.isEmpty { parts.append(s.genres.joined(separator: ", ")) }
        if let m = s.maxMiles { parts.append("within \(m) miles of your base") }
        return parts.joined(separator: " · ")
    }

    private func load() async {
        do { items = try await store.db.savedSearches(); error = nil } catch { self.error = (error as? AppError)?.message ?? "Couldn’t load your saved searches." }
        loaded = true
    }

    private func remove(_ s: SavedSearch) async {
        do { try await store.db.deleteSavedSearch(id: s.id); items.removeAll { $0.id == s.id } }
        catch { self.error = (error as? AppError)?.message ?? "Couldn’t delete that." }
    }
}
