import SwiftUI
import EventKit

/// Shown under a confirmed booking: put it in the calendar (with reminders) or send the details on.
struct BookingExtras: View {
    let booking: Booking
    @State private var note: String?
    @State private var failed = false
    @State private var working = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            MonoLabel("Before the show")
            FlowLayout(spacing: 10) {
                Button { Task { await addToCalendar() } } label: { Label("Add to calendar", systemImage: "calendar.badge.plus") }
                    .buttonStyle(.app(.outline, compact: true)).disabled(working)
                ShareLink(item: ShowDetails.shareText(booking)) { Label("Share show details", systemImage: "square.and.arrow.up") }
                    .buttonStyle(.app(.outline, compact: true))
            }
            if let note { Banner(kind: failed ? .error : .success, text: note) }
        }
    }

    private func addToCalendar() async {
        working = true; defer { working = false }
        guard let start = ShowDetails.moment(date: booking.eventDate, time: booking.doorsTime) else {
            failed = true; note = "We couldn’t read this show’s date."; return
        }
        let store = EKEventStore()
        do {
            guard try await store.requestWriteOnlyAccessToEvents() else {
                failed = true; note = "Calendar access is off. You can turn it on in Settings → Support Slot."; return
            }
            let event = EKEvent(eventStore: store)
            event.title = "\(booking.headliner) (support slot)"
            event.location = "\(booking.venueName), \(booking.venueAddress)"
            event.startDate = start
            event.endDate = ShowDetails.moment(date: booking.eventDate, time: booking.setTime)?.addingTimeInterval(Double(booking.setLengthMins) * 60 + 3600) ?? start.addingTimeInterval(4 * 3600)
            event.notes = "Doors \(UKDates.clock(booking.doorsTime)), on stage \(UKDates.clock(booking.setTime)).\nBooked through Support Slot."
            event.calendar = store.defaultCalendarForNewEvents
            event.addAlarm(EKAlarm(relativeOffset: -86_400))   // the day before
            event.addAlarm(EKAlarm(relativeOffset: -10_800))   // three hours before doors
            try store.save(event, span: .thisEvent)
            failed = false; note = "Added, with reminders the day before and three hours before doors."
        } catch {
            failed = true; note = "Couldn’t add it to your calendar. Please try again."
        }
    }
}
