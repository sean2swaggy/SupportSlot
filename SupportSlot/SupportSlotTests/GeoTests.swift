import XCTest
@testable import SupportSlot

/// Distance is straight-line and identical in Swift and SQL. The golden rows
/// below are read by tests/db/uk-locations.test.ts and compared with
/// `public.haversine_miles`; keep each on one line in this exact shape.
final class GeoTests: XCTestCase {
    private func golden(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double, _ miles: Double, line: UInt = #line) {
        XCTAssertEqual(Geo.miles(Coordinate(lat: lat1, lon: lon1), Coordinate(lat: lat2, lon: lon2)), miles, accuracy: 0.01, line: line)
    }

    func testMatchesTheDatabaseOnRepresentativeUKPairs() {
        golden(51.5074, -0.1278, 50.8225, -0.1372, 47.3238)     // London – Brighton
        golden(51.5074, -0.1278, 55.9533, -3.1883, 331.5966)    // London – Edinburgh
        golden(54.5973, -5.9301, 55.9533, -3.1883, 142.8896)    // Belfast – Edinburgh
        golden(60.1553, -1.1457, 50.2108, -5.4803, 707.6769)    // Lerwick – St Ives (about the longest in the UK)
        golden(51.4816, -3.1791, 51.5842, -2.9977, 10.5376)     // Cardiff – Newport (Wales)
        golden(53.8008, -1.5491, 53.4808, -2.2426, 35.9970)     // Leeds – Manchester
        golden(54.9966, -7.3086, 54.5973, -5.9301, 61.4468)     // Derry – Belfast
        golden(51.5, -0.1, 51.5, -0.1, 0.0)                     // same point
    }

    func testIsSymmetricAndDescribesPlurals() {
        let a = Coordinate(lat: 51.5, lon: -0.1), b = Coordinate(lat: 55.9, lon: -3.2)
        XCTAssertEqual(Geo.miles(a, b), Geo.miles(b, a), accuracy: 1e-9)
        XCTAssertEqual(Geo.describe(miles: 1), "1 mile")
        XCTAssertEqual(Geo.describe(miles: 47), "47 miles")
    }
}

final class PlaceTests: XCTestCase {
    func testLabelsTellSamenamedPlacesApart() {
        XCTAssertEqual(Place.makeLabel(name: "Newport", region: "Shropshire", country: .england), "Newport, Shropshire, England")
        XCTAssertEqual(Place.makeLabel(name: "Newport", region: "Isle of Wight", country: .england), "Newport, Isle of Wight, England")
        XCTAssertEqual(Place.makeLabel(name: "Newport", region: "Newport", country: .wales), "Newport, Wales", "an area that only repeats the name is left out")
        XCTAssertEqual(Place.makeLabel(name: "Derry", region: nil, country: .northernIreland), "Derry, Northern Ireland", "no county is required")
        XCTAssertEqual(Place.makeLabel(name: "Cardiff", region: "Wales", country: .wales), "Cardiff, Wales", "the nation isn't repeated")
    }

    func testTypedInPlacesHaveNoCoordinatesAndAreValidated() {
        let p = Place.manual(name: "  Aberystwyth ", region: " ", country: .wales)
        XCTAssertEqual(p.label, "Aberystwyth, Wales")
        XCTAssertNil(p.region)
        XCTAssertFalse(p.hasCoordinates)
        XCTAssertNil(p.validationError)
        XCTAssertNotNil(Place.manual(name: "x", region: nil, country: .wales).validationError)
        var bad = Place.manual(name: "Aberystwyth", region: nil, country: .wales)
        bad.coordinate = Coordinate(lat: 52.4, lon: -4.0)
        XCTAssertNotNil(bad.validationError, "a typed-in place can't claim a map position")
    }

    func testCoordinatesOutsideTheUKAreRejected() {
        XCTAssertTrue(Coordinate(lat: 60.15, lon: -1.14).isInUKBounds)   // Shetland
        XCTAssertTrue(Coordinate(lat: 50.21, lon: -5.48).isInUKBounds)   // Cornwall
        XCTAssertFalse(Coordinate(lat: 48.85, lon: 2.35).isInUKBounds)   // Paris
        XCTAssertFalse(Coordinate(lat: 40.7, lon: -74.0).isInUKBounds)   // New York
        let paris = Place(label: "Paris, England", country: .england, region: nil, coordinate: Coordinate(lat: 48.85, lon: 2.35), source: .search)
        XCTAssertNotNil(paris.validationError)
    }

    func testThereIsNoFixedCityList() {
        XCTAssertEqual(UKNation.allCases.map(\.rawValue), ["England", "Scotland", "Wales", "Northern Ireland"])
    }

    func testFiltersOnlyUseAPlaceWithAMapPosition() {
        var f = SlotFilters()
        f.near = Place.manual(name: "Typedville", region: nil, country: .england)
        f.distance = 25
        XCTAssertNil(f.search(base: nil, page: 1).near, "a typed-in place can't be a search centre")
        XCTAssertNil(f.search(base: nil, page: 1).maxMiles)
        f.near = Place(label: "Brighton, East Sussex, England", country: .england, region: "East Sussex", coordinate: Coordinate(lat: 50.82, lon: -0.14), source: .search)
        XCTAssertEqual(f.search(base: nil, page: 1).maxMiles, 25)
        XCTAssertEqual(f.search(base: nil, page: 1).near, Coordinate(lat: 50.82, lon: -0.14))
        f.near = nil; f.nearMyBase = true
        XCTAssertNil(f.search(base: nil, page: 1).near)
        XCTAssertEqual(f.search(base: Coordinate(lat: 51.5, lon: -0.1), page: 1).near, Coordinate(lat: 51.5, lon: -0.1))
    }
}
