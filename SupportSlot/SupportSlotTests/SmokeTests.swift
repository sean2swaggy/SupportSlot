import XCTest
@testable import SupportSlot

final class SmokeTests: XCTestCase {
    func testBundleIsConfigured() {
        XCTAssertEqual(Bundle.main.bundleIdentifier, "com.supportslot.app")
    }
}
