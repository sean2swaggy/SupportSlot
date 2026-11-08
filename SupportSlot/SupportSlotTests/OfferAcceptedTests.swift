import XCTest
@testable import SupportSlot

final class OfferAcceptedTests: XCTestCase {
    func testOnlyAnOfferBecomingABookingCelebrates() {
        XCTAssertTrue(OfferAcceptedRule.shouldCelebrate(from: .offered, to: .confirmed))
        XCTAssertFalse(OfferAcceptedRule.shouldCelebrate(from: .shortlisted, to: .confirmed))
        XCTAssertFalse(OfferAcceptedRule.shouldCelebrate(from: .offered, to: .offerDeclined))
        XCTAssertFalse(OfferAcceptedRule.shouldCelebrate(from: .confirmed, to: .confirmed))
        XCTAssertFalse(OfferAcceptedRule.shouldCelebrate(from: .confirmed, to: .cancelled))
    }
}
