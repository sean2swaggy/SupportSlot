import SwiftUI

/// What a signed-out person sees first: a short welcome that leads to sign-up.
/// Browsing without an account is still possible, but it is a quiet link, not the front door.
struct SignedOutFlow: View {
    enum Step: Equatable { case welcome, auth(AuthView.Mode), browse }
    @State private var step: Step = .welcome

    var body: some View {
        ZStack {
            switch step {
            case .welcome:
                WelcomeView(
                    onSignUp: { step = .auth(.signup) },
                    onLogin: { step = .auth(.login) },
                    onBrowse: { step = .browse }
                )
                .transition(.opacity)
            case .auth(let mode):
                AuthView(mode: mode, onBack: { step = .welcome })
                    .id(mode)
                    .transition(.opacity)
            case .browse:
                VisitorShell().transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.25), value: step)
    }
}

struct WelcomeView: View {
    var onSignUp: () -> Void
    var onLogin: () -> Void
    var onBrowse: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    private let steps: [(String, String)] = [
        ("01", "Make a profile in a couple of minutes"),
        ("02", "Find support slots that fit your sound"),
        ("03", "Apply, and see the fee before you do"),
    ]

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    Spacer(minLength: 12)
                    Logo(size: 24)
                    VStack(alignment: .leading, spacing: 12) {
                        MonoLabel("Welcome", color: Theme.acid)
                        Text("Let’s get you\nonto a stage.")
                            .font(Theme.display(40)).foregroundStyle(Theme.paper)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                        Text("Support Slot connects artists with promoters who need an opening act. No pay-to-play, ever.")
                            .dimBody(16)
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(steps, id: \.0) { n, text in
                            HStack(alignment: .firstTextBaseline, spacing: 14) {
                                Text(n).font(Theme.mono(13, weight: .bold)).foregroundStyle(Theme.acid)
                                Text(text).font(Theme.body(16)).foregroundStyle(Theme.paper)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                    VStack(spacing: 12) {
                        Button("Create account", action: onSignUp).buttonStyle(.appPrimary)
                        Button("I already have an account", action: onLogin).buttonStyle(.appOutline)
                        Button("Just looking? Browse open slots", action: onBrowse)
                            .font(Theme.mono(12)).foregroundStyle(Theme.paperDim)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    Spacer(minLength: 12)
                }
                .padding(24)
                .frame(maxWidth: 520, minHeight: geo.size.height)
                .frame(maxWidth: .infinity)
                .opacity(shown ? 1 : 0)
                .offset(y: shown || reduceMotion ? 0 : 12)
            }
        }
        .screenBackground()
        .onAppear {
            if reduceMotion { shown = true } else { withAnimation(.easeOut(duration: 0.5).delay(0.1)) { shown = true } }
        }
    }
}
