import Foundation
import Observation
import StoreKit

enum PurchaseOutcome: Equatable {
    case purchased, pending, cancelled
    case failed(String)
}

/// Apple in-app purchases: the Gig diary (once) and the Team plan (monthly or yearly).
/// Apple's StoreKit signs every transaction and checks it on the device; each purchase
/// is tied to the Support Slot account it was bought on, so it can't unlock another account.
@MainActor
@Observable
final class PurchaseStore {
    private(set) var products: [String: Product] = [:]
    private(set) var owned: Set<String> = []
    private(set) var loading = false
    private(set) var loadFailed = false

    /// The signed-in Support Slot account. Change it with `setUser`.
    private(set) var userId: UUID?

    /// Switches account. Nothing is shown as unlocked until this account's purchases are checked.
    func setUser(_ id: UUID?) async {
        if id != userId { userId = id; owned = [] }
        await refreshEntitlements()
    }

    var hasGigDiary: Bool { owned.contains(ProductID.gigDiary) }
    var hasTeam: Bool { !owned.isDisjoint(with: ProductID.team) }

    @ObservationIgnored private var updates: Task<Void, Never>?
    /// Only the newest refresh may write the result, so a slow older one can't overwrite a newer answer.
    @ObservationIgnored private var refreshGeneration = 0

    init() {
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                await self?.handle(result)
            }
        }
    }

    deinit { updates?.cancel() }

    func loadProducts() async {
        guard !loading else { return }
        loading = true; defer { loading = false }
        do {
            let found = try await Product.products(for: ProductID.all)
            products = Dictionary(uniqueKeysWithValues: found.map { ($0.id, $0) })
            loadFailed = found.isEmpty
        } catch {
            loadFailed = true
        }
    }

    func refreshEntitlements() async {
        refreshGeneration += 1
        let generation = refreshGeneration
        let user = userId
        var active: Set<String> = []
        for await result in Transaction.currentEntitlements {
            guard case .verified(let t) = result, ProductID.all.contains(t.productID) else { continue }
            guard PlanRules.isActive(revoked: t.revocationDate != nil, expires: t.expirationDate) else { continue }
            guard PlanRules.entitlementApplies(token: t.appAccountToken, user: user) else { continue }
            active.insert(t.productID)
        }
        guard generation == refreshGeneration else { return }
        owned = active
    }

    func purchase(_ product: Product) async -> PurchaseOutcome {
        guard let userId else { return .failed("Log in to buy this.") }
        do {
            let result = try await product.purchase(options: [.appAccountToken(userId)])
            switch result {
            case .success(let verification):
                guard case .verified(let transaction) = verification else {
                    return .failed("Apple couldn’t verify that purchase. You haven’t been charged for anything we couldn’t confirm — try again.")
                }
                await transaction.finish()
                await refreshEntitlements()
                return .purchased
            case .pending: return .pending
            case .userCancelled: return .cancelled
            @unknown default: return .failed("Something went wrong. Please try again.")
            }
        } catch {
            return .failed("The purchase didn’t go through. Please try again.")
        }
    }

    /// Asks Apple for this person's past purchases (new phone, reinstall).
    func restore() async -> Bool {
        do {
            try await StoreKit.AppStore.sync()
            await refreshEntitlements()
            return true
        } catch {
            return false
        }
    }

    private func handle(_ result: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = result else { return }
        await transaction.finish()
        await refreshEntitlements()
    }
}
