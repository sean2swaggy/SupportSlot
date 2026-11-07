import Foundation
import MapKit
import CoreLocation
import Observation

/// What the person picked: the place itself, and (venue search only) a
/// suggested venue name and street address from the map result.
struct PlaceResult: Equatable {
    var place: Place
    var venueName: String?
    var street: String?
}

enum PlaceMapping {
    /// Turns a MapKit result into a `Place`, or explains why it can't be used.
    /// Only results in the United Kingdom are accepted, and the nation must be
    /// one Apple reported; nothing is guessed.
    static func result(from placemark: MKPlacemark, name: String?, roundCoordinate: Bool = false) -> Result<PlaceResult, PlaceError> {
        guard placemark.isoCountryCode == "GB" else { return .failure(.notInUK) }
        guard let nation = nation(from: placemark) else { return .failure(.unknownNation) }
        let town = placemark.locality ?? placemark.subLocality ?? placemark.name
        guard let town, !town.isEmpty else { return .failure(.noPlaceName) }
        // The county / council area if Apple has one that isn't just the nation.
        var region = placemark.subAdministrativeArea
        if region?.caseInsensitiveCompare(nation.rawValue) == .orderedSame { region = nil }
        var coordinate: Coordinate?
        if let c = placemark.location?.coordinate, CLLocationCoordinate2DIsValid(c) {
            coordinate = Coordinate(lat: roundCoordinate ? (c.latitude * 100).rounded() / 100 : c.latitude,
                                    lon: roundCoordinate ? (c.longitude * 100).rounded() / 100 : c.longitude)
        }
        if let c = coordinate, !c.isInUKBounds { return .failure(.notInUK) }
        let place = Place(label: Place.makeLabel(name: town, region: region, country: nation), country: nation, region: region, coordinate: coordinate, source: .search)
        let street = [placemark.subThoroughfare, placemark.thoroughfare].compactMap { $0 }.joined(separator: " ")
        let address = [street.isEmpty ? nil : street, placemark.locality, placemark.postalCode].compactMap { $0 }.joined(separator: ", ")
        return .success(PlaceResult(place: place, venueName: name, street: address.isEmpty ? nil : address))
    }

    /// Apple reports "England", "Scotland", "Wales" or "Northern Ireland" as the administrative area for UK addresses.
    static func nation(from placemark: MKPlacemark) -> UKNation? {
        let candidates = [placemark.administrativeArea, placemark.subAdministrativeArea, placemark.country].compactMap { $0 }
        for c in candidates {
            if let n = UKNation.allCases.first(where: { $0.rawValue.caseInsensitiveCompare(c) == .orderedSame }) { return n }
        }
        return nil
    }
}

enum PlaceError: Error, Equatable {
    case notInUK, unknownNation, noPlaceName
    var message: String {
        switch self {
        case .notInUK: return "That place isn’t in the United Kingdom."
        case .unknownNation: return "We couldn’t tell which nation that place is in. Use ‘Type it in’ and choose England, Scotland, Wales or Northern Ireland."
        case .noPlaceName: return "That result has no town or city name. Try a more specific search, or type it in."
        }
    }
}

/// Live place suggestions from Apple Maps, biased to the UK. If the search
/// service is unavailable (offline, rate-limited) `unavailable` is set so the
/// screen can offer typing a place in instead of a dead end.
@MainActor
@Observable
final class PlaceSearchService: NSObject, MKLocalSearchCompleterDelegate {
    var query = "" { didSet { completer.queryFragment = query.trimmingCharacters(in: .whitespaces) } }
    private(set) var suggestions: [MKLocalSearchCompletion] = []
    private(set) var unavailable = false
    private(set) var resolving = false
    var includePointsOfInterest = false { didSet { configure() } }

    @ObservationIgnored private let completer = MKLocalSearchCompleter()

    override init() {
        super.init()
        completer.delegate = self
        configure()
    }

    private func configure() {
        // The whole of the UK and a margin, so a search from anywhere finds anywhere in it.
        completer.region = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 54.6, longitude: -3.2),
                                              span: MKCoordinateSpan(latitudeDelta: 12, longitudeDelta: 14))
        completer.resultTypes = includePointsOfInterest ? [.address, .pointOfInterest] : [.address]
    }

    nonisolated func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        let results = completer.results
        Task { @MainActor in self.suggestions = results; self.unavailable = false }
    }

    nonisolated func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
        Task { @MainActor in self.suggestions = []; self.unavailable = true }
    }

    func resolve(_ completion: MKLocalSearchCompletion) async -> Result<PlaceResult, PlaceError> {
        resolving = true
        defer { resolving = false }
        do {
            let response = try await MKLocalSearch(request: MKLocalSearch.Request(completion: completion)).start()
            guard let item = response.mapItems.first else { return .failure(.noPlaceName) }
            unavailable = false
            let name = item.pointOfInterestCategory != nil ? item.name : nil
            return PlaceMapping.result(from: item.placemark, name: name)
        } catch {
            unavailable = true
            return .failure(.noPlaceName)
        }
    }
}

/// One-shot device location, only when the person taps "Use my current
/// location". The result is turned into a town by reverse geocoding and the
/// coordinate is rounded to ~1 km before it leaves this type.
@MainActor
@Observable
final class CurrentLocationFinder: NSObject, CLLocationManagerDelegate {
    enum Status: Equatable {
        case idle, asking, locating, denied, restricted, failed(String)
    }
    private(set) var status: Status = .idle
    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private var continuation: CheckedContinuation<Result<PlaceResult, PlaceError>?, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer // town-level is all we need
    }

    func find() async -> Result<PlaceResult, PlaceError>? {
        switch manager.authorizationStatus {
        case .denied: status = .denied; return nil
        case .restricted: status = .restricted; return nil
        case .notDetermined: status = .asking
        default: status = .locating
        }
        return await withCheckedContinuation { cont in
            continuation = cont
            if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
            else { manager.requestLocation() }
        }
    }

    private func finish(_ result: Result<PlaceResult, PlaceError>?, status new: Status) {
        status = new
        continuation?.resume(returning: result)
        continuation = nil
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let s = manager.authorizationStatus
        Task { @MainActor in
            guard self.continuation != nil else { return }
            switch s {
            case .authorizedWhenInUse, .authorizedAlways: self.status = .locating; manager.requestLocation()
            case .denied: self.finish(nil, status: .denied)
            case .restricted: self.finish(nil, status: .restricted)
            default: break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.finish(nil, status: .failed("We couldn’t get your location just now.")) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        Task { @MainActor in
            do {
                let marks = try await CLGeocoder().reverseGeocodeLocation(location)
                guard let mark = marks.first else { self.finish(nil, status: .failed("We couldn’t work out which town you’re in.")); return }
                let result = PlaceMapping.result(from: MKPlacemark(placemark: mark), name: nil, roundCoordinate: true)
                self.finish(result, status: .idle)
            } catch {
                self.finish(nil, status: .failed("We couldn’t look up your town (are you offline?). You can type your place in instead."))
            }
        }
    }
}
