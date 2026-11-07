import XCTest
@testable import SupportSlot

final class ShowDetailsTests: XCTestCase {
    func testMomentUsesUKTimeInSummerAndWinter() throws {
        let summer = try XCTUnwrap(ShowDetails.moment(date: "2026-07-10", time: "19:00:00"))
        let winter = try XCTUnwrap(ShowDetails.moment(date: "2026-12-10", time: "19:00"))
        
        var cal = Calendar(identifier: .gregorian); cal.timeZone = ShowDetails.london
        XCTAssertEqual(cal.component(.hour, from: winter), 19)
        XCTAssertEqual(cal.component(.hour, from: summer), 19)
    }
    func testBadInputIsNil() {
        XCTAssertNil(ShowDetails.moment(date: "nope", time: "19:00"))
        XCTAssertNil(ShowDetails.moment(date: "2026-07-10", time: "25:00"))
    }
}
