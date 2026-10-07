import SwiftUI

/// The wordmark: SUPPORT/SLOT with the slash in acid.
struct Logo: View {
    var size: CGFloat = 22
    var body: some View {
        (Text("SUPPORT").foregroundColor(Theme.paper) + Text("/").foregroundColor(Theme.acid) + Text("SLOT").foregroundColor(Theme.paper))
            .font(Theme.display(size))
            .tracking(-0.5)
            .accessibilityLabel("Support Slot")
    }
}
