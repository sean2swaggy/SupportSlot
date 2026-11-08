import SwiftUI
import StoreKit

/// Explains an optional upgrade and sells it through Apple. Artists never pay to apply,
/// be booked or be seen — the only artist extra is the private Gig diary.
struct PaywallView: View {
    enum Feature { case team, gigDiary }

    let feature: Feature
    @Environment(PurchaseStore.self) private var purchases
    @State private var message: String?
    @State private var failed = false
    @State private var legal: LegalPage?
    @State private var manage = false

    private var owned: Bool { feature == .team ? purchases.hasTeam : purchases.hasGigDiary }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Eyebrow(feature == .team ? "Team plan" : "Gig diary")
            DisplayTitle(feature == .team ? "Run your nights like a pro" : "Keep track of your gigs", size: 28)
            Text(feature == .team
                 ? "Post as many slots as you like and unlock your private promoter tools."
                 : "A private diary of every show you play: what you were paid, what you spent, your set lists, and a tax-year export.").dimBody(14)

            Card {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(benefits, id: \.self) { b in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.acid).padding(.top, 3)
                            Text(b).font(Theme.body(14)).foregroundStyle(Theme.paper)
                        }
                    }
                }
            }

            if feature == .team {
                Text("Free promoters can have \(PlanRules.freeLiveListings) open listing at a time and still review applicants, message artists and send offers.").dimBody(12)
            } else {
                Text("Artists never pay to apply, be booked or be seen. The diary is a private extra and doesn’t change how promoters see you.").dimBody(12)
            }

            if owned {
                Banner(kind: .success, text: feature == .team ? "Your Team plan is active." : "You’ve unlocked the Gig diary.")
                if feature == .team {
                    Button("Manage subscription") { manage = true }.buttonStyle(.app(.outline, compact: true))
                }
            } else {
                purchaseButtons
            }

            if let message { Banner(kind: failed ? .error : .info, text: message) }

            Button("Restore purchases") { Task { await restore() } }.buttonStyle(.app(.ghost, compact: true))

            VStack(alignment: .leading, spacing: 8) {
                if feature == .team {
                    Text("Payment is charged to your Apple ID. The plan renews automatically at the price shown unless you cancel at least 24 hours before the period ends. Manage or cancel any time in Settings → your name → Subscriptions.")
                } else {
                    Text("One payment, charged to your Apple ID. No subscription. Restore it on a new phone with “Restore purchases”.")
                }
                HStack(spacing: 16) {
                    Button("Terms") { legal = .terms }
                    Button("Privacy") { legal = .privacy }
                }
                .font(Theme.mono(11)).foregroundStyle(Theme.paperDim)
            }
            .font(Theme.body(11)).foregroundStyle(Theme.paperDim)
        }
        .task { await purchases.loadProducts() }
        .manageSubscriptionsSheet(isPresented: $manage)
        .sheet(item: $legal) { page in NavigationStack { LegalView(document: page.document).navigationTitle(page.label) }.presentationBackground(Theme.ink) }
    }

    private var benefits: [String] {
        feature == .team
        ? ["Unlimited open listings", "Artist roster with private notes and tags", "Availability requests and templates", "Show schedules with clash checks", "Bookings export (CSV)"]
        : ["Log every show: venue, promoter, set list, notes", "Track fees and expenses, with totals per UK tax year", "Import your confirmed Support Slot shows in one tap", "Export your diary as a spreadsheet (CSV)"]
    }

    @ViewBuilder private var purchaseButtons: some View {
        let ids = feature == .team ? [ProductID.teamYearly, ProductID.teamMonthly] : [ProductID.gigDiary]
        let available = ids.compactMap { purchases.products[$0] }
        if available.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Banner(kind: .info, text: purchases.loading ? "Loading prices…" : "Purchases aren’t available right now. Check your connection and try again.")
                if !purchases.loading { Button("Try again") { Task { await purchases.loadProducts() } }.buttonStyle(.app(.outline, compact: true)) }
            }
        } else {
            VStack(spacing: 10) {
                ForEach(available, id: \.id) { product in
                    AsyncButton(kind: product.id == ProductID.teamMonthly ? .outline : .primary) { await buy(product) } label: {
                        Text(label(for: product))
                    }
                }
            }
        }
    }

    private func label(for product: Product) -> String {
        switch product.id {
        case ProductID.teamYearly: return "\(product.displayPrice) a year — best value"
        case ProductID.teamMonthly: return "\(product.displayPrice) a month"
        default: return "Unlock for \(product.displayPrice) — one payment"
        }
    }

    private func buy(_ product: Product) async {
        message = nil
        switch await purchases.purchase(product) {
        case .purchased: failed = false; message = "Thank you — it’s unlocked."
        case .pending: failed = false; message = "Your purchase is waiting for approval. It will unlock when it’s approved."
        case .cancelled: break
        case .failed(let m): failed = true; message = m
        }
    }

    private func restore() async {
        message = nil
        let ok = await purchases.restore()
        failed = !ok
        message = ok ? (owned ? "Restored." : "No earlier purchases found for this account.") : "Couldn’t reach the App Store. Please try again."
    }
}

/// A full-screen wrapper for places that present the paywall in a sheet.
struct PaywallSheet: View {
    let feature: PaywallView.Feature
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView { PaywallView(feature: feature).padding(20) }
                .screenBackground()
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } } }
        }
        .presentationBackground(Theme.ink)
    }
}

/// The paywall as a pushed screen (inside a NavigationStack).
struct PaywallScreen: View {
    let feature: PaywallView.Feature
    var body: some View {
        ScrollView { PaywallView(feature: feature).padding(20) }
            .screenBackground()
            .navigationBarTitleDisplayMode(.inline)
    }
}
