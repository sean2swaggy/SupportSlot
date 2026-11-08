import SwiftUI
import UIKit

/// When to celebrate on the promoter's side: only the moment an offer turns into a booking,
/// never when a screen simply loads and the booking was already there.
enum OfferAcceptedRule {
    static func shouldCelebrate(from old: ApplicationStatus, to new: ApplicationStatus) -> Bool {
        old == .offered && new == .confirmed
    }
}

/// Shown at the top of an applicant's card when the artist accepts the promoter's offer:
/// a ring and tick draw themselves, the banner glows, and there is a short success buzz.
/// With Reduce Motion on it simply appears finished.
struct OfferAcceptedBanner: View {
    let artistName: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var ring: CGFloat = 0
    @State private var tick: CGFloat = 0
    @State private var glow = false

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .trim(from: 0, to: ring)
                    .stroke(Theme.acid, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Tick()
                    .trim(from: 0, to: tick)
                    .stroke(Theme.acid, style: StrokeStyle(lineWidth: 3.5, lineCap: .round, lineJoin: .round))
                    .frame(width: 17, height: 17)
            }
            .frame(width: 38, height: 38)
            VStack(alignment: .leading, spacing: 2) {
                Text("Offer accepted!").font(Theme.body(15, weight: .semibold)).foregroundStyle(Theme.acid)
                Text("\(artistName) is booked.").font(Theme.body(12)).foregroundStyle(Theme.paperDim)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Theme.acid.opacity(glow ? 0.16 : 0.05))
        .overlay(Rectangle().stroke(Theme.acid.opacity(glow ? 0.9 : 0.35), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Offer accepted. \(artistName) is booked.")
        .task { await play() }
    }

    private func play() async {
        if reduceMotion { ring = 1; tick = 1; return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        withAnimation(.easeOut(duration: 0.2)) { glow = true }
        withAnimation(.easeOut(duration: 0.5)) { ring = 1 }
        try? await Task.sleep(for: .milliseconds(380))
        withAnimation(.easeOut(duration: 0.3)) { tick = 1 }
        try? await Task.sleep(for: .milliseconds(500))
        withAnimation(.easeInOut(duration: 1.4)) { glow = false }
    }
}
