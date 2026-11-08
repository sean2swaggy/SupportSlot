import XCTest
@testable import SupportSlot

/// Tapping a notification must always lead somewhere.
@MainActor
final class NotificationRoutingTests: XCTestCase {
    func testAnApplicationLinkOpensThatApplicationForAnArtist() {
        let store = AppStore()
        store.open(href: "/application/3f2c1b0a-0000-4000-8000-000000000001")
        XCTAssertEqual(store.presentedApplicationID, "3f2c1b0a-0000-4000-8000-000000000001")
    }

    func testAListingLinkDoesNotOpenAnArtistsScreenButStillGoesSomewhere() {
        let store = AppStore()
        store.selectedTab = .discover
        store.open(href: "/listing/3f2c1b0a-0000-4000-8000-000000000002")
        XCTAssertNil(store.presentedListingID)
        XCTAssertEqual(store.selectedTab, .applications)
    }

    func testOlderLinksStillWork() {
        let store = AppStore()
        store.open(href: "/applications")
        XCTAssertEqual(store.selectedTab, .applications)
        store.open(href: "/messages?thread=abc")
        XCTAssertEqual(store.selectedTab, .messages)
        XCTAssertEqual(store.pendingThreadID, "abc")
        store.open(href: "/slot/xyz")
        XCTAssertEqual(store.presentedSlotID, "xyz")
    }

    func testEmptyOrUnknownLinksDoNothingHarmful() {
        let store = AppStore()
        store.selectedTab = .discover
        store.open(href: nil)
        store.open(href: "")
        store.open(href: "/something-new")
        XCTAssertEqual(store.selectedTab, .discover)
        XCTAssertNil(store.presentedApplicationID)
    }
}
