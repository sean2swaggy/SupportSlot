import SwiftUI

@main
struct SupportSlotApp: App {
    @State private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            RootView().environment(store)
        }
    }
}
