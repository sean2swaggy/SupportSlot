import XCTest
@testable import SupportSlot

/// A dropped connection is retried once for requests that are safe to repeat, never for a POST.
final class RetryTests: XCTestCase {
    private func transport() -> Transport { TestSupport.transport() }

    private func counted(failFirst: Int, method: String) -> (Transport, URLRequest) {
        let t = transport()
        let lock = NSLock()
        nonisolated(unsafe) var calls = 0
        StubURLProtocol.reset { _ in
            lock.lock(); calls += 1; let n = calls; lock.unlock()
            if n <= failFirst { return StubURLProtocol.Reply(failure: .networkConnectionLost) }
            return .json([])
        }
        return (t, t.request(method, "/rest/v1/profiles", bearer: nil))
    }

    func testAGetIsRetriedOnceAfterAStaleConnection() async throws {
        let (t, req) = counted(failFirst: 1, method: "GET")
        let (_, http) = try await t.send(req)
        XCTAssertEqual(http.statusCode, 200)
        XCTAssertEqual(StubURLProtocol.recorded.count, 2)
    }

    func testAPatchIsRetriedOnceToo() async throws {
        let (t, req) = counted(failFirst: 1, method: "PATCH")
        _ = try await t.send(req)
        XCTAssertEqual(StubURLProtocol.recorded.count, 2)
    }

    func testAPostIsNeverRepeated() async {
        let (t, req) = counted(failFirst: 1, method: "POST")
        do { _ = try await t.send(req); XCTFail("should have failed") }
        catch let e as AppError { XCTAssertTrue(e.isNetwork) }
        catch { XCTFail("\(error)") }
        XCTAssertEqual(StubURLProtocol.recorded.count, 1)
    }

    func testItGivesUpAfterOneRetry() async {
        let (t, req) = counted(failFirst: 5, method: "GET")
        do { _ = try await t.send(req); XCTFail("should have failed") }
        catch let e as AppError { XCTAssertTrue(e.isNetwork); XCTAssertEqual(e.message, AppError.offline.message) }
        catch { XCTFail("\(error)") }
        XCTAssertEqual(StubURLProtocol.recorded.count, 2)
    }

    func testOtherNetworkErrorsAreNotRetried() async {
        let t = transport()
        StubURLProtocol.reset { _ in StubURLProtocol.Reply(failure: .cannotFindHost) }
        do { _ = try await t.send(t.request("GET", "/x", bearer: nil)); XCTFail("should have failed") } catch {}
        XCTAssertEqual(StubURLProtocol.recorded.count, 1)
    }
}
