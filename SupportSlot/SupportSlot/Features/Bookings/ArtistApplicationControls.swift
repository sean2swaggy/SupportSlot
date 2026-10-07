import SwiftUI

/// Everything an artist can do with one application, depending on where it is:
/// answer an offer, withdraw, cancel a confirmed booking, message the promoter.
struct ArtistApplicationControls: View {
    @Environment(AppStore.self) private var store
    let application: Application
    let booking: Booking?
    @State private var sheet: Sheet?
    @State private var error: String?
    private enum Sheet: String, Identifiable { case withdraw, declineOffer, cancel; var id: String { rawValue } }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            switch application.applicationStatus {
            case .offered:
                if let booking { offerCard(booking) }
            case .confirmed:
                if let booking { confirmedCard(booking) }
            case .submitted, .viewed, .shortlisted:
                HStack(spacing: 12) {
                    MessageButton(applicationId: application.id)
                    Button("Withdraw application") { sheet = .withdraw }.buttonStyle(.app(.ghost, compact: true)).foregroundStyle(Theme.paperDim)
                }
            case .cancelled:
                if let reason = booking?.cancelReason { Text("Cancelled. Reason: \(reason)").dimBody(13) }
            case .declined:
                if application.closedReason == "slot_filled" { Text("The promoter booked another act for this slot.").dimBody(13) }
                else if application.closedReason == "listing_cancelled" { Text("The listing was cancelled by the promoter.").dimBody(13) }
                else if application.closedReason == "promoter_declined" || application.closedReason == nil { Text("The promoter chose not to take this one forward this time.").dimBody(13) }
                else { Text("This listing is no longer taking applications.").dimBody(13) }
            case .offerDeclined, .withdrawn:
                EmptyView()
            }
            if let error { Banner(kind: .error, text: error) }
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .withdraw:
                ReasonSheet(title: "Withdraw your application?", message: "The promoter will no longer see it as active. You can apply again later only if the listing is still open.", confirmLabel: "Withdraw") { _ in
                    await run { try await store.db.withdrawApplication(applicationId: application.id) }
                }
            case .declineOffer:
                ReasonSheet(title: "Decline this offer?", message: "The promoter is told you’ve declined and the slot stays open for other artists.", confirmLabel: "Decline offer") { reason in
                    await run { try await store.db.respondToOffer(applicationId: application.id, accept: false, reason: reason.isEmpty ? nil : reason) }
                }
            case .cancel:
                ReasonSheet(title: "Cancel this booking?", message: "The promoter is told straight away and the slot goes back on the market.", confirmLabel: "Cancel booking", requireReason: true) { reason in
                    await run { try await store.db.cancelBooking(applicationId: application.id, reason: reason) }
                }
            }
        }
    }

    private func offerCard(_ b: Booking) -> some View {
        let expired = b.offerExpiresAt < Date()
        return VStack(alignment: .leading, spacing: 14) {
            MonoLabel("\(b.promoterCompany) made you an offer", color: Theme.acid)
            BookingTermsView(booking: b, viewer: .artist)
            Text(expired ? "This offer has expired." : "Respond by \(b.offerExpiresAt.ukDateTime). Accepting confirms the booking.").dimBody(13)
            HStack(spacing: 12) {
                AsyncButton(compact: true) { _ = await run { try await store.db.respondToOffer(applicationId: application.id, accept: true, reason: nil) } } label: { Text("Accept offer") }
                    .disabled(expired)
                Button("Decline") { sheet = .declineOffer }.buttonStyle(.app(.outline, compact: true))
            }
        }
        .padding(16)
        .background(Theme.acid.opacity(0.05))
        .overlay(Rectangle().stroke(Theme.acid.opacity(0.6), lineWidth: 1))
    }

    private func confirmedCard(_ b: Booking) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            MonoLabel("Booking confirmed", color: Theme.ok)
            BookingTermsView(booking: b, viewer: .artist)
            Text("Agree how and when you’re paid with the promoter — message them from here. Support Slot doesn’t take or hold payment.").dimBody(13)
            HStack(spacing: 12) {
                MessageButton(applicationId: application.id)
                Button("Cancel booking") { sheet = .cancel }.buttonStyle(.app(.ghost, compact: true)).foregroundStyle(Theme.signal)
            }
        }
        .padding(16)
        .background(Theme.ok.opacity(0.05))
        .overlay(Rectangle().stroke(Theme.ok.opacity(0.5), lineWidth: 1))
    }

    /// Runs a write through the store (which re-reads afterwards). Returns the error text, or nil.
    @discardableResult
    private func run(_ work: @escaping () async throws -> some Any) async -> String? {
        do { _ = try await store.perform { try await work() }; error = nil; return nil }
        catch { let m = (error as? AppError)?.message ?? "Something went wrong. Please try again."; self.error = m; return m }
    }
}
