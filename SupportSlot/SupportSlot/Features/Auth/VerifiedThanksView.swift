import SwiftUI

/// Shown once, right after someone confirms their email: a ring draws itself,
/// a tick follows, then a short thank-you. It carries on by itself after a few
/// seconds (or on tap). With Reduce Motion on, nothing animates.
struct VerifiedThanksView: View {
    var onFinish: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var ring: CGFloat = 0
    @State private var tick: CGFloat = 0
    @State private var pop = false
    @State private var text = false

    var body: some View {
        ZStack {
            Theme.ink.ignoresSafeArea()
            VStack(spacing: 30) {
                ZStack {
                    Circle()
                        .trim(from: 0, to: ring)
                        .stroke(Theme.acid, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    CheckShape()
                        .trim(from: 0, to: tick)
                        .stroke(Theme.acid, style: StrokeStyle(lineWidth: 8, lineCap: .round, lineJoin: .round))
                        .padding(38)
                }
                .frame(width: 132, height: 132)
                .scaleEffect(pop ? 1 : 0.85)
                .accessibilityHidden(true)

                VStack(spacing: 10) {
                    MonoLabel("Email confirmed", color: Theme.acid)
                    Text("Thanks for joining.")
                        .font(Theme.display(34)).foregroundStyle(Theme.paper).multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)
                    Text("You’re verified. Next, let’s set up your profile.")
                        .dimBody(16).multilineTextAlignment(.center)
                }
                .opacity(text ? 1 : 0)
                .offset(y: text ? 0 : 10)

                Button("Continue", action: onFinish)
                    .buttonStyle(.appPrimary)
                    .opacity(text ? 1 : 0)
                    .padding(.top, 6)
            }
            .padding(32)
            .frame(maxWidth: 420)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onFinish)
        .task { await play() }
    }

    private func play() async {
        if reduceMotion {
            ring = 1; tick = 1; pop = true; text = true
            try? await Task.sleep(for: .milliseconds(1800))
            onFinish()
            return
        }
        withAnimation(.easeOut(duration: 0.6)) { ring = 1; pop = true }
        withAnimation(.easeOut(duration: 0.35).delay(0.55)) { tick = 1 }
        withAnimation(.easeOut(duration: 0.5).delay(0.95)) { text = true }
        try? await Task.sleep(for: .milliseconds(3200))
        onFinish()
    }
}

private struct CheckShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX + rect.width * 0.02, y: rect.midY + rect.height * 0.04))
        p.addLine(to: CGPoint(x: rect.minX + rect.width * 0.36, y: rect.maxY - rect.height * 0.06))
        p.addLine(to: CGPoint(x: rect.maxX - rect.width * 0.02, y: rect.minY + rect.height * 0.12))
        return p
    }
}
