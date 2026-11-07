import SwiftUI
import CoreImage.CIFilterBuiltins

struct PasswordStrengthMeter: View {
    let password: String
    var body: some View {
        if password.isEmpty { EmptyView() } else {
            let s = PasswordRules.evaluate(password)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    ForEach(0..<4, id: \.self) { i in
                        Rectangle().fill(i < s.score ? color(s.score) : Theme.inkBorder).frame(height: 4)
                    }
                }
                Text(s.label.rawValue).font(Theme.mono(10)).foregroundStyle(color(s.score)).textCase(.uppercase)
                ForEach(s.blockingIssues, id: \.self) { Text($0).font(Theme.body(12)).foregroundStyle(Theme.paperDim) }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Password strength: \(s.label.rawValue)")
        }
    }
    private func color(_ score: Int) -> Color { score <= 1 ? Theme.signal : score == 2 ? Theme.paperDim : Theme.ok }
}

struct CheckboxRow<Label: View>: View {
    @Binding var isOn: Bool
    @ViewBuilder var label: Label
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button { isOn.toggle() } label: {
                ZStack {
                    Rectangle().stroke(isOn ? Theme.acid : Theme.inkBorder, lineWidth: 1).frame(width: 24, height: 24)
                    if isOn { Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.acid) }
                }
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Agree")
            .accessibilityValue(isOn ? "checked" : "unchecked")
            label.font(Theme.body(14)).foregroundStyle(Theme.paperDim).padding(.top, 10)
        }
    }
}

extension View {
    func emailField() -> some View {
        self.keyboardType(.emailAddress).textContentType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
    }
}
