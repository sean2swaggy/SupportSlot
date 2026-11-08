import SwiftUI

/// A switch row where the whole row — the words as well as the switch — is the tap target.
/// (A plain `Toggle` outside a `Form` only reacts when the little switch itself is tapped.)
struct TapToggle<Label: View>: View {
    @Binding var isOn: Bool
    @ViewBuilder var label: () -> Label

    var body: some View {
        Button { isOn.toggle() } label: {
            HStack(alignment: .center, spacing: 14) {
                label().frame(maxWidth: .infinity, alignment: .leading)
                Toggle("", isOn: .constant(isOn)).labelsHidden().tint(Theme.acid)
                    .allowsHitTesting(false).accessibilityHidden(true)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isToggle)
        .accessibilityValue(isOn ? "On" : "Off")
    }
}
