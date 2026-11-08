import XCTest
import StoreKit
import StoreKitTest
@testable import SupportSlot

final class PlanRulesTests: XCTestCase {
    func testFreePromoterGetsOneOpenListing() {
        XCTAssertTrue(PlanRules.canPostAnother(openListings: 0, hasTeam: false))
        XCTAssertFalse(PlanRules.canPostAnother(openListings: 1, hasTeam: false))
        XCTAssertFalse(PlanRules.canPostAnother(openListings: 5, hasTeam: false))
        XCTAssertTrue(PlanRules.canPostAnother(openListings: 50, hasTeam: true))
    }

    func testPurchaseOnlyCountsForTheAccountItWasBoughtOn() {
        let a = UUID(), b = UUID()
        XCTAssertTrue(PlanRules.entitlementApplies(token: a, user: a))
        XCTAssertFalse(PlanRules.entitlementApplies(token: a, user: b))
        XCTAssertFalse(PlanRules.entitlementApplies(token: nil, user: a))
        XCTAssertFalse(PlanRules.entitlementApplies(token: a, user: nil))
    }

    func testRefundedOrExpiredIsNotActive() {
        let now = Date()
        XCTAssertTrue(PlanRules.isActive(revoked: false, expires: nil, now: now))
        XCTAssertTrue(PlanRules.isActive(revoked: false, expires: now.addingTimeInterval(60), now: now))
        XCTAssertFalse(PlanRules.isActive(revoked: false, expires: now.addingTimeInterval(-1), now: now))
        XCTAssertFalse(PlanRules.isActive(revoked: true, expires: nil, now: now))
    }
}

final class DiaryMathTests: XCTestCase {
    func testPoundsToPence() {
        XCTAssertEqual(DiaryMath.pence(fromPounds: ""), 0)
        XCTAssertEqual(DiaryMath.pence(fromPounds: "150"), 15000)
        XCTAssertEqual(DiaryMath.pence(fromPounds: "150.5"), 15050)
        XCTAssertEqual(DiaryMath.pence(fromPounds: "£1,250.00"), 125000)
        XCTAssertEqual(DiaryMath.pence(fromPounds: ".99"), 99)
        XCTAssertNil(DiaryMath.pence(fromPounds: "-5"))
        XCTAssertNil(DiaryMath.pence(fromPounds: "1.234"))
        XCTAssertNil(DiaryMath.pence(fromPounds: "abc"))
        XCTAssertNil(DiaryMath.pence(fromPounds: "1.2.3"))
        XCTAssertNil(DiaryMath.pence(fromPounds: "100000.01"))
        XCTAssertEqual(DiaryMath.pence(fromPounds: "100000"), 10_000_000)
    }

    func testUKTaxYearRollsOverOnSixApril() {
        XCTAssertEqual(DiaryMath.taxYear(of: "2026-04-05"), "2025/26")
        XCTAssertEqual(DiaryMath.taxYear(of: "2026-04-06"), "2026/27")
        XCTAssertEqual(DiaryMath.taxYear(of: "2026-12-31"), "2026/27")
        XCTAssertEqual(DiaryMath.taxYear(of: "2027-01-01"), "2026/27")
        XCTAssertEqual(DiaryMath.taxYear(of: "2099-06-01"), "2099/00")
        XCTAssertNil(DiaryMath.taxYear(of: "nope"))
    }

    private func entry(_ date: String, venue: String, fee: Int, exp: Int, notes: String? = nil) throws -> GigDiaryEntry {
        let json = """
        {"id":"e","artist_id":"a","booking_id":null,"show_date":"\(date)","venue":\(String(data: try JSONEncoder().encode(venue), encoding: .utf8)!),
         "city":null,"promoter":null,"fee_pence":\(fee),"expenses_pence":\(exp),"set_list":null,
         "notes":\(notes.map { String(data: try! JSONEncoder().encode($0), encoding: .utf8)! } ?? "null"),"created_at":"2026-01-01T10:00:00Z"}
        """
        let d = JSONDecoder(); d.keyDecodingStrategy = .convertFromSnakeCase; d.dateDecodingStrategy = .iso8601
        return try d.decode(GigDiaryEntry.self, from: Data(json.utf8))
    }

    func testTotalsAndGrouping() throws {
        let es = [try entry("2026-05-01", venue: "A", fee: 15000, exp: 2000), try entry("2026-03-01", venue: "B", fee: 10000, exp: 0), try entry("2026-06-01", venue: "C", fee: 5000, exp: 6000)]
        XCTAssertEqual(DiaryMath.totals(es), DiaryMath.Totals(count: 3, fee: 30000, expenses: 8000))
        XCTAssertEqual(DiaryMath.totals(es).net, 22000)
        let groups = DiaryMath.byTaxYear(es)
        XCTAssertEqual(groups.map(\.year), ["2026/27", "2025/26"])
        XCTAssertEqual(groups[0].entries.map(\.venue), ["C", "A"])
    }

    func testCSVNeutralisesFormulasKeepsNumbersAndQuotes() throws {
        let es = [try entry("2026-05-01", venue: "=HYPERLINK(\"x\")", fee: 5000, exp: 6000, notes: "line1\nline2, \"quoted\"")]
        let csv = DiaryMath.csv(es)
        let lines = csv.split(separator: "\n").map(String.init)
        XCTAssertEqual(lines.count, 2)
        XCTAssertTrue(lines[1].contains("\"'=HYPERLINK(\"\"x\"\")\""), lines[1])
        XCTAssertTrue(lines[1].contains("\"-10.00\""), lines[1])           // a negative net stays a number
        XCTAssertTrue(lines[1].contains("line1 line2, \"\"quoted\"\""), lines[1])
    }

    func testDraftValidation() {
        var d = DiaryDraft()
        XCTAssertEqual(d.problem, "Enter the venue.")
        d.venue = "The Old Hall"
        XCTAssertNil(d.problem)
        d.fee = "ten"
        XCTAssertNotNil(d.problem)
    }
}

/// Runs Apple's purchase flow against a local StoreKit configuration (no real money, no network).
@MainActor
final class PurchaseStoreTests: XCTestCase {
    private func session() throws -> SKTestSession {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Config/SupportSlot.storekit")
        let s = try SKTestSession(contentsOf: url)
        s.resetToDefaultState(); s.clearTransactions(); s.disableDialogs = true
        return s
    }

    func testProductsLoadWithTheAgreedPrices() async throws {
        _ = try session()
        let store = PurchaseStore()
        await store.loadProducts()
        XCTAssertEqual(store.products[ProductID.gigDiary]?.displayPrice, "£5.99")
        XCTAssertEqual(store.products[ProductID.teamMonthly]?.displayPrice, "£19.99")
        XCTAssertEqual(store.products[ProductID.teamYearly]?.displayPrice, "£49.99")
    }

    func testBuyingTheDiaryUnlocksItOnlyForTheBuyer() async throws {
        _ = try session()
        let store = PurchaseStore()
        let me = UUID()
        await store.setUser(me)
        await store.loadProducts()
        let product = try XCTUnwrap(store.products[ProductID.gigDiary])
        XCTAssertFalse(store.hasGigDiary)
        let outcome = await store.purchase(product)
        XCTAssertEqual(outcome, .purchased)
        XCTAssertTrue(store.hasGigDiary)
        XCTAssertFalse(store.hasTeam)
        await store.setUser(UUID())                 // someone else logs in on the same phone
        XCTAssertFalse(store.hasGigDiary)
        await store.setUser(me)                     // and back again
        XCTAssertTrue(store.hasGigDiary)
    }

    func testTeamSubscriptionUnlocksTeamNotTheDiary() async throws {
        _ = try session()
        let store = PurchaseStore()
        await store.setUser(UUID())
        await store.loadProducts()
        let outcome = await store.purchase(try XCTUnwrap(store.products[ProductID.teamYearly]))
        XCTAssertEqual(outcome, .purchased)
        XCTAssertTrue(store.hasTeam)
        XCTAssertFalse(store.hasGigDiary)
    }

    func testCannotBuyWhileLoggedOut() async throws {
        _ = try session()
        let store = PurchaseStore()
        await store.loadProducts()
        let outcome = await store.purchase(try XCTUnwrap(store.products[ProductID.teamMonthly]))
        XCTAssertEqual(outcome, .failed("Log in to buy this."))
        XCTAssertFalse(store.hasTeam)
    }
}
