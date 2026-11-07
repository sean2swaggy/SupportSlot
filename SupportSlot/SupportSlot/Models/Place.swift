import Foundation

/// The four nations. A place is always in exactly one.
enum UKNation: String, CaseIterable, Identifiable, Codable {
    case england = "England"
    case scotland = "Scotland"
    case wales = "Wales"
    case northernIreland = "Northern Ireland"
    var id: String { rawValue }
}

/// A point on the map.
struct Coordinate: Equatable, Hashable, Codable {
    let lat: Double
    let lon: Double

    /// The same bounding box the database enforces. It cannot prove a point is
    /// inside UK borders (it also contains part of the Republic of Ireland), so
    /// places only ever come from a UK-restricted search.
    static let ukBounds = (lat: 49.8...61.0, lon: -8.7...1.9)
    var isInUKBounds: Bool { Self.ukBounds.lat.contains(lat) && Self.ukBounds.lon.contains(lon) }
}

/// A real place the person chose (or typed): what is shown, which nation it is
/// in, an optional county/area, and — only when a search supplied one — a
/// town-or-city-centre point. A typed-in place has no coordinates, so it can
/// never take part in radius filtering or distance claims.
struct Place: Equatable, Hashable, Codable {
    enum Source: String, Codable { case search, manual }

    var label: String
    var country: UKNation
    var region: String?
    var coordinate: Coordinate?
    var source: Source

    var hasCoordinates: Bool { coordinate != nil }

    /// "Newport, Shropshire, England" — the name, then the wider area, then the
    /// nation; the area is left out when it only repeats the name, and the
    /// nation when it is already part of what was typed.
    static func makeLabel(name: String, region: String?, country: UKNation) -> String {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        var parts = [n]
        if let r = region?.trimmingCharacters(in: .whitespacesAndNewlines), !r.isEmpty,
           r.caseInsensitiveCompare(n) != .orderedSame, r.caseInsensitiveCompare(country.rawValue) != .orderedSame {
            parts.append(r)
        }
        if !parts.contains(where: { $0.caseInsensitiveCompare(country.rawValue) == .orderedSame }) { parts.append(country.rawValue) }
        return parts.joined(separator: ", ")
    }

    /// A place typed in by hand: no coordinates, county optional.
    static func manual(name: String, region: String?, country: UKNation) -> Place {
        let r = region?.trimmingCharacters(in: .whitespacesAndNewlines)
        let regionValue = (r?.isEmpty ?? true) ? nil : r
        return Place(label: makeLabel(name: name, region: regionValue, country: country), country: country, region: regionValue, coordinate: nil, source: .manual)
    }

    /// What the database will accept; the same checks as `_check_place` in SQL.
    var validationError: String? {
        let l = label.trimmingCharacters(in: .whitespacesAndNewlines)
        if l.count < 2 || l.count > 120 || (l.split(separator: ",").first.map { $0.trimmingCharacters(in: .whitespaces).count } ?? 0) < 2 { return "Enter the name of a place (at least 2 characters)." }
        if l.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) { return "That place name has characters we can’t use." }
        if let r = region, !r.isEmpty, r.trimmingCharacters(in: .whitespaces).count < 2 || r.count > 80 { return "The county or area should be 2–80 characters, or left blank." }
        if let c = coordinate, !c.isInUKBounds { return "That place isn’t in the United Kingdom." }
        if source == .manual && coordinate != nil { return "A typed-in place can’t have coordinates." }
        return nil
    }
}

extension Artist {
    /// The public view of where the artist is based (never coordinates).
    var place: Place {
        Place(label: location, country: UKNation(rawValue: locationCountry) ?? .england, region: locationRegion, coordinate: nil, source: .search)
    }
}

extension Promoter {
    var place: Place? {
        guard let location, let c = locationCountry, let nation = UKNation(rawValue: c) else { return nil }
        return Place(label: location, country: nation, region: locationRegion, coordinate: nil, source: .search)
    }
}

extension Venue {
    var place: Place {
        Place(label: city, country: UKNation(rawValue: country) ?? .england, region: region,
              coordinate: lat.flatMap { la in lon.map { Coordinate(lat: la, lon: $0) } }, source: .search)
    }
    var coordinate: Coordinate? { lat.flatMap { la in lon.map { Coordinate(lat: la, lon: $0) } } }
}

extension Slot {
    var coordinate: Coordinate? { lat.flatMap { la in lon.map { Coordinate(lat: la, lon: $0) } } }
}
