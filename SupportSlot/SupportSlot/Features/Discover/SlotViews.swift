import SwiftUI

/// A listing as a card: poster image, what/where/when, money, and (for artists) a save button.
struct SlotCard: View {
    @Environment(AppStore.self) private var store
    let slot: Slot
    var showSave = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                RemoteImage(source: slot.headlinerImageUrl)
                    .frame(height: 150)
                    .overlay(LinearGradient(colors: [.clear, Theme.ink.opacity(0.75)], startPoint: .center, endPoint: .bottom))
                HStack {
                    if slot.isUrgent { Tag("Needed tonight", tint: Theme.signal, filled: true) }
                    Spacer()
                }
                .padding(10)
            }
            .frame(height: 150)
            .clipped()

            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(slot.headliner).font(Theme.display(21)).foregroundStyle(Theme.paper).lineLimit(2).multilineTextAlignment(.leading)
                    Text([slot.venue?.name, slot.city].compactMap { $0 }.joined(separator: " · ")).dimBody(14)
                }
                HStack(spacing: 14) {
                    Label(UKDates.shortDate(slot.date), systemImage: "calendar").font(Theme.mono(12)).foregroundStyle(Theme.paper)
                    Label(Money.gbp(slot.supportFee), systemImage: "sterlingsign.circle").font(Theme.mono(12)).foregroundStyle(Theme.acid)
                }
                FlowLayout(spacing: 6) { ForEach(slot.genres, id: \.self) { Tag($0) } }
                Text(UKDates.applicationCloseText(slot.applicationDeadline)).font(Theme.mono(10)).foregroundStyle(Theme.paperDim).textCase(.uppercase)
            }
            .padding(14)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.inkCard)
        .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            if showSave, store.isSignedIn, store.role == .artist { SaveGigButton(slotId: slot.id).padding(6) }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .contain)
    }
}

/// Save / unsave a gig (artists only).
struct SaveGigButton: View {
    @Environment(AppStore.self) private var store
    let slotId: ID
    var showLabel = false
    @State private var error: String?

    var body: some View {
        let saved = store.isSaved(slotId)
        Button {
            Task { do { try await store.toggleSaved(slotId); error = nil } catch { self.error = (error as? AppError)?.message } }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: saved ? "bookmark.fill" : "bookmark").font(.system(size: 16, weight: .semibold))
                if showLabel { Text(saved ? "Saved" : "Save").font(Theme.mono(11)).textCase(.uppercase) }
            }
            .foregroundStyle(saved ? Theme.acid : Theme.paper)
            .padding(.horizontal, showLabel ? 14 : 0)
            .frame(minWidth: 44, minHeight: 44)
            .background(showLabel ? .clear : Theme.ink.opacity(0.7))
            .overlay(Rectangle().stroke(showLabel ? Theme.inkBorder : .clear, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(saved ? "Remove from saved gigs" : "Save this gig")
        .alert("Couldn’t update your saved gigs", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(error ?? "") }
    }
}

/// How a listing fits the artist's own profile — plain reasons, no score.
struct FitSummaryView: View {
    let fit: Fit
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack { MonoLabel("How it fits you"); Spacer(); Text(fit.summary).font(Theme.body(13)).foregroundStyle(Theme.paperDim) }
            ForEach(fit.signals) { s in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: icon(s.state)).foregroundStyle(color(s.state)).frame(width: 20)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.label).font(Theme.body(14, weight: .semibold)).foregroundStyle(Theme.paper)
                        Text(s.detail).font(Theme.body(13)).foregroundStyle(Theme.paperDim)
                    }
                }
                .accessibilityElement(children: .combine)
            }
            Text("This is information from your profile and the listing — not a score or a ranking. Promoters choose who to book.")
                .font(Theme.body(11)).foregroundStyle(Theme.paperDim.opacity(0.8))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
    }
    private func icon(_ s: Fit.State) -> String {
        switch s { case .match: return "checkmark.circle.fill"; case .partial: return "circle.lefthalf.filled"; case .mismatch: return "xmark.circle"; case .unknown: return "questionmark.circle" }
    }
    private func color(_ s: Fit.State) -> Color {
        switch s { case .match: return Theme.ok; case .partial: return Theme.acid; case .mismatch: return Theme.signal; case .unknown: return Theme.paperDim }
    }
}
