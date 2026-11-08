import Foundation
import Observation

/// The app's shared state: who is signed in, their profile and role, and the
/// data every signed-in screen needs. Sign-in is password-only (no second
/// factor), so the order here is: sign in → account status → set-up → the app.
/// Writes go through `perform`, which always
/// re-reads from the server afterwards (success or failure) so the screen shows
/// the truth rather than a guess. If the first load fails, `phase` is
/// `.loadFailed` (a retry screen) — never an empty dashboard.
enum AppTab: Hashable {
    case discover, applications, saved, messages, me          // artists (and visitors use .discover)
    case artists, myGigs, tools                                // promoters
}

@MainActor
@Observable
final class AppStore {
    enum Phase: Equatable {
        case needsConfig
        case launching
        case signedOut
        case suspended
        case onboarding
        case ready
        case loadFailed(AppError)
    }

    // Services (nil when the Supabase project isn't configured).
    private(set) var auth: AuthService!
    private(set) var db: Database!
    let isConfigured: Bool

    // Session and profile
    private(set) var session: AuthSession?
    private(set) var profile: Profile?
    /// Who the database says this session is (role, set-up done, suspended).
    private(set) var account: AccountStatus?
    /// The signed-in artist's own private, ~1 km-rounded position (nobody else can read it).
    private(set) var myCoordinate: Coordinate?
    private(set) var artist: Artist?
    private(set) var promoter: Promoter?

    // Signed-in data
    private(set) var applications: [Application] = []   // artist: own (with listings). promoter: received (with artists)
    private(set) var bookings: [Booking] = []
    private(set) var notifications: [AppNotification] = []
    private(set) var threads: [ChatThread] = []
    private(set) var savedSlotIDs: Set<ID> = []
    private(set) var myListings: [Slot] = []            // promoter only: own listings plus the team owner's
    private(set) var team: [TeamRow] = []               // promoter only: invitations and members
    private(set) var loadError: AppError?
    private(set) var hasLoadedOnce = false

    // In-app navigation (so a notification can open the right screen).
    var selectedTab: AppTab = .discover
    var presentedSlotID: ID?
    /// An application or a listing opened from a notification. Shown as a sheet by the main shell.
    var presentedApplicationID: ID?
    var presentedListingID: ID?
    var pendingThreadID: ID?

    /// A one-off message to show on the next screen (e.g. an email link that didn't work).
    var notice: String?
    /// Set when the person arrived through a password-reset email link.
    var pendingPasswordReset = false
    /// Set for a moment right after an email is confirmed, to show the thank-you screen.
    var showVerifiedThanks = false

    private var refreshing = false

    init(config: AppConfig? = AppConfig.load(), session urlSession: URLSession? = nil) {
        Self.clearKeychainOnFirstLaunch()
        guard let config else {
            isConfigured = false
            return
        }
        isConfigured = true
        let transport = Transport(config: config, session: urlSession)
        let auth = AuthService(transport: transport)
        self.auth = auth
        self.db = Database(transport: transport, auth: auth)
        self.session = auth.session
        auth.onChange = { [weak self] s in
            Task { @MainActor in self?.sessionChanged(s) }
        }
    }

    /// iOS keeps Keychain items across reinstalls; a fresh install must start signed out.
    private static func clearKeychainOnFirstLaunch() {
        let key = "hasLaunchedBefore"
        if !UserDefaults.standard.bool(forKey: key) {
            Keychain.remove("session")
            UserDefaults.standard.set(true, forKey: key)
        }
    }

    // MARK: - Derived state

    var phase: Phase {
        guard isConfigured else { return .needsConfig }
        guard let session else { return .signedOut }
        guard let account else { return loadError.map(Phase.loadFailed) ?? .launching }
        if account.suspended { return .suspended }
        if !account.hasOnboarded { return .onboarding }
        if hasLoadedOnce == false { return loadError.map(Phase.loadFailed) ?? .launching }
        return .ready
    }

    var userId: ID? { session?.user.id }

    // MARK: Teams
    /// The owners whose team I'm an active member of (at most one).
    var teamOwnerIds: [ID] { guard let uid = userId else { return [] }; return team.filter { $0.memberId == uid && $0.isActive }.map(\.promoterId) }
    var isTeamMember: Bool { !teamOwnerIds.isEmpty }
    var teamInvitesForMe: [TeamRow] { guard let uid = userId else { return [] }; return team.filter { $0.memberId == uid && !$0.isActive } }
    var myTeamRows: [TeamRow] { guard let uid = userId else { return [] }; return team.filter { $0.promoterId == uid } }
    /// Set when a team notification is tapped; the main screen shows the team page.
    var presentedTeam = false
    var role: UserRole { (profile?.userRole ?? account.flatMap { UserRole(rawValue: $0.role) }) ?? .artist }
    var isSignedIn: Bool { session != nil }
    var accountEmail: String? { session?.user.email ?? profile?.email }
    var adminRole: String? { profile?.adminRole ?? account?.adminRole }
    var unreadNotificationCount: Int { notifications.filter { !$0.read }.count }
    var unreadThreadCount: Int { threads.filter(\.unread).count }

    /// The artist/promoter's own display name.
    var displayName: String { artist?.name ?? promoter?.company ?? profile?.username ?? "" }
    var ownImage: String? { artist?.imageUrl ?? promoter?.avatarUrl }

    func booking(forApplication id: ID) -> Booking? {
        bookings.filter { $0.applicationId == id }.sorted { $0.offeredAt > $1.offeredAt }.first { $0.bookingStatus == .offered || $0.bookingStatus == .confirmed }
            ?? bookings.filter { $0.applicationId == id }.sorted { $0.offeredAt > $1.offeredAt }.first
    }

    func application(forSlot slotId: ID) -> Application? {
        applications.first { $0.slotId == slotId }
    }

    func isSaved(_ slotId: ID) -> Bool { savedSlotIDs.contains(slotId) }

    // MARK: - Session

    private func sessionChanged(_ new: AuthSession?) {
        let previousUser = session?.user.id
        session = new
        guard let new else {
            resetSignedInState()
            return
        }
        if previousUser != new.user.id {
            resetSignedInState()
            session = new
        }
        Task { await refresh() }
    }

    private func resetSignedInState() {
        profile = nil; account = nil; myCoordinate = nil
        artist = nil; promoter = nil
        applications = []; bookings = []; notifications = []; threads = []
        savedSlotIDs = []; myListings = []
        loadError = nil; hasLoadedOnce = false
        pendingPasswordReset = false
        showVerifiedThanks = false
    }

    func start() async {
        guard isConfigured, session != nil else { return }
        await refresh()
    }

    func signOut() async {
        await auth.signOut()
    }

    // MARK: - Loading

    /// Re-reads everything the signed-in screens show. Safe to call often.
    func refresh() async {
        guard isConfigured, let session, !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        let uid = session.user.id
        do {
            let status = try await db.accountStatus()
            account = status
            if status.suspended {
                // Everything else is refused for a suspended account; show the suspension screen.
                loadError = nil
                return
            }
            if !status.hasOnboarded {
                profile = nil
                loadError = nil
                return
            }
            await db.refreshExpiredOffers()
            let profile = try await loadProfile(uid)
            self.profile = profile
            let role = profile.userRole
            if role == .promoter, let rows = try? await db.teamOverview() { self.team = rows }
            let ownerIds = teamOwnerIds
            async let notifications = db.notifications(profileId: uid)
            async let saved = db.savedSlotIDs(profileId: uid)
            async let bookings = db.myBookings()
            async let threads = db.chatThreads(viewerRole: role, viewerId: uid, teamOwnerIds: ownerIds)

            switch role {
            case .artist:
                async let artist = db.artist(id: uid)
                async let apps = db.artistApplications(artistId: uid)
                async let coordinate = db.myCoordinate(artistId: uid)
                self.artist = try await artist
                self.applications = try await apps
                self.myCoordinate = try await coordinate
            case .promoter:
                async let promoter = db.promoter(id: uid)
                async let apps = db.promoterApplications()
                async let listings = db.promoterSlots(promoterIds: [uid] + ownerIds)
                self.promoter = try await promoter
                self.applications = try await apps
                self.myListings = try await listings
            }
            self.notifications = try await notifications
            self.savedSlotIDs = Set(try await saved)
            self.bookings = try await bookings
            self.threads = try await threads
            loadError = nil
            hasLoadedOnce = true
        } catch is CancellationError {
            return
        } catch let error as AppError {
            if error == .sessionExpired { await auth.signOut(); return }
            // Keep what we already have on screen; only the very first load is a hard failure.
            loadError = error
        } catch {
            loadError = AppError.generic()
        }
    }

    private func loadProfile(_ uid: ID) async throws -> Profile {
        if let p = try await db.profile(id: uid) { return p }
        // The sign-up trigger creates the row; if it isn't there yet give it a moment.
        try await Task.sleep(nanoseconds: 700_000_000)
        if let p = try await db.profile(id: uid) { return p }
        throw AppError("We couldn't find your account details. Please log out and back in.")
    }

    func retry() async {
        loadError = nil
        await refresh()
    }

    func refreshThreads() async {
        guard let uid = userId, isConfigured, profile?.hasOnboarded == true else { return }
        if let t = try? await db.chatThreads(viewerRole: role, viewerId: uid, teamOwnerIds: teamOwnerIds) { threads = t }
    }

    func refreshNotifications() async {
        guard let uid = userId else { return }
        if let n = try? await db.notifications(profileId: uid) { notifications = n }
    }

    // MARK: - Doing things

    /// Runs a write, then re-reads the server's state whether or not it worked
    /// (a failure often means the state moved under us — an offer expired, a
    /// slot filled — and the screen should show the truth).
    @discardableResult
    func perform<T>(_ work: () async throws -> T) async throws -> T {
        do {
            let result = try await work()
            await refresh()
            return result
        } catch {
            await refresh()
            throw (error as? AppError) ?? AppError.generic()
        }
    }

    func toggleSaved(_ slotId: ID) async throws {
        guard let uid = userId else { throw AppError.sessionExpired }
        let was = savedSlotIDs.contains(slotId)
        // Optimistic, rolled back if the server says no.
        if was { savedSlotIDs.remove(slotId) } else { savedSlotIDs.insert(slotId) }
        do {
            if was { try await db.unsaveSlot(profileId: uid, slotId: slotId) } else { try await db.saveSlot(profileId: uid, slotId: slotId) }
        } catch {
            if was { savedSlotIDs.insert(slotId) } else { savedSlotIDs.remove(slotId) }
            throw (error as? AppError) ?? AppError.generic()
        }
    }

    func markNotificationRead(_ n: AppNotification) async {
        guard !n.read else { return }
        try? await db.markNotificationRead(id: n.id)
        await refreshNotifications()
    }

    func markAllNotificationsRead() async {
        guard let uid = userId else { return }
        try? await db.markAllNotificationsRead(profileId: uid)
        await refreshNotifications()
    }

    // MARK: - Navigation

    /// Opens the screen a notification or link points at (`/applications`,
    /// `/messages?thread=…`, `/slot/…`).
    func open(href: String?) {
        guard let href, !href.isEmpty else { return }
        let path = href.split(separator: "?").first.map(String.init) ?? href
        if path.hasPrefix("/slot/") { presentedSlotID = String(path.dropFirst("/slot/".count)); return }
        if path == "/team" { presentedTeam = true; return }
        if path.hasPrefix("/application/") {
            let id = String(path.dropFirst("/application/".count))
            if role == .artist { presentedApplicationID = id } else { selectedTab = .myGigs }
            return
        }
        if path.hasPrefix("/listing/") {
            let id = String(path.dropFirst("/listing/".count))
            if role == .promoter { presentedListingID = id } else { selectedTab = .applications }
            return
        }
        if path.hasPrefix("/booking/") { selectedTab = role == .artist ? .applications : .myGigs; return }
        switch path {
        case "/applications": selectedTab = role == .artist ? .applications : .myGigs
        case "/dashboard/promoter": selectedTab = .myGigs
        case "/dashboard/promoter/requests": selectedTab = .tools
        case "/requests": selectedTab = .me
        case "/support": selectedTab = .me
        case "/messages":
            selectedTab = .messages
            if let q = href.split(separator: "?").dropFirst().first, q.hasPrefix("thread=") { pendingThreadID = String(q.dropFirst("thread=".count)) }
        default: break
        }
    }

    // MARK: - Email links

    func handle(url: URL) async {
        guard isConfigured else { return }
        switch await auth.handleCallback(url) {
        case .recovery: pendingPasswordReset = true
        case .signedIn: showVerifiedThanks = true
        case .failed(let message): notice = message
        case .notAuthLink: break
        }
    }
}
