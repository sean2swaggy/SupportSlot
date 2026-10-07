import XCTest
@testable import SupportSlot

private func entry(_ id: String = "e1", kind: String = "performance", title: String = "Entry", stage: String = "Main Stage",
                   start: String = "2026-12-20T20:00:00", end: String = "2026-12-20T20:30:00", artist: String? = nil, notes: String = "", sort: Int = 0) -> ScheduleEntry {
    ScheduleEntry(id: id, scheduleId: "s1", kind: kind, title: title, stage: stage, startAt: start, endAt: end, artistId: artist, notes: notes, sortOrder: sort)
}

final class ScheduleRulesTests: XCTestCase {
    func testStagesAndOrdering() {
        XCTAssertEqual(ScheduleRules.stages(of: []), ["Main Stage"])
        let three = [entry("a", stage: "Second Stage"), entry("b"), entry("c", stage: "Second Stage")]
        XCTAssertEqual(ScheduleRules.stages(of: three), ["Second Stage", "Main Stage"])

        let byOrder = [entry("a", start: "2026-12-20T18:00:00", end: "2026-12-20T18:10:00", sort: 2),
                       entry("b", start: "2026-12-20T22:00:00", end: "2026-12-20T22:10:00", sort: 0),
                       entry("c", start: "2026-12-20T20:00:00", end: "2026-12-20T20:10:00", sort: 1)]
        XCTAssertEqual(ScheduleRules.entries(byOrder, onStage: "Main Stage").map(\.id), ["b", "c", "a"])
        XCTAssertEqual(ScheduleRules.combinedTimeline(byOrder).map(\.id), ["a", "c", "b"]) // strictly by time
    }

    func testStageOverlaps() {
        let overlapping = [entry("a"), entry("b", start: "2026-12-20T20:15:00", end: "2026-12-20T20:45:00")]
        let c = ScheduleRules.stageOverlaps(overlapping)
        XCTAssertEqual(c.count, 1); XCTAssertEqual(Set(c[0].entryIds), ["a", "b"])
        XCTAssertTrue(ScheduleRules.stageOverlaps([entry("a"), entry("b", stage: "Second Stage", start: "2026-12-20T20:15:00", end: "2026-12-20T20:45:00")]).isEmpty)
        XCTAssertTrue(ScheduleRules.stageOverlaps([entry("a"), entry("b", start: "2026-12-20T20:30:00", end: "2026-12-20T21:00:00")]).isEmpty, "touching at the boundary isn't an overlap")
    }

    func testArtistDoubleBooking() {
        let double = [entry("a", artist: "x"), entry("b", stage: "Second Stage", start: "2026-12-20T20:15:00", end: "2026-12-20T20:45:00", artist: "x")]
        XCTAssertEqual(ScheduleRules.artistDoubleBookings(double).first?.kind, .artistDoubleBooking)
        XCTAssertTrue(ScheduleRules.artistDoubleBookings([entry("a", artist: "x"), entry("b", stage: "Second Stage", start: "2026-12-20T20:15:00", end: "2026-12-20T20:45:00", artist: "y")]).isEmpty)
        XCTAssertTrue(ScheduleRules.artistDoubleBookings([entry("a"), entry("b", stage: "Second Stage", start: "2026-12-20T20:15:00", end: "2026-12-20T20:45:00")]).isEmpty)
    }

    func testMissingChangeover() {
        let tight = [entry("a"), entry("b", start: "2026-12-20T20:33:00", end: "2026-12-20T21:00:00")]
        XCTAssertEqual(ScheduleRules.missingChangeovers(tight).first?.kind, .missingChangeover)
        let withChangeover = [entry("a"), entry("c", kind: "changeover", start: "2026-12-20T20:30:00", end: "2026-12-20T20:45:00"), entry("b", start: "2026-12-20T20:45:00", end: "2026-12-20T21:15:00")]
        XCTAssertTrue(ScheduleRules.missingChangeovers(withChangeover).isEmpty)
        XCTAssertTrue(ScheduleRules.missingChangeovers([entry("a"), entry("b", start: "2026-12-20T21:00:00", end: "2026-12-20T21:30:00")]).isEmpty)
    }

    func testReorderSwapsOnlyTheTwoSortOrders() {
        let list = [entry("a", sort: 0), entry("b", sort: 1), entry("c", sort: 2)]
        let r = ScheduleRules.reorder(list, stage: "Main Stage", entryId: "b", up: true)!
        XCTAssertEqual(r.map(\.id), ["b", "a"]); XCTAssertEqual(r.map(\.sortOrder), [0, 1])
        XCTAssertNil(ScheduleRules.reorder(list, stage: "Main Stage", entryId: "a", up: true))
        XCTAssertNil(ScheduleRules.reorder(list, stage: "Main Stage", entryId: "c", up: false))
        XCTAssertNil(ScheduleRules.reorder(list, stage: "Main Stage", entryId: "zzz", up: true))
    }

    func testTemplatesAnchorOffsetsAndRollPastMidnight() {
        func tpl(_ entries: [ScheduleTemplateEntry]) -> ScheduleTemplate { ScheduleTemplate(id: "t", name: "n", scheduleTemplateEntries: entries) }
        let night = tpl([ScheduleTemplateEntry(id: "1", templateId: "t", kind: "doors", title: "Doors", stage: "Main Stage", offsetMinutes: 0, durationMinutes: 30, sortOrder: 0),
                         ScheduleTemplateEntry(id: "2", templateId: "t", kind: "performance", title: "Support set", stage: "Main Stage", offsetMinutes: 60, durationMinutes: 25, sortOrder: 1)])
        let built = ScheduleRules.apply(night, anchorStart: "2026-12-20T19:00:00")
        XCTAssertEqual(built[0].startAt, "2026-12-20T19:00:00")
        XCTAssertEqual(built[1].startAt, "2026-12-20T20:00:00"); XCTAssertEqual(built[1].endAt, "2026-12-20T20:25:00")
        XCTAssertNil(built[0].artistId); XCTAssertEqual(built[0].notes, "")

        let late = tpl([ScheduleTemplateEntry(id: "1", templateId: "t", kind: "performance", title: "Closer", stage: "Main Stage", offsetMinutes: 300, durationMinutes: 45, sortOrder: 0)])
        let l = ScheduleRules.apply(late, anchorStart: "2026-12-20T22:00:00")
        XCTAssertEqual(l[0].startAt, "2026-12-21T03:00:00"); XCTAssertEqual(l[0].endAt, "2026-12-21T03:45:00")
    }

    func testCaptureStripsArtistsNotesAndDates() {
        let src = [entry("a", kind: "doors", title: "Doors", start: "2026-12-20T19:00:00", end: "2026-12-20T19:30:00", artist: "artist-9", notes: "private note", sort: 0),
                   entry("b", start: "2026-12-20T20:00:00", end: "2026-12-20T20:25:00", sort: 1)]
        let cap = ScheduleRules.captureTemplate(src)
        XCTAssertEqual(cap.map(\.offsetMinutes), [0, 60])
        XCTAssertEqual(cap.map(\.durationMinutes), [30, 25])
        XCTAssertTrue(ScheduleRules.captureTemplate([]).isEmpty)
    }

    func testSortOrderAndTimeValidation() {
        XCTAssertEqual(ScheduleRules.nextSortOrder([], stage: "Main Stage"), 0)
        XCTAssertEqual(ScheduleRules.nextSortOrder([entry("a", sort: 0), entry("b", sort: 3)], stage: "Main Stage"), 4)
        XCTAssertNotNil(ScheduleRules.timesError(start: "2026-12-20T20:30:00", end: "2026-12-20T20:00:00"))
        XCTAssertNotNil(ScheduleRules.timesError(start: "", end: "2026-12-20T20:00:00"))
        XCTAssertNil(ScheduleRules.timesError(start: "2026-12-20T23:45:00", end: "2026-12-21T00:15:00"), "ending after midnight is fine")
    }

    func testDuplicateOffsetsAndKeepsLength() {
        let d = ScheduleRules.duplicate(entry(title: "Support set"))
        XCTAssertEqual(d.title, "Support set (copy)")
        XCTAssertEqual(d.startAt, "2026-12-20T20:30:00"); XCTAssertEqual(d.endAt, "2026-12-20T21:00:00")
    }

    func testNaiveTimesNeverShiftWithTheDevicesTimezone() {
        let original = NSTimeZone.default
        defer { NSTimeZone.default = original }
        for zone in ["Pacific/Auckland", "America/Los_Angeles", "Europe/London"] {
            NSTimeZone.default = TimeZone(identifier: zone)!
            XCTAssertEqual(ScheduleRules.format(ScheduleRules.parse("2026-03-29T00:45:00")! + 3600), "2026-03-29T01:45:00", zone) // across the UK clock change, wall-clock digits only
        }
        XCTAssertTrue(ScheduleRules.crossesIntoNextDay("2026-12-21T00:15:00", eventDate: "2026-12-20"))
        XCTAssertFalse(ScheduleRules.crossesIntoNextDay("2026-12-20T23:15:00", eventDate: "2026-12-20"))
        XCTAssertEqual(ScheduleRules.time("2026-12-20T20:05:00"), "20:05")
    }
}

final class AvailabilityRulesTests: XCTestCase {
    func testRecipientLimits() {
        XCTAssertNotNil(AvailabilityRules.recipientsError([]))
        XCTAssertNil(AvailabilityRules.recipientsError(["a"]))
        XCTAssertNil(AvailabilityRules.recipientsError((0..<50).map(String.init)))
        XCTAssertTrue(AvailabilityRules.recipientsError((0..<51).map(String.init))?.contains("50") ?? false)
    }

    func testExpiryOnlyAppliesToOpenRequests() {
        let now = JSONCoding.parseTimestamp("2026-06-15T12:00:00Z")!
        let past = JSONCoding.parseTimestamp("2026-06-15T11:00:00Z")!, future = JSONCoding.parseTimestamp("2026-06-15T13:00:00Z")!
        XCTAssertTrue(AvailabilityRules.isExpired(status: "sent", deadline: past, now: now))
        XCTAssertFalse(AvailabilityRules.isExpired(status: "sent", deadline: future, now: now))
        XCTAssertFalse(AvailabilityRules.isExpired(status: "withdrawn", deadline: past, now: now))
        XCTAssertFalse(AvailabilityRules.isExpired(status: "filled", deadline: past, now: now))
        XCTAssertEqual(AvailabilityRules.label(status: "withdrawn", deadline: past, now: now), .withdrawn)
        XCTAssertEqual(AvailabilityRules.label(status: "filled", deadline: past, now: now), .filled)
        XCTAssertEqual(AvailabilityRules.label(status: "sent", deadline: past, now: now), .expired)
        XCTAssertEqual(AvailabilityRules.label(status: "sent", deadline: future, now: now), .open)
    }
}

final class CSVTests: XCTestCase {
    func testFormulaInjectionIsNeutralisedAndQuotingWorks() {
        XCTAssertEqual(CSV.field("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"")
        XCTAssertEqual(CSV.field("+44"), "'+44")
        XCTAssertEqual(CSV.field("-1"), "'-1")
        XCTAssertEqual(CSV.field("@sum"), "'@sum")
        XCTAssertEqual(CSV.field("Plain"), "Plain")
        XCTAssertEqual(CSV.field("a,b"), "\"a,b\"")
        XCTAssertEqual(CSV.pounds(15050), "150.50")
        XCTAssertEqual(CSV.pounds(5), "0.05")
    }
}
