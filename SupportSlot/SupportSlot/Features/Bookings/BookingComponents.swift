import SwiftUI

/// The agreed terms exactly as stored on the booking when the offer was made.
/// Later edits to the listing can't change these. Support Slot doesn't handle
/// money: the promoter pays the artist directly.
struct BookingTermsView: View {
    let booking: Booking
    let viewer: UserRole
    /// Set when the screen already offers a prominent "Add to calendar".
    var hideCalendar = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(spacing: 0) {
                row("Show", booking.headliner)
                row("Venue", "\(booking.venueName), \(booking.venueCity)", note: booking.venueAddress)
                row("Date", UKDates.formatShowDate(booking.eventDate, withYear: true))
                row("Doors / on stage", "\(UKDates.clock(booking.doorsTime)) / \(UKDates.clock(booking.setTime))", note: "\(booking.setLengthMins)-minute set")
                row("Performance fee", Money.pence(booking.feePence))
                if booking.travelPence > 0 { row("Travel contribution", Money.pence(booking.travelPence)) }
                row(viewer == .artist ? "You’ll be paid" : "You pay the artist", Money.pence(booking.totalPence),
                    note: "Paid directly between you and the other side — Support Slot doesn’t take or hold payment.", bold: true)
            }
            .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
            if !booking.requirements.isEmpty {
                Text("**Requirements:** \(booking.requirements.joined(separator: " · "))").font(Theme.body(13)).foregroundStyle(Theme.paperDim)
            }
            if let m = booking.offerMessage, !m.isEmpty {
                Text(m).font(Theme.body(15)).foregroundStyle(Theme.paper).padding(.leading, 12)
                    .overlay(alignment: .leading) { Rectangle().fill(Theme.acid).frame(width: 2) }
            }
            if booking.bookingStatus == .confirmed { BookingExtras(booking: booking, showCalendar: !hideCalendar) }
        }
    }

    private func row(_ label: String, _ value: String, note: String? = nil, bold: Bool = false) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).font(bold ? Theme.display(16) : Theme.body(14)).foregroundStyle(bold ? Theme.paper : Theme.paperDim)
                    if let note { Text(note).font(Theme.body(11)).foregroundStyle(Theme.paperDim.opacity(0.8)) }
                }
                Spacer(minLength: 8)
                Text(value).font(bold ? Theme.display(19) : Theme.body(14)).foregroundStyle(Theme.paper).multilineTextAlignment(.trailing)
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            Divider1()
        }
        .accessibilityElement(children: .combine)
    }
}

/// Asks for a reason (or a confirmation) before something that can't be undone.
struct ReasonSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let message: String
    let confirmLabel: String
    var requireReason = false
    var reasonLabel = "Reason"
    var destructive = true
    /// Returns an error message to show, or nil on success.
    let onConfirm: (String) async -> String?

    @State private var reason = ""
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                DisplayTitle(title, size: 26)
                Text(message).dimBody(15)
                LabeledField(label: requireReason ? reasonLabel : "\(reasonLabel) (optional)") {
                    TextArea(text: $reason, placeholder: requireReason ? "Required" : "Optional", minHeight: 100)
                }
                if let error { Banner(kind: .error, text: error) }
                HStack(spacing: 12) {
                    Button("Go back") { dismiss() }.buttonStyle(.appOutline)
                    AsyncButton(kind: destructive ? .danger : .primary) { await confirm() } label: { Text(confirmLabel) }
                }
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .presentationDetents([.medium, .large])
    }

    private func confirm() async {
        error = nil
        let text = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        if requireReason, text.count < 3 { error = "Please give a reason (at least 3 characters)."; return }
        if let failure = await onConfirm(text) { error = failure } else { dismiss() }
    }
}

/// Opens (or finds) the conversation for an application and jumps to it.
struct MessageButton: View {
    @Environment(AppStore.self) private var store
    let applicationId: ID
    var compact = true
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AsyncButton(kind: .outline, compact: compact) {
                error = nil
                do {
                    let threadId = try await store.db.openThread(applicationId: applicationId)
                    await store.refreshThreads()
                    store.pendingThreadID = threadId
                    store.selectedTab = .messages
                } catch { self.error = (error as? AppError)?.message ?? "Couldn’t open that conversation." }
            } label: { Label("Message", systemImage: "bubble.left") }
            FieldError(message: error)
        }
    }
}

extension Date {
    /// "Tue 7 Oct, 14:30" in UK time.
    var ukDateTime: String { UKDates.dateTime(self) }
}
