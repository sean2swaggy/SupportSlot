import SwiftUI

@main
struct SupportSlotApp: App {
    @State private var store = AppStore()
    @State private var purchases = PurchaseStore()
    @State private var showSplash = true

    var body: some Scene {
        WindowGroup {
            ZStack {
                RootView().environment(store).environment(purchases)
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
