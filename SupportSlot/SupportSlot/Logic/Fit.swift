import Foundation

/// An honest "why this might suit you" explanation, built only from fields
/// that really exist on the artist and the listing. There is no percentage
/// and nothing here can be paid for; a missing field is reported as
/// "unknown", never guessed. It's guidance for the artist and a convenience
/// for the promoter — promoters choose who to book.
struct Fit: Equatable {
    enum State: Equatable { case match, partial, mismatch, unknown }
    enum Key: Equatable { case genre, location, size }

    struct Signal: Equatable, Identifiable {
        let key: Key
        let label: String
        let state: State
        let detail: String
        var id: String { label }
    }

    let signals: [Signal]
    /// How many signals are a clear match.
    let matched: Int
    /// How many signals could be assessed from real data.
    let assessed: Int
    let summary: String

    /// "More clear matches first, then more partial ones" — only used to order
    /// a list a person can see the reasons for; never displayed as a score.
    var rank: Int {
        signals.reduce(0) { $0 + ($1.state == .match ? 10 : $1.state == .partial ? 4 : 0) }
    }

    /// `distanceMiles` is the straight-line distance when both places have
    /// coordinates, nil otherwise (then location is reported as unknown unless
    /// the places are literally the same).
    static func explain(artistGenres: [String], artistLocation: String, travelRadiusMiles: Int, artistSize: String,
                        slotGenres: [String], slotCity: String, slotSizeFit: [String], distanceMiles: Int? = nil) -> Fit {
        var signals: [Signal] = []

        // Genre
        if artistGenres.isEmpty {
            signals.append(Signal(key: .genre, label: "Genre", state: .unknown, detail: "Add your genres to your profile to see this."))
        } else {
            let shared = slotGenres.filter { artistGenres.contains($0) }
            if !shared.isEmpty {
                signals.append(Signal(key: .genre, label: "Genre", state: .match, detail: "You both list \(shared.joined(separator: ", "))."))
            } else {
                let show = slotGenres.isEmpty ? "unspecified" : slotGenres.joined(separator: " / ")
                signals.append(Signal(key: .genre, label: "Genre", state: .mismatch, detail: "This show is \(show); your profile lists \(artistGenres.joined(separator: ", "))."))
            }
        }

        // Location / travel — straight-line distance only; never a journey time.
        if artistLocation == slotCity {
            signals.append(Signal(key: .location, label: "Location", state: .match, detail: "You're based in \(slotCity)."))
        } else if let miles = distanceMiles {
            let within = miles <= travelRadiusMiles
            signals.append(Signal(
                key: .location, label: "Location", state: within ? .partial : .mismatch,
                detail: within
                    ? "About \(Geo.describe(miles: miles)) from \(artistLocation) in a straight line, within the \(travelRadiusMiles)-mile travel radius you set."
                    : "About \(Geo.describe(miles: miles)) from \(artistLocation) in a straight line, beyond the \(travelRadiusMiles)-mile travel radius you set."))
        } else {
            signals.append(Signal(key: .location, label: "Location", state: .unknown,
                                  detail: "We can’t compare \(artistLocation) with \(slotCity) because one of them has no map position. Choose a place from the search to see this."))
        }

        // Artist size
        if slotSizeFit.isEmpty {
            signals.append(Signal(key: .size, label: "Artist size", state: .unknown, detail: "The promoter hasn't said what size of act they want."))
        } else if slotSizeFit.contains(artistSize) {
            signals.append(Signal(key: .size, label: "Artist size", state: .match, detail: "They want \(slotSizeFit.joined(separator: " or ")) acts; you're \(artistSize)."))
        } else {
            signals.append(Signal(key: .size, label: "Artist size", state: .mismatch, detail: "They want \(slotSizeFit.joined(separator: " or ")) acts; you're \(artistSize)."))
        }

        let matched = signals.filter { $0.state == .match }.count
        let assessed = signals.filter { $0.state != .unknown }.count
        let summary = assessed == 0 ? "Not enough profile information to compare yet." : "\(matched) of \(assessed) fit signals match."
        return Fit(signals: signals, matched: matched, assessed: assessed, summary: summary)
    }

    /// `artistCoordinate` is the artist's OWN private position (only they can read it).
    /// A promoter can't read an artist's position; `approxDistanceMiles` is the database's
    /// answer (rounded up to 5 miles) from `terms_preview`.
    static func explain(artist: Artist, slot: Slot, artistCoordinate: Coordinate? = nil, approxDistanceMiles: Int? = nil) -> Fit {
        let miles = approxDistanceMiles ?? artistCoordinate.flatMap { a in slot.coordinate.map { Int(Geo.miles(a, $0).rounded()) } }
        return explain(artistGenres: artist.genres, artistLocation: artist.location, travelRadiusMiles: artist.travelRadiusMiles, artistSize: artist.artistSize,
                slotGenres: slot.genres, slotCity: slot.city, slotSizeFit: slot.artistSizeFit, distanceMiles: miles)
    }
}
