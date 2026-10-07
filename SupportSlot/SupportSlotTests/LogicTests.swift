import XCTest
@testable import SupportSlot

private func date(_ iso: String) -> Date { JSONCoding.parseTimestamp(iso)! }

final class UKDatesTests: XCTestCase {
    func testTodayIsLondonNotUTCAroundMidnightAndDST() {
        // 23:30 UTC on 30 Jun is 00:30 BST on 1 Jul in London.
        XCTAssertEqual(UKDates.today(now: date("2026-06-30T23:30:00Z")), "2026-07-01")
        // In winter London == UTC.
        XCTAssertEqual(UKDates.today(now: date("2026-12-30T23:30:00Z")), "2026-12-30")
        // Clocks go back on 25 Oct 2026; 23:30 UTC on the 24th is still BST, so already the 25th in London.
        XCTAssertEqual(UKDates.today(now: date("2026-10-24T23:30:00Z")), "2026-10-25")
    }

    func testDiffDaysAcrossMonthYearAndDST() {
        XCTAssertEqual(UKDates.diffDays(from: "2026-03-28", to: "2026-03-30"), 2) // spans the March DST change
        XCTAssertEqual(UKDates.diffDays(from: "2026-12-31", to: "2027-01-01"), 1)
        XCTAssertEqual(UKDates.diffDays(from: "2026-02-28", to: "2026-03-01"), 1)
        XCTAssertEqual(UKDates.diffDays(from: "2026-05-10", to: "2026-05-09"), -1)
    }

    func testFormatsShowDatesTheSameEverywhere() {
        XCTAssertEqual(UKDates.formatShowDate("2026-12-01", withYear: true), "Dec 1, 2026")
        XCTAssertEqual(UKDates.formatShowDate("2026-01-31"), "Jan 31")
        XCTAssertEqual(UKDates.weekday("2026-10-03"), "Saturday")
        XCTAssertEqual(UKDates.shortDate("2026-10-03"), "Sat, Oct 3")
    }

    func testDeadlinesAtTheDayBoundary() {
        let now = date("2026-10-03T12:00:00Z")
        XCTAssertEqual(UKDates.applicationCloseText("2026-10-02", now: now), "Applications closed")
        XCTAssertEqual(UKDates.applicationCloseText("2026-10-03", now: now), "Applications close today")
        XCTAssertEqual(UKDates.applicationCloseText("2026-10-04", now: now), "Applications close tomorrow")
        XCTAssertEqual(UKDates.applicationCloseText("2026-10-10", now: now), "Applications close in 7 days")
        XCTAssertFalse(UKDates.deadlinePassed("2026-10-03", now: now)) // the whole day still counts
        XCTAssertTrue(UKDates.deadlinePassed("2026-10-02", now: now))
    }

    func testAddingDays() {
        XCTAssertEqual(UKDates.adding(days: 1, to: "2026-12-31"), "2027-01-01")
        XCTAssertEqual(UKDates.adding(days: -1, to: "2026-03-01"), "2026-02-28")
        XCTAssertEqual(UKDates.adding(days: 0, to: "2026-10-07"), "2026-10-07")
    }

    func testTimeAgo() {
        let now = date("2026-10-07T12:00:00Z")
        XCTAssertEqual(UKDates.timeAgo(date("2026-10-07T11:59:40Z"), now: now), "just now")
        XCTAssertEqual(UKDates.timeAgo(date("2026-10-07T11:59:00Z"), now: now), "1 minute ago")
        XCTAssertEqual(UKDates.timeAgo(date("2026-10-07T09:00:00Z"), now: now), "3 hours ago")
        XCTAssertEqual(UKDates.timeAgo(date("2026-10-05T12:00:00Z"), now: now), "2 days ago")
    }

    func testMoneyFormatting() {
        XCTAssertEqual(Money.gbp(150), "£150")
        XCTAssertEqual(Money.gbp(12_500), "£12,500")
        XCTAssertEqual(Money.pence(15000), "£150.00")
        XCTAssertEqual(Money.pence(123450), "£1,234.50")
        XCTAssertEqual(Money.pence(5), "£0.05")
    }
}

final class FitTests: XCTestCase {
    private func fit(genres: [String] = ["Indie", "Folk"], location: String = "London", radius: Int = 100, size: String = "emerging",
                     slotGenres: [String] = ["Indie"], city: String = "London", sizeFit: [String] = ["emerging", "developing"]) -> Fit {
        Fit.explain(artistGenres: genres, artistLocation: location, travelRadiusMiles: radius, artistSize: size, slotGenres: slotGenres, slotCity: city, slotSizeFit: sizeFit)
    }

    func testReportsRealMatchesWithReasonsAndNoPercentage() {
        let f = fit()
        XCTAssertEqual(f.signals.map(\.state), [.match, .match, .match])
        XCTAssertEqual(f.summary, "3 of 3 fit signals match.")
        XCTAssertFalse(f.signals.map(\.detail).joined().contains("%"))
        XCTAssertFalse(f.summary.contains("%"))
    }

    func testNearbyCityIsPartialInsideRadiusAndMismatchOutside() {
        XCTAssertEqual(fit(city: "Brighton").signals.first(where: { $0.key == .location })?.state, .partial) // 55 miles
        XCTAssertEqual(fit(city: "Leeds").signals.first(where: { $0.key == .location })?.state, .mismatch)   // 200 miles
    }

    func testNeverInventsAResultForMissingData() {
        let f = fit(genres: [], sizeFit: [])
        XCTAssertEqual(f.signals.first(where: { $0.key == .genre })?.state, .unknown)
        XCTAssertEqual(f.signals.first(where: { $0.key == .size })?.state, .unknown)
        XCTAssertEqual(f.assessed, 1)
        XCTAssertTrue(f.summary.contains("1 of 1"))
        XCTAssertEqual(fit(genres: [], slotGenres: [], sizeFit: []).signals.count, 3)
    }

    func testGenreMismatchIsPlain() {
        let g = fit(slotGenres: ["Techno"]).signals.first(where: { $0.key == .genre })!
        XCTAssertEqual(g.state, .mismatch)
        XCTAssertTrue(g.detail.contains("Techno"))
    }

    func testRanksMoreClearMatchesHigher() {
        XCTAssertGreaterThan(fit().rank, fit(slotGenres: ["Techno"], city: "Leeds").rank)
    }
}

final class TravelTests: XCTestCase {
    func testDistancesAreSymmetricAndKnownForEveryPair() {
        for a in Catalog.cities {
            for b in Catalog.cities {
                XCTAssertEqual(Travel.miles(a, b), Travel.miles(b, a))
                if a != b { XCTAssertNotEqual(Travel.miles(a, b), 150, "\(a)-\(b) fell back to the default") }
            }
            XCTAssertEqual(Travel.miles(a, a), 0)
        }
    }

    func testLongJourneyTopUp() {
        XCTAssertEqual(Travel.effectiveContribution(pounds: 0, artistCity: "Manchester", venueCity: "London"), 10)  // 200 miles
        XCTAssertEqual(Travel.effectiveContribution(pounds: 25, artistCity: "Manchester", venueCity: "London"), 25)
        XCTAssertEqual(Travel.effectiveContribution(pounds: 0, artistCity: "London", venueCity: "Brighton"), 10)   // 55 miles is 1.4h at 40mph
        XCTAssertEqual(Travel.effectiveContribution(pounds: 0, artistCity: "London", venueCity: "London"), 0)      // same city: no top-up
        // The nearest pair of different cities (Manchester–Leeds, 45 miles) is still over an hour.
        XCTAssertTrue(Travel.isLongJourney("Manchester", "Leeds"))
    }
}

final class AccountRulesTests: XCTestCase {
    func testUsernames() {
        XCTAssertNotNil(UsernameRules.error("ab"))
        XCTAssertNotNil(UsernameRules.error(String(repeating: "a", count: 21)))
        XCTAssertNil(UsernameRules.error("abc"))
        XCTAssertNil(UsernameRules.error(String(repeating: "a", count: 20)))
        XCTAssertNil(UsernameRules.error("slow_cpu_92"))
        XCTAssertNotNil(UsernameRules.error("slow cpu"))
        XCTAssertNotNil(UsernameRules.error("slow-cpu!"))
    }

    func testPasswords() {
        let short = PasswordRules.evaluate("Abc1")
        XCTAssertFalse(short.isAcceptable); XCTAssertEqual(short.score, 0)
        let common = PasswordRules.evaluate("password123")
        XCTAssertFalse(common.isAcceptable); XCTAssertEqual(common.score, 0)
        XCTAssertFalse(PasswordRules.evaluate("aaaaaaaaaaaa").isAcceptable)
        let ok = PasswordRules.evaluate("correcthorse1")
        XCTAssertTrue(ok.isAcceptable); XCTAssertGreaterThanOrEqual(ok.score, 2)
        let strong = PasswordRules.evaluate("Correct-Horse-Battery-99")
        XCTAssertTrue(strong.isAcceptable); XCTAssertEqual(strong.score, 4); XCTAssertEqual(strong.label, .strong)
        XCTAssertEqual(PasswordRules.minLength, 8)
    }

    func testEmails() {
        XCTAssertTrue(EmailRules.isValid("a@b.co"))
        XCTAssertFalse(EmailRules.isValid("a@b"))
        XCTAssertFalse(EmailRules.isValid("a b@c.com"))
        XCTAssertFalse(EmailRules.isValid(""))
    }

    func testAgeGateIsSixteen() {
        XCTAssertEqual(AgeRules.latestBirthDate(today: "2026-10-07"), "2010-10-07")
        XCTAssertTrue(AgeRules.isOldEnough(dob: "2010-10-07", today: "2026-10-07"))   // 16 today
        XCTAssertFalse(AgeRules.isOldEnough(dob: "2010-10-08", today: "2026-10-07"))  // 15, turns 16 tomorrow
        XCTAssertFalse(AgeRules.isOldEnough(dob: "", today: "2026-10-07"))
        XCTAssertFalse(AgeRules.isOldEnough(dob: "nonsense", today: "2026-10-07"))
        // 29 Feb today and the person turns 16 in a non-leap year: they count from 28 Feb.
        XCTAssertEqual(AgeRules.latestBirthDate(today: "2028-02-29"), "2012-02-29") // 2012 is a leap year
        XCTAssertEqual(AgeRules.latestBirthDate(today: "2032-02-29", minimumAge: 17), "2015-02-28")
    }
}

final class LinkTests: XCTestCase {
    func testOnlyHttpAndHttpsAreSafe() {
        XCTAssertTrue(SafeLink.isSafe("https://open.spotify.com/artist/x"))
        XCTAssertTrue(SafeLink.isSafe("http://example.com"))
        for bad in ["javascript:alert(document.cookie)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///etc/passwd", "", "not a url", "bandcamp.com/track", "https://nodot"] {
            XCTAssertFalse(SafeLink.isSafe(bad), bad)
        }
        XCTAssertFalse(SafeLink.isSafe(nil))
        XCTAssertNil(SafeLink.url("javascript:alert(1)"))
    }

    func testListDropsMaliciousLinksButKeepsSafeOnes() {
        var l = ArtistLinks()
        l.spotify = "javascript:alert(document.cookie)"
        l.instagram = "https://instagram.com/realaccount"
        XCTAssertEqual(l.list.map(\.platform), [.instagram])
        XCTAssertEqual(l.list.first?.url, "https://instagram.com/realaccount")
    }

    func testPrimaryListenSkipsUnsafeLinksAndNonListeningPlatforms() {
        var l = ArtistLinks()
        l.spotify = "javascript:alert(1)"
        l.soundcloud = "https://soundcloud.com/realaccount"
        XCTAssertEqual(l.primaryListen, "https://soundcloud.com/realaccount")
        var onlyInstagram = ArtistLinks(); onlyInstagram.instagram = "https://instagram.com/x"
        XCTAssertNil(onlyInstagram.primaryListen)
        XCTAssertNil(ArtistLinks().primaryListen)
    }

    func testTypedLinksReportPlainErrors() {
        var l = ArtistLinks()
        l.spotify = "bandcamp.com/track"
        l.youtube = "https://youtube.com/@x"
        XCTAssertEqual(l.errors[.spotify], "Use a full link starting with https://")
        XCTAssertNil(l.errors[.youtube])
    }

    func testTrackFields() {
        XCTAssertNil(TrackRules.urlError(""))
        XCTAssertNil(TrackRules.urlError("https://bandcamp.com/track"))
        XCTAssertNotNil(TrackRules.urlError("javascript:alert(1)"))
        XCTAssertNotNil(TrackRules.urlError("bandcamp.com/track"))
        XCTAssertTrue(TrackRules.isValidDuration("3:24"))
        XCTAssertTrue(TrackRules.isValidDuration("12:05"))
        XCTAssertFalse(TrackRules.isValidDuration("3:75"))
        XCTAssertFalse(TrackRules.isValidDuration("324"))
    }
}

final class ProfileChecklistTests: XCTestCase {
    private func items(image: String? = "", bio: String = "", genres: [String] = [], tracks: Int = 0, links: ArtistLinks = ArtistLinks(), video: String? = nil) -> [ChecklistItem] {
        ProfileChecklist.items(imageUrl: image, bio: bio, genres: genres, trackCount: tracks, links: links, liveVideoUrl: video)
    }

    func testEmptyProfileHasNothingDone() {
        let c = ProfileChecklist.completion(items())
        XCTAssertEqual(c.done, 0); XCTAssertEqual(c.total, 6); XCTAssertEqual(c.percent, 0)
    }

    func testCountsEachRealThingAPromoterCanSee() {
        var links = ArtistLinks(); links.spotify = "https://open.spotify.com/artist/1"
        let i = items(image: "https://x/y.jpg", bio: String(repeating: "x", count: 40), genres: ["Indie"], tracks: 1, links: links, video: "https://youtube.com/watch?v=1")
        XCTAssertEqual(ProfileChecklist.completion(i).percent, 100)
    }

    func testUnsafeVideoOrListenLinksDontCount() {
        var links = ArtistLinks(); links.spotify = "javascript:alert(1)"
        let i = items(links: links, video: "javascript:alert(1)")
        XCTAssertEqual(i.first(where: { $0.key == "video" })?.done, false)
        XCTAssertEqual(i.first(where: { $0.key == "listen" })?.done, false)
    }

    func testInstagramAloneIsNotAPlaceToListen() {
        var links = ArtistLinks(); links.instagram = "https://instagram.com/x"
        XCTAssertEqual(items(links: links).first(where: { $0.key == "listen" })?.done, false)
    }
}

final class ListingRulesTests: XCTestCase {
    private let today = "2030-06-01"
    private func valid() -> ListingDraft {
        var d = ListingDraft()
        d.headliner = "Field Mode"; d.venueId = "venue-1"; d.date = "2030-07-10"; d.doorsTime = "19:00"; d.setTime = "20:00"
        d.performanceLengthMins = 30; d.expectedAttendance = 250; d.genres = ["Indie"]; d.artistSizeFit = ["emerging"]
        d.supportFee = 150; d.travelContribution = 20; d.applicationDeadline = "2030-07-01"; d.requirementsText = "Own backline\n"
        return d
    }

    func testAcceptsAValidListing() { XCTAssertTrue(ListingRules.validate(valid(), today: today).isEmpty) }

    func testRejectsPastDatesAndADeadlineAfterTheShow() {
        var d = valid(); d.date = "2030-05-01"; d.applicationDeadline = "2030-04-01"
        let e = ListingRules.validate(d, today: today)
        XCTAssertTrue(e[.date]?.contains("past") ?? false)
        XCTAssertTrue(e[.applicationDeadline]?.contains("past") ?? false)
        var late = valid(); late.applicationDeadline = "2030-07-11"
        XCTAssertTrue(ListingRules.validate(late, today: today)[.applicationDeadline]?.contains("on or before") ?? false)
    }

    func testAnEditKeepsAnAlreadyPastDateItDidntChange() {
        var d = valid(); d.date = "2030-05-01"; d.applicationDeadline = "2030-04-20"
        XCTAssertTrue(ListingRules.validate(d, today: today, existing: (date: "2030-05-01", applicationDeadline: "2030-04-20")).isEmpty)
    }

    func testChecksTimesMoneyAndCountsAgainstTheDatabaseLimits() {
        var d = valid(); d.setTime = "18:00"; d.performanceLengthMins = 3; d.supportFee = -1; d.travelContribution = 6000; d.expectedAttendance = 0; d.genres = []
        let keys = Set(ListingRules.validate(d, today: today).keys.map(\.rawValue))
        XCTAssertEqual(keys, ["expectedAttendance", "genres", "performanceLengthMins", "setTime", "supportFee", "travelContribution"])
    }

    func testMissingNumbersAreErrorsNotZero() {
        var d = valid(); d.supportFee = nil; d.expectedAttendance = nil
        let e = ListingRules.validate(d, today: today)
        XCTAssertNotNil(e[.supportFee]); XCTAssertNotNil(e[.expectedAttendance])
    }

    func testRequiresHeadlinerAndVenueAndCapsRequirements() {
        var d = valid(); d.headliner = "   "; d.venueId = ""
        let e = ListingRules.validate(d, today: today)
        XCTAssertNotNil(e[.headliner]); XCTAssertNotNil(e[.venueId])
        var many = valid(); many.requirementsText = (0..<11).map { "r\($0)" }.joined(separator: "\n")
        XCTAssertNotNil(ListingRules.validate(many, today: today)[.requirementsText])
        XCTAssertEqual(ListingRules.parseRequirements(" a \n\n b\n"), ["a", "b"])
    }
}
