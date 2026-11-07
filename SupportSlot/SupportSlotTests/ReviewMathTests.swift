import XCTest
@testable import SupportSlot

final class ReviewMathTests: XCTestCase {
    private func review(_ rating: Int) throws -> Review {
        let json = #"{"id":"r","booking_id":"b","reviewer_id":"x","reviewee_id":"y","reviewer_name":"N","rating":\#(rating),"comment":null,"created_at":"2026-01-01T10:00:00Z"}"#
        let d = JSONDecoder(); d.keyDecodingStrategy = .convertFromSnakeCase; d.dateDecodingStrategy = .iso8601
        return try d.decode(Review.self, from: Data(json.utf8))
    }
    func testNoReviewsMeansNoAverage() { XCTAssertNil(ReviewMath.average([])) }
    func testAverageIsTheRealMeanToOneDecimal() throws {
        XCTAssertEqual(ReviewMath.average([try review(5), try review(4), try review(4)]), 4.3)
        XCTAssertEqual(ReviewMath.average([try review(5)]), 5.0)
    }
}
