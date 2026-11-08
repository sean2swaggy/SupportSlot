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
    @Environment(PurchaseStore.self) private var purchases

    var body: some View {
        @Bindable var store = store
        TabView(selection: $store.selectedTab) {
            if store.role == .artist {
                NavigationStack { DiscoverView() }
                    .tabItem { Label("Discover", systemImage: "magnifyingglass") }.tag(AppTab.discover)
                NavigationStack { ApplicationsView() }
                    .tabItem { Label("Applications", systemImage: "doc.text") }.tag(AppTab.applications)
                NavigationStack { SavedView() }
                    .tabItem { Label("Saved", systemImage: "bookmark") }.tag(AppTab.saved)
                MessagesView()
                    .tabItem { Label("Messages", systemImage: "bubble.left") }.tag(AppTab.messages).badge(store.unreadThreadCount)
                NavigationStack { MeView() }
                    .tabItem { Label("Profile", systemImage: "person") }.tag(AppTab.me)
            } else {
                NavigationStack { DiscoverArtistsView() }
                    .tabItem { Label("Artists", systemImage: "music.mic") }.tag(AppTab.artists)
                NavigationStack { MyGigsView() }
                    .tabItem { Label("My gigs", systemImage: "calendar") }.tag(AppTab.myGigs)
                MessagesView()
                    .tabItem { Label("Messages", systemImage: "bubble.left") }.tag(AppTab.messages).badge(store.unreadThreadCount)
                NavigationStack { ToolsView() }
                    .tabItem { Label("Tools", systemImage: "square.grid.2x2") }.tag(AppTab.tools)
                NavigationStack { MeView() }
                    .tabItem { Label("Account", systemImage: "person") }.tag(AppTab.me)
            }
        }
        .toolbarBackground(Theme.ink, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        .onAppear { store.selectedTab = store.role == .artist ? .discover : .myGigs }
        .sheet(item: Binding(get: { store.presentedSlotID.map(SlotRoute.init) }, set: { store.presentedSlotID = $0?.id })) { route in
            NavigationStack { SlotDetailView(slotId: route.id) }.environment(store).environment(purchases).presentationBackground(Theme.ink)
        }
        .sheet(isPresented: Binding(get: { store.presentedTeam }, set: { store.presentedTeam = $0 })) {
            NavigationStack {
                TeamView().toolbar { ToolbarItem(placement: .topBarLeading) { Button("Close") { store.presentedTeam = false } } }
            }
            .environment(store).environment(purchases).presentationBackground(Theme.ink)
        }
        .sheet(item: Binding(get: { store.presentedApplicationID.map(SlotRoute.init) }, set: { store.presentedApplicationID = $0?.id })) { route in
            NavigationStack {
                ApplicationDetailView(applicationId: route.id)
                    .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Close") { store.presentedApplicationID = nil } } }
            }
            .environment(store).environment(purchases).presentationBackground(Theme.ink)
        }
        .sheet(item: Binding(get: { store.presentedListingID.map(SlotRoute.init) }, set: { store.presentedListingID = $0?.id })) { route in
            NavigationStack {
                ApplicantsView(slotId: route.id)
                    .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Close") { store.presentedListingID = nil } } }
            }
            .environment(store).environment(purchases).presentationBackground(Theme.ink)
        }
    }
}

struct SlotRoute: Identifiable { let id: ID }
