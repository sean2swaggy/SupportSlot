import Foundation
import Observation

/// Loads and pages public listing search. "Loading" and "failed" are explicit
/// states so a failed search shows a retry, never a misleading empty list.
@MainActor
@Observable
final class DiscoverModel {
    enum Status: Equatable { case idle, loading, loaded, failed(AppError) }

    private(set) var slots: [Slot] = []
    private(set) var total = 0
    private(set) var page = 0
    private(set) var status: Status = .idle
    private(set) var loadingMore = false
    private(set) var loadMoreError: AppError?

    var hasMore: Bool { slots.count < total }
    private var generation = 0

    func reload(db: Database, filters: SlotFilters, artistCity: String?) async {
        generation += 1
        let mine = generation
        status = .loading
        loadMoreError = nil
        do {
            let result = try await db.searchSlots(filters.search(artistCity: artistCity, page: 1))
            guard mine == generation else { return }
            slots = result.slots; total = result.total; page = 1; status = .loaded
        } catch is CancellationError {
            return
        } catch {
            guard mine == generation else { return }
            status = .failed((error as? AppError) ?? .generic("We couldn’t load listings just now. Please try again."))
        }
    }

    func loadMore(db: Database, filters: SlotFilters, artistCity: String?) async {
        guard status == .loaded, hasMore, !loadingMore else { return }
        loadingMore = true
        loadMoreError = nil
        let mine = generation
        defer { loadingMore = false }
        do {
            let result = try await db.searchSlots(filters.search(artistCity: artistCity, page: page + 1))
            guard mine == generation else { return }
            let known = Set(slots.map(\.id))
            slots += result.slots.filter { !known.contains($0.id) }
            total = result.total; page += 1
        } catch is CancellationError {
            return
        } catch {
            loadMoreError = (error as? AppError) ?? .generic()
        }
    }
}
