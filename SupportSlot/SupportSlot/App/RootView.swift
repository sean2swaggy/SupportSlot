import SwiftUI

/// Chooses what to show from the app's state — the same order the website
/// used: signed out → set up the account → suspended → the app.
struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(PurchaseStore.self) private var purchases
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var showTour = false
    #if DEBUG
    @State private var previewBooking: Booking?
    @State private var previewSent = false
    @State private var previewAccepted = false
    #endif

    var body: some View {
        @Bindable var store = store
        ZStack {
            Theme.ink.ignoresSafeArea()
            switch store.phase {
            case .needsConfig: SetupRequiredView()
            case .launching: SplashView()
            case .signedOut: SignedOutFlow()
            case .onboarding: OnboardingView()
            case .suspended: SuspendedView()
            case .loadFailed(let error): LoadFailedView(error: error)
            case .ready: MainShell()
            }
        }
        .overlay {
            if store.showVerifiedThanks {
                VerifiedThanksView { withAnimation(.easeOut(duration: 0.3)) { store.showVerifiedThanks = false } }
                    .transition(.opacity)
            }
        }
        .id(typeSize) // fonts are sized from Dynamic Type when a view is built; rebuild if the setting changes
        .dynamicTypeSize(...DynamicTypeSize.accessibility2) // the largest sizes stop being usable in dense rows
        .preferredColorScheme(.dark)
        .tint(Theme.acid)
        .sheet(isPresented: Binding(get: { store.pendingPasswordReset && store.phase == .ready }, set: { if !$0 { store.pendingPasswordReset = false } })) {
            NavigationStack { SetNewPasswordView(fromEmailLink: true) }.environment(store).interactiveDismissDisabled()
        }
        .fullScreenCover(isPresented: $showTour) {
            WelcomeTourView(role: store.role) {
                if let uid = store.userId { TourSeen.markSeen(uid) }
                showTour = false
            }
            .preferredColorScheme(.dark)
        }
        .onChange(of: store.phase == .ready) { _, _ in offerTourIfNeeded() }
        .task(id: store.phase == .ready) { offerTourIfNeeded() }
        .onChange(of: store.showVerifiedThanks) { _, _ in offerTourIfNeeded() }
        .onOpenURL { url in Task { await store.handle(url: url) } }
        .task { await store.start() }
        .task(id: store.userId) { await purchases.setUser(store.userId.flatMap { UUID(uuidString: $0) }) }
        #if DEBUG
        .task { if CommandLine.arguments.contains("-previewVerifiedThanks") { store.showVerifiedThanks = true } } // lets the screen be looked at without signing up
        .task { if CommandLine.arguments.contains("-previewTour") { showTour = true } }
        .task {
            // Lets the "You're booked" screen be looked at without a real booking.
            if CommandLine.arguments.contains("-previewBooked") { previewBooking = PreviewData.booking }
        }
        .sheet(item: $previewBooking) { BookedCelebrationSheet(booking: $0) }
        .task { if CommandLine.arguments.contains("-previewAccepted") { previewAccepted = true } }
        .sheet(isPresented: $previewAccepted) {
            OfferAcceptedBanner(artistName: "The Artist").padding(20)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top).background(Theme.ink).presentationBackground(Theme.ink)
        }
        .task { if CommandLine.arguments.contains("-previewSent") { previewSent = true } }
        .sheet(isPresented: $previewSent) {
            VStack(spacing: 18) { SentAnimationView(); Text("Application sent.").font(Theme.display(28)).foregroundStyle(Theme.paper) }
                .frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.ink).presentationBackground(Theme.ink)
        }
        #endif
        .task(id: store.phase == .ready) {
            // Keep unread counts, applications and offers current without a manual refresh.
            guard store.phase == .ready else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 45_000_000_000)
                if Task.isCancelled { break }
                await store.refresh()
            }
        }
        .onChange(of: scenePhase) { _, new in
            if new == .active { Task { await store.refresh() } }
        }
    }
}

private extension RootView {
    /// The welcome tour: once per account, when the app is ready and the thank-you screen isn't up.
    func offerTourIfNeeded() {
        guard store.phase == .ready, !store.showVerifiedThanks, let uid = store.userId, !TourSeen.isSeen(uid) else { return }
        showTour = true
    }
}

struct SplashView: View {
    var body: some View {
        VStack(spacing: 18) {
            Logo(size: 30)
            ProgressView().tint(Theme.acid)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Loading Support Slot")
    }
}

/// The first load failed. A retry screen — never an empty dashboard.
struct LoadFailedView: View {
    @Environment(AppStore.self) private var store
    let error: AppError
    var body: some View {
        VStack(spacing: 18) {
            Logo(size: 24)
            ErrorState(error: error) { Task { await store.retry() } }
            LogOutButton { Text("Log out") }.buttonStyle(.app(.ghost))
        }
        .padding(24)
    }
}
