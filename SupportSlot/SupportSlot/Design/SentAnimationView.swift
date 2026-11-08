import SwiftUI
import UIKit

/// The "your application was sent" moment: a paper plane flies off, a ring and tick draw
/// themselves, and a burst of squares spreads out, with a short success buzz.
/// With Reduce Motion on, the finished tick simply appears.
struct SentAnimationView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var flight: CGFloat = 0     // 0 → 1: the plane's journey
    @State private var ring: CGFloat = 0
    @State private var tick: CGFloat = 0
    @State private var burst: CGFloat = 0
    @State private var burstOpacity: Double = 0   // its own state: an animation between two 0s would never show
    @State private var pop = false

    private let particles = 14

    var body: some View {
        ZStack {
            // The burst of squares.
            ForEach(0..<particles, id: \.self) { i in
                let angle = Double(i) / Double(particles) * 2 * .pi
                let distance: CGFloat = (i % 2 == 0 ? 108 : 82) * burst
                Rectangle()
                    .fill(i % 3 == 0 ? Theme.paper : Theme.acid)
                    .frame(width: i % 2 == 0 ? 12 : 8, height: i % 2 == 0 ? 12 : 8)
                    .rotationEffect(.degrees(Double(i) * 23 + Double(burst) * 90))
                    .offset(x: cos(angle) * distance, y: sin(angle) * distance)
                    .opacity(burstOpacity)
            }
            // The ring and the tick.
            Circle()
                .trim(from: 0, to: ring)
                .stroke(Theme.acid, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .frame(width: 112, height: 112)
                .scaleEffect(pop ? 1 : 0.9)
            Tick()
                .trim(from: 0, to: tick)
                .stroke(Theme.acid, style: StrokeStyle(lineWidth: 8, lineCap: .round, lineJoin: .round))
                .frame(width: 52, height: 52)
            // The plane: starts low and left, curves up and to the right, shrinks and fades.
            Image(systemName: "paperplane.fill")
                .font(.system(size: 34, weight: .bold))
                .foregroundStyle(Theme.acid)
                .rotationEffect(.degrees(-20))
                .scaleEffect(1 - 0.55 * flight)
                .offset(x: -110 + 260 * flight, y: 120 - 250 * flight - 40 * sin(flight * .pi))
                .opacity(flight == 0 ? 0 : Double(1 - max(0, (flight - 0.55) / 0.45)))
        }
        .frame(width: 220, height: 220)
        .accessibilityHidden(true)
        .task { await play() }
    }

    private func play() async {
        if reduceMotion { ring = 1; tick = 1; pop = true; return }
        withAnimation(.easeIn(duration: 0.1)) { flight = 0.001 }
        withAnimation(.easeInOut(duration: 0.7)) { flight = 1 }
        try? await Task.sleep(for: .milliseconds(450))
        withAnimation(.easeOut(duration: 0.5)) { ring = 1; pop = true }
        try? await Task.sleep(for: .milliseconds(380))
        withAnimation(.easeOut(duration: 0.3)) { tick = 1 }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        burstOpacity = 1
        withAnimation(.easeOut(duration: 1.0)) { burst = 1 }
        withAnimation(.easeIn(duration: 0.45).delay(0.55)) { burstOpacity = 0 }
    }
}

private struct Tick: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX + rect.width * 0.02, y: rect.midY + rect.height * 0.04))
        p.addLine(to: CGPoint(x: rect.minX + rect.width * 0.36, y: rect.maxY - rect.height * 0.06))
        p.addLine(to: CGPoint(x: rect.maxX - rect.width * 0.02, y: rect.minY + rect.height * 0.12))
        return p
    }
}
