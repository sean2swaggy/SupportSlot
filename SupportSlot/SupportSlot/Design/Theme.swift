import SwiftUI

/// The Support Slot look: dark, editorial, gig-poster. Square corners, hairline
/// borders, uppercase display type, monospace labels, one acid accent.
enum Theme {
    static let ink = Color(red: 0x0a / 255, green: 0x0a / 255, blue: 0x0b / 255)
    static let inkRaised = Color(red: 0x12 / 255, green: 0x12 / 255, blue: 0x14 / 255)
    static let inkCard = Color(red: 0x17 / 255, green: 0x17 / 255, blue: 0x1a / 255)
    static let inkBorder = Color(red: 0x29 / 255, green: 0x29 / 255, blue: 0x2e / 255)
    static let paper = Color(red: 0xf4 / 255, green: 0xf2 / 255, blue: 0xec / 255)
    static let paperDim = Color(red: 0xa9 / 255, green: 0xa7 / 255, blue: 0xa0 / 255)
    static let acid = Color(red: 0xd6 / 255, green: 0xff / 255, blue: 0x3f / 255)
    static let acidInk = Color(red: 0x10 / 255, green: 0x14 / 255, blue: 0x0a / 255)
    static let signal = Color(red: 0xff / 255, green: 0x5a / 255, blue: 0x36 / 255)
    static let ok = Color(red: 0x38 / 255, green: 0xe0 / 255, blue: 0x8f / 255)

    /// Sizes follow the person's Dynamic Type setting (Settings → Display & Brightness → Text Size,
    /// or Accessibility → Larger Text). The root view is rebuilt when that setting changes.
    static func scaled(_ size: CGFloat) -> CGFloat { UIFontMetrics.default.scaledValue(for: size) }

    // Display = Space Grotesk on the web; the system face at heavy weight is the closest native match.
    static func display(_ size: CGFloat) -> Font { .system(size: scaled(size), weight: .bold, design: .default) }
    static func mono(_ size: CGFloat, weight: Font.Weight = .medium) -> Font { .system(size: scaled(size), weight: weight, design: .monospaced) }
    static func body(_ size: CGFloat = 16, weight: Font.Weight = .regular) -> Font { .system(size: scaled(size), weight: weight) }

    static let hairline: CGFloat = 1
}

// MARK: - Text styles

struct Eyebrow: View {
    let text: String
    var color: Color = Theme.acid
    init(_ text: String, color: Color = Theme.acid) { self.text = text; self.color = color }
    var body: some View {
        Text(text.uppercased())
            .font(Theme.mono(11))
            .tracking(2.4)
            .foregroundStyle(color)
            .accessibilityAddTraits(.isHeader)
    }
}

struct DisplayTitle: View {
    let text: String
    var size: CGFloat = 34
    init(_ text: String, size: CGFloat = 34) { self.text = text; self.size = size }
    var body: some View {
        Text(text.uppercased())
            .font(Theme.display(size))
            .tracking(-0.5)
            .lineSpacing(-4)
            .foregroundStyle(Theme.paper)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }
}

struct MonoLabel: View {
    let text: String
    var color: Color = Theme.paperDim
    init(_ text: String, color: Color = Theme.paperDim) { self.text = text; self.color = color }
    var body: some View {
        Text(text.uppercased()).font(Theme.mono(10)).tracking(1.6).foregroundStyle(color)
    }
}

extension View {
    func dimBody(_ size: CGFloat = 15) -> some View { font(Theme.body(size)).foregroundStyle(Theme.paperDim) }
}

// MARK: - Surfaces

struct Card<Content: View>: View {
    var padding: CGFloat = 16
    var accent: Color? = nil
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.inkCard)
            .overlay(Rectangle().stroke(accent ?? Theme.inkBorder, lineWidth: Theme.hairline))
    }
}

struct Divider1: View {
    var body: some View { Rectangle().fill(Theme.inkBorder).frame(height: Theme.hairline) }
}

/// Full-screen dark background behind every screen.
struct ScreenBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Theme.ink.ignoresSafeArea())
            .scrollContentBackground(.hidden)
            .toolbarBackground(Theme.ink, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

extension View {
    func screenBackground() -> some View { modifier(ScreenBackground()) }
}

// MARK: - Buttons

struct AppButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, outline, danger, ghost }
    var kind: Kind = .primary
    var compact = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.mono(compact ? 11 : 13, weight: .semibold))
            .textCase(.uppercase)
            .tracking(0.8)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, compact ? 14 : 20)
            .frame(minHeight: compact ? 40 : 50)
            .frame(maxWidth: kind == .ghost ? nil : .infinity)
            .foregroundStyle(foreground)
            .background(background(pressed: configuration.isPressed))
            .overlay(Rectangle().stroke(border, lineWidth: Theme.hairline))
            .opacity(isEnabled ? 1 : 0.4)
            .contentShape(Rectangle())
    }

    private var foreground: Color {
        switch kind {
        case .primary: return Theme.acidInk
        case .secondary: return Theme.ink
        case .outline, .ghost: return Theme.paper
        case .danger: return Theme.signal
        }
    }
    private var border: Color {
        switch kind {
        case .primary: return .clear
        case .secondary: return .clear
        case .outline: return Theme.inkBorder
        case .danger: return Theme.signal.opacity(0.5)
        case .ghost: return .clear
        }
    }
    private func background(pressed: Bool) -> Color {
        switch kind {
        case .primary: return pressed ? Theme.paper : Theme.acid
        case .secondary: return pressed ? Theme.acid : Theme.paper
        case .outline: return pressed ? Theme.inkCard : .clear
        case .danger: return pressed ? Theme.signal.opacity(0.15) : .clear
        case .ghost: return .clear
        }
    }
}

extension ButtonStyle where Self == AppButtonStyle {
    static var appPrimary: AppButtonStyle { AppButtonStyle(kind: .primary) }
    static var appSecondary: AppButtonStyle { AppButtonStyle(kind: .secondary) }
    static var appOutline: AppButtonStyle { AppButtonStyle(kind: .outline) }
    static var appDanger: AppButtonStyle { AppButtonStyle(kind: .danger) }
    static var appGhost: AppButtonStyle { AppButtonStyle(kind: .ghost) }
    static func app(_ kind: AppButtonStyle.Kind, compact: Bool = false) -> AppButtonStyle { AppButtonStyle(kind: kind, compact: compact) }
}

/// A button that runs an async action, shows progress while it runs and can't
/// be tapped twice (the database is idempotent too, but a double tap shouldn't
/// even be possible).
struct AsyncButton<Label: View>: View {
    var kind: AppButtonStyle.Kind = .primary
    var compact = false
    let action: () async -> Void
    @ViewBuilder var label: () -> Label
    @State private var running = false

    var body: some View {
        Button {
            guard !running else { return }
            running = true
            Task {
                await action()
                running = false
            }
        } label: {
            HStack(spacing: 8) {
                if running { ProgressView().tint(kind == .primary ? Theme.acidInk : Theme.paper).controlSize(.small) }
                label()
            }
        }
        .buttonStyle(AppButtonStyle(kind: kind, compact: compact))
        .disabled(running)
    }
}
