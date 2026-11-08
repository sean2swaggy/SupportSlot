import SwiftUI

/// Every application across all of a promoter's listings, filtered by what needs doing.
/// Reached by tapping the counts on My gigs. Tapping a person opens that listing's applicants.
struct ApplicationsOverviewView: View {
    enum Filter: String, CaseIterable, Identifiable {
        case toReview = "To review", shortlisted = "Shortlisted", offered = "Offered", booked = "Booked", all = "All"
        var id: String { rawValue }
        func includes(_ s: ApplicationStatus) -> Bool {
            switch self {
            case .toReview: return s == .submitted || s == .viewed
            case .shortlisted: return s == .shortlisted
            case .offered: return s == .offered
            case .booked: return s == .confirmed
            case .all: return true
            }
        }
    }

    @Environment(AppStore.self) private var store
    @State var filter: Filter

    private var rows: [Application] {
        store.applications.filter { filter.includes($0.applicationStatus) }.sorted { $0.submittedAt > $1.submittedAt }
    }

    private func count(_ f: Filter) -> Int { store.applications.filter { f.includes($0.applicationStatus) }.count }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Across all your listings")
                    DisplayTitle("Applicants", size: 32)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Filter.allCases) { f in
                            Button { filter = f } label: {
                                Text("\(f.rawValue.uppercased()) \(count(f))")
                                    .font(Theme.mono(11)).tracking(1)
                                    .foregroundStyle(filter == f ? Theme.acidInk : Theme.paper)
                                    .padding(.horizontal, 12).frame(minHeight: 40)
                                    .background(filter == f ? Theme.acid : .clear)
                                    .overlay(Rectangle().stroke(filter == f ? Theme.acid : Theme.inkBorder, lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(filter == f ? .isSelected : [])
                        }
                    }
                }
                if rows.isEmpty {
                    EmptyState(title: "Nobody here", message: filter == .toReview ? "New applications you haven’t dealt with yet show up here." : "No applicants in this view.")
                } else {
                    ForEach(rows) { app in
                        NavigationLink { ApplicantsView(slotId: app.slotId) } label: { row(app) }.buttonStyle(.plain)
                    }
                }
            }
            .padding(20)
        }
        .refreshable { await store.refresh() }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { NotificationsButton() } }
    }

    private func row(_ app: Application) -> some View {
        let listing = store.myListings.first { $0.id == app.slotId }
        return Card {
            HStack(alignment: .center, spacing: 12) {
                Avatar(imageUrl: app.artist?.imageUrl, name: app.artist?.name ?? "Artist", size: 48)
                VStack(alignment: .leading, spacing: 4) {
                    Text(app.artist?.name ?? "An artist").font(Theme.body(16, weight: .medium)).foregroundStyle(Theme.paper)
                    if let listing {
                        Text("\(listing.headliner) · \(UKDates.shortDate(listing.date))").font(Theme.body(12)).foregroundStyle(Theme.paperDim)
                    }
                    Text("Applied \(UKDates.timeAgo(app.submittedAt))").font(Theme.mono(10)).foregroundStyle(Theme.paperDim).textCase(.uppercase)
                }
                Spacer(minLength: 8)
                StatusPill(status: app.applicationStatus)
                Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(Theme.paperDim)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens this listing's applicants")
    }
}
