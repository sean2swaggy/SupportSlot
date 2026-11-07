import SwiftUI

/// A "Log out" control that asks "Are you sure?" first, so it can't be tapped by accident.
/// Style it from outside, e.g. `LogOutButton { Text("Log out") }.buttonStyle(.appOutline)`.
struct LogOutButton<Label: View>: View {
    @Environment(AppStore.self) private var store
    @State private var asking = false
    @ViewBuilder var label: Label

    var body: some View {
        Button { asking = true } label: { label }
            .alert("Log out?", isPresented: $asking) {
                Button("Log out", role: .destructive) { Task { await store.signOut() } }
                Button("Stay logged in", role: .cancel) {}
            } message: {
                Text("Are you sure? You’ll need your email and password to log back in.")
            }
    }
}
