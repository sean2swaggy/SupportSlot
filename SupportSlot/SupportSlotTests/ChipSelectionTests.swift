import XCTest
@testable import SupportSlot

final class ChipSelectionTests: XCTestCase {
    func testTappingChoosesThenUnchooses() {
        var s: [String] = []
        s = ChipSelection.toggled("Folk", in: s, limit: 5); XCTAssertEqual(s, ["Folk"])
        s = ChipSelection.toggled("Rock", in: s, limit: 5); XCTAssertEqual(s, ["Folk", "Rock"])
        s = ChipSelection.toggled("Folk", in: s, limit: 5); XCTAssertEqual(s, ["Rock"])
    }

    func testAtTheLimitANewChipIsRefusedButARemovalWorks() {
        let full = ["A", "B", "C", "D", "E"]
        XCTAssertTrue(ChipSelection.isFull(full, limit: 5))
        XCTAssertEqual(ChipSelection.toggled("F", in: full, limit: 5), full)
        XCTAssertEqual(ChipSelection.toggled("C", in: full, limit: 5), ["A", "B", "D", "E"])
        XCTAssertFalse(ChipSelection.isFull(["A", "B", "D", "E"], limit: 5))
    }

    func testNoLimitMeansNoCap() {
        let many = (1...30).map(String.init)
        XCTAssertFalse(ChipSelection.isFull(many, limit: nil))
        XCTAssertEqual(ChipSelection.toggled("x", in: many, limit: nil).count, 31)
    }
}
