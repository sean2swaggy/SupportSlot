import SwiftUI

/// Signed-out visitors: browse everything public, log in to do anything.
struct VisitorShell: View {
    @Environment(AppStore.self) private var store
    @State private var tab: Tab = .home
    enum Tab: Hashable { case home, discover, tonight, account }

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack {
                HomeView(onDiscover: { tab = .discover }, onTonight: { tab = .tonight }, onLogin: { tab = .account })
            }
            .tabItem { Label("Home", systemImage: "house") }.tag(Tab.home)

            NavigationStack { DiscoverView() }
                .tabItem { Label("Discover", systemImage: "magnifyingglass") }.tag(Tab.discover)

            NavigationStack { DiscoverView(urgentOnly: true) }
                .tabItem { Label("Tonight", systemImage: "bolt") }.tag(Tab.tonight)

            NavigationStack { AuthView() }
                .tabItem { Label("Log in", systemImage: "person") }.tag(Tab.account)
        }
        .toolbarBackground(Theme.ink, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
    }
}

/// Signed-in artists and promoters.
struct MainShell: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        VStack(spacing: 14) {
            Text("Signed in as \(store.role.title)").font(Theme.display(24)).foregroundStyle(Theme.paper)
            Button("Log out") { Task { await store.signOut() } }.buttonStyle(.appOutline)
        }
        .padding()
    }
}
