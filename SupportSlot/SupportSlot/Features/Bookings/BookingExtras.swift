import SwiftUI
import EventKit

/// The "Add to calendar" button on its own, so it can sit wherever it's needed.
/// It only ever adds one event (with reminders) and can never read the person's calendar.
struct AddToCalendarButton: View {
    let booking: Booking
    var prominent = false
    @State private var note: String?
    @State private var failed = false
    @State private var working = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { Task { await add() } } label: {
                Label("Add to calendar", systemImage: "calendar.badge.plus").frame(maxWidth: prominent ? .infinity : nil)
            }
            .buttonStyle(prominent ? .app(.primary) : .app(.outline, compact: true))
            .disabled(working)
            if let note { Banner(kind: failed ? .error : .success, text: note) }
        }
    }

    private func add() async {
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

/// Shown under a confirmed booking: put it in the calendar (with reminders) or send the details on.
struct BookingExtras: View {
    let booking: Booking
    /// Hide the calendar button when the screen already shows one more prominently.
    var showCalendar = true

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            MonoLabel("Before the show")
            FlowLayout(spacing: 10) {
                if showCalendar { AddToCalendarButton(booking: booking) }
                ShareLink(item: ShowDetails.shareText(booking)) { Label("Share show details", systemImage: "square.and.arrow.up") }
                    .buttonStyle(.app(.outline, compact: true))
            }
            LeaveReviewSection(booking: booking)
        }
    }
}

/// Shown the moment an artist accepts an offer.
struct BookedCelebrationSheet: View {
    @Environment(\.dismiss) private var dismiss
    let booking: Booking

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    Image(systemName: "checkmark").font(.system(size: 28, weight: .bold)).foregroundStyle(Theme.acid)
                        .frame(width: 64, height: 64).overlay(Rectangle().stroke(Theme.acid, lineWidth: 1)).accessibilityHidden(true)
                    Text("You’re booked.").font(Theme.display(30)).foregroundStyle(Theme.paper)
                    VStack(spacing: 6) {
                        Text(booking.headliner).font(Theme.body(17, weight: .medium)).foregroundStyle(Theme.paper).multilineTextAlignment(.center)
                        Text("\(booking.venueName), \(booking.venueCity)").font(Theme.body(14)).foregroundStyle(Theme.paperDim)
                        Text("\(UKDates.formatShowDate(booking.eventDate, withYear: true)) · doors \(UKDates.clock(booking.doorsTime)) · on stage \(UKDates.clock(booking.setTime))")
                            .font(Theme.mono(12)).foregroundStyle(Theme.acid).multilineTextAlignment(.center)
                    }
                    AddToCalendarButton(booking: booking, prominent: true)
                    ShareLink(item: ShowDetails.shareText(booking)) { Label("Share show details", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity) }
                        .buttonStyle(.app(.outline))
                    Text("Agree how and when you’re paid with the promoter. Support Slot doesn’t take or hold payment.").dimBody(12).multilineTextAlignment(.center)
                    Button("Done") { dismiss() }.buttonStyle(.app(.ghost))
                }
                .padding(24)
            }
            .screenBackground()
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationBackground(Theme.ink)
    }
}
