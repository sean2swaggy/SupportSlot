import SwiftUI

/// The promoter's home: their listings, what needs attention, and posting a new one.
struct MyGigsView: View {
    @Environment(AppStore.self) private var store
    @Environment(PurchaseStore.self) private var purchases
    @State private var showPaywall = false

    private var openCount: Int { store.myListings.filter { $0.slotStatus == .open }.count }
    private var toReview: Int { store.applications.filter { [.submitted, .viewed].contains($0.applicationStatus) }.count }
    private var shortlisted: Int { store.applications.filter { $0.applicationStatus == .shortlisted }.count }
    private var booked: Int { store.applications.filter { $0.applicationStatus == .confirmed }.count }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow(store.promoter?.company ?? "Your gigs")
                    DisplayTitle("My gigs", size: 34)
                }
                if PlanRules.canPostAnother(openListings: openCount, hasTeam: purchases.hasTeam) {
                    NavigationLink { ListingFormView() } label: { Label("Post a support slot", systemImage: "plus") }.buttonStyle(.appPrimary)
                } else {
                    Button { showPaywall = true } label: { Label("Post another slot", systemImage: "lock") }.buttonStyle(.appPrimary)
                    Text("The free plan has \(PlanRules.freeLiveListings) open listing at a time. Close or fill it, or get the Team plan for unlimited listings.").dimBody(12)
                }

                if store.myListings.isEmpty || booked == 0 { gettingStarted }

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    stat("Open listings", openCount)
                    stat("To review", toReview)
                    stat("Shortlisted", shortlisted)
                    stat("Booked", booked)
                }

                if toReview > 0 {
                    Banner(kind: .info, text: "\(toReview) application\(toReview == 1 ? "" : "s") to review. Open a listing to shortlist, decline or make an offer.")
                }

                MonoLabel("Your listings")
                if store.myListings.isEmpty {
                    EmptyState(title: "No shows posted yet", message: "Post your first support slot — artists can apply within minutes.")
                } else {
                    ForEach(store.myListings) { slot in
                        NavigationLink(value: slot) { ListingSummaryCard(slot: slot, applications: store.applications.filter { $0.slotId == slot.id }) }.buttonStyle(.plain)
                    }
                }
            }
            .padding(20)
        }
        .refreshable { await store.refresh() }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Slot.self) { ApplicantsView(slotId: $0.id) }
        .sheet(isPresented: $showPaywall) { PaywallSheet(feature: .team).environment(store).environment(purchases) }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { NotificationsButton() } }
    }

    private var gettingStarted: some View {
        let steps: [(String, Bool)] = [
            ("Set up your promoter profile", true),
            ("Post your first support slot — you’ll add your venue as you go", !store.myListings.isEmpty),
            ("Review applicants and send an offer", !store.applications.filter { [.offered, .confirmed].contains($0.applicationStatus) }.isEmpty),
            ("Get a confirmed booking", booked > 0),
        ]
        return Card {
            VStack(alignment: .leading, spacing: 10) {
                MonoLabel("Getting started")
                ForEach(Array(steps.enumerated()), id: \.offset) { _, step in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: step.1 ? "checkmark.square.fill" : "square").foregroundStyle(step.1 ? Theme.acid : Theme.paperDim)
                        Text(step.0).font(Theme.body(14)).foregroundStyle(step.1 ? Theme.paperDim : Theme.paper)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityValue(step.1 ? "Done" : "To do")
                }
            }
        }
    }

    private func stat(_ label: String, _ value: Int) -> some View {
        Card { VStack(alignment: .leading, spacing: 4) { Text("\(value)").font(Theme.display(30)).foregroundStyle(Theme.acid); MonoLabel(label) } }
            .accessibilityElement(children: .combine)
    }
}

struct ListingSummaryCard: View {
    let slot: Slot
    let applications: [Application]

    var body: some View {
        let counts = (new: applications.filter { $0.applicationStatus == .submitted }.count,
                      viewed: applications.filter { $0.applicationStatus == .viewed }.count,
                      shortlisted: applications.filter { $0.applicationStatus == .shortlisted }.count,
                      offered: applications.filter { $0.applicationStatus == .offered }.count,
                      confirmed: applications.filter { $0.applicationStatus == .confirmed }.count)
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(slot.headliner).font(Theme.display(20)).foregroundStyle(Theme.paper).multilineTextAlignment(.leading)
                    Text([slot.venue?.name, slot.city].compactMap { $0 }.joined(separator: " · ")).dimBody(13)
                }
                Spacer(minLength: 8)
                Tag(slot.slotStatus.rawValue, tint: slot.slotStatus == .open ? Theme.ok : slot.slotStatus == .filled ? Theme.acid : Theme.paperDim)
            }
            HStack(spacing: 14) {
                Label(UKDates.shortDate(slot.date), systemImage: "calendar").font(Theme.mono(12)).foregroundStyle(Theme.paper)
                Label(Money.gbp(slot.supportFee), systemImage: "sterlingsign.circle").font(Theme.mono(12)).foregroundStyle(Theme.acid)
            }
            FlowLayout(spacing: 6) {
                Tag("\(max(slot.applicantCount, applications.count)) applicant\(max(slot.applicantCount, applications.count) == 1 ? "" : "s")")
                if counts.new > 0 { Tag("\(counts.new) new", tint: Theme.acid, filled: true) }
                if counts.viewed > 0 { Tag("\(counts.viewed) viewed") }
                if counts.shortlisted > 0 { Tag("\(counts.shortlisted) shortlisted", tint: Theme.acid) }
                if counts.offered > 0 { Tag("\(counts.offered) offered", tint: Theme.acid) }
                if counts.confirmed > 0 { Tag("booked", tint: Theme.ok, filled: true) }
            }
            if slot.slotStatus == .open { Text(UKDates.applicationCloseText(slot.applicationDeadline)).font(Theme.mono(10)).foregroundStyle(Theme.paperDim).textCase(.uppercase) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.inkCard)
        .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
