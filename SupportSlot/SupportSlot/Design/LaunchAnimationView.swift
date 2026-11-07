import SwiftUI

/// Launch animation: SUPPORT and SLOT slide in from either side, the acid slash
/// spins in and snaps between them, then the tagline fades up. About 2 seconds.
/// With Reduce Motion on it shows the finished logo briefly with no movement.
struct LaunchAnimationView: View {
    var onFinish: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var words = false
    @State private var slash = false
    @State private var tagline = false

    var body: some View {
        ZStack {
            Theme.ink.ignoresSafeArea()
            VStack(spacing: 14) {
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    Text("SUPPORT")
                        .foregroundStyle(Theme.paper)
                        .offset(x: words ? 0 : -70).opacity(words ? 1 : 0)
                    Text("/")
                        .foregroundStyle(Theme.acid)
                        .scaleEffect(slash ? 1 : 0.1)
                        .rotationEffect(.degrees(slash ? 0 : -30))
                        .opacity(slash ? 1 : 0)
                    Text("SLOT")
                        .foregroundStyle(Theme.paper)
                        .offset(x: words ? 0 : 70).opacity(words ? 1 : 0)
                }
                .font(Theme.display(34))
                .tracking(-0.5)
                .lineLimit(1)
                .minimumScaleFactor(0.5)

                Text("FIND YOUR NEXT STAGE")
                    .font(Theme.mono(11))
                    .tracking(2)
                    .foregroundStyle(Theme.paperDim)
                    .opacity(tagline ? 1 : 0)
                    .offset(y: tagline ? 0 : 6)
            }
            .padding(.horizontal, 24)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Support Slot")
        .task { await play() }
    }

    private func play() async {
        if reduceMotion {
            words = true; slash = true; tagline = true
            try? await Task.sleep(for: .milliseconds(700))
            onFinish()
            return
        }
        withAnimation(.timingCurve(0.2, 0.9, 0.2, 1, duration: 0.6).delay(0.1)) { words = true }
        withAnimation(.interpolatingSpring(stiffness: 220, damping: 14).delay(0.6)) { slash = true }
        withAnimation(.easeOut(duration: 0.5).delay(1.15)) { tagline = true }
        try? await Task.sleep(for: .milliseconds(2000))
        onFinish()
    }
}
