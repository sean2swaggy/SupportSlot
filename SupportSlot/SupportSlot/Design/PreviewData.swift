import Foundation

#if DEBUG
/// A made-up booking for looking at screens without signing in. Not compiled into release builds.
enum PreviewData {
    static var booking: Booking? {
        let json = """
        {"id":"b1","application_id":"a1","slot_id":"s1","artist_id":"x","promoter_id":"y","status":"confirmed",
         "artist_name":"The Artist","promoter_company":"Night Owl Presents","headliner":"Static Garden","venue_name":"The Old Hall",
         "venue_address":"12 High Street, OX16 1AA","venue_city":"Banbury","event_date":"2099-06-12","doors_time":"19:00:00",
         "set_time":"20:00:00","set_length_mins":30,"requirements":[],"fee_pence":15000,"travel_pence":0,"offer_message":null,
         "offered_at":"2026-11-08T10:00:00Z","offer_expires_at":"2099-06-01T10:00:00Z","confirmed_at":"2026-11-08T11:00:00Z",
         "cancelled_at":null,"cancel_reason":null,"decline_reason":null}
        """
        let d = JSONDecoder(); d.keyDecodingStrategy = .convertFromSnakeCase; d.dateDecodingStrategy = .iso8601
        return try? d.decode(Booking.self, from: Data(json.utf8))
    }
}
#endif
