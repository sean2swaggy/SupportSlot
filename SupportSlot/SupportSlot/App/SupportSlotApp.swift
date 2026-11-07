import SwiftUI

@main
struct SupportSlotApp: App {
    @State private var store = AppStore()
    @State private var showSplash = true

    var body: some Scene {
        WindowGroup {
            ZStack {
                RootView().environment(store)
                if showSplash {
                    LaunchAnimationView {
                        withAnimation(.easeOut(duration: 0.3)) { showSplash = false }
                    }
                    .transition(.opacity)
                    .zIndex(1)
                }
            }
        }
    }
}
