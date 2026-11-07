import SwiftUI

/// Moderation and support tools for Support Slot staff. Moderators handle
/// reports, support requests, listings and users; only admins see the bookings
/// list and can set verification. Every action is checked and audited in the
/// database.
struct StaffView: View {
    @Environment(AppStore.self) private var store
    @State private var tab: Tab = .reports
    enum Tab: String, CaseIterable, Identifiable {
        case reports = "Reports", support = "Support", users = "Users", listings = "Listings", bookings = "Bookings", audit = "Audit"
        var id: String { rawValue }
    }

    private var tabs: [Tab] { Tab.allCases.filter { $0 != .bookings || store.profile?.isAdmin == true } }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow("Staff · \(store.adminRole ?? "")")
                DisplayTitle("Admin", size: 30)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) { ForEach(tabs) { t in
                        Button { tab = t } label: {
                            Text(t.rawValue.uppercased()).font(Theme.mono(11)).tracking(1).foregroundStyle(tab == t ? Theme.acidInk : Theme.paper).padding(.horizontal, 12).frame(minHeight: 38)
                                .background(tab == t ? Theme.acid : .clear).overlay(Rectangle().stroke(tab == t ? Theme.acid : Theme.inkBorder, lineWidth: 1))
                        }.buttonStyle(.plain).accessibilityAddTraits(tab == t ? .isSelected : [])
                    } }
                }
            }
            .padding(20)
            Group {
                switch tab {
                case .reports: StaffReportsTab()
                case .support: StaffSupportTab()
                case .users: StaffUsersTab(isAdmin: store.profile?.isAdmin == true)
                case .listings: StaffListingsTab()
                case .bookings: StaffBookingsTab()
                case .audit: StaffAuditTab()
                }
            }
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Loads a list once, shows loading / error / empty states, and reloads on demand.
private struct StaffList<Item: Identifiable, Row: View>: View {
    let load: () async throws -> [Item]
    var emptyText = "Nothing here."
    var reloadKey: String = ""
    @ViewBuilder var row: (Item, @escaping () async -> Void) -> Row
    @State private var items: [Item] = []
    @State private var state: StaffState = .loading
    enum StaffState { case loading, loaded, failed(AppError) }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                switch state {
                case .loading where items.isEmpty: LoadingView()
                case .failed(let e): ErrorState(error: e) { Task { await reload() } }
                default:
                    if items.isEmpty { EmptyState(title: emptyText) }
                    ForEach(items) { item in row(item) { await reload() } }
                }
            }
            .padding(.horizontal, 20).padding(.bottom, 30)
        }
        .refreshable { await reload() }
        .task(id: reloadKey) { await reload() }
    }

    private func reload() async {
        do { items = try await load(); state = .loaded }
        catch is CancellationError {}
        catch { if items.isEmpty { state = .failed((error as? AppError) ?? .generic()) } else { state = .loaded } }
    }
}

private struct StaffCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading).background(Theme.inkCard).overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
    }
}

private struct StaffReportsTab: View {
    @Environment(AppStore.self) private var store
    @State private var status = "open"
    @State private var error: String?
    var body: some View {
        VStack(spacing: 8) {
            Picker("Status", selection: $status) { Text("Open").tag("open"); Text("Reviewing").tag("reviewing") }.pickerStyle(.segmented).padding(.horizontal, 20)
            if let error { Banner(kind: .error, text: error).padding(.horizontal, 20) }
            StaffList(load: { try await store.db.staffReports(status: status) }, emptyText: "No \(status) reports.", reloadKey: status) { (r: StaffReport, reload: @escaping () async -> Void) in
                StaffCard {
                    HStack { Tag(r.contextType); Spacer(); Text(UKDates.timeAgo(r.createdAt)).font(Theme.mono(10)).foregroundStyle(Theme.paperDim) }
                    Text(r.reason).font(Theme.body(15)).foregroundStyle(Theme.paper)
                    Text("From \(r.reporterLabel ?? "unknown") about \(r.reportedLabel ?? "—")").font(Theme.body(12)).foregroundStyle(Theme.paperDim)
                    FlowLayout(spacing: 8) {
                        if r.status == "open" { act("Reviewing", .outline, r, "reviewing", reload) }
                        act("Actioned", .primary, r, "actioned", reload)
                        act("Dismiss", .outline, r, "dismissed", reload)
                    }
                }
            }
        }
    }
    private func act(_ title: String, _ kind: AppButtonStyle.Kind, _ r: StaffReport, _ status: String, _ reload: @escaping () async -> Void) -> some View {
        AsyncButton(kind: kind, compact: true) {
            do { try await store.db.updateReport(id: r.id, status: status, note: nil); error = nil; await reload() }
            catch { self.error = (error as? AppError)?.message ?? "That didn’t work." }
        } label: { Text(title) }.frame(width: 130)
    }
}

private struct StaffSupportTab: View {
    @Environment(AppStore.self) private var store
    @State private var error: String?
    var body: some View {
        VStack(spacing: 8) {
            if let error { Banner(kind: .error, text: error).padding(.horizontal, 20) }
            StaffList(load: { try await store.db.staffSupportRequests(status: "open") }, emptyText: "No open support requests.") { (s: StaffSupportRequest, reload: @escaping () async -> Void) in
                StaffCard {
                    HStack { Tag(s.topic); Spacer(); Text(UKDates.timeAgo(s.createdAt)).font(Theme.mono(10)).foregroundStyle(Theme.paperDim) }
                    Text(s.message).font(Theme.body(15)).foregroundStyle(Theme.paper)
                    Text(s.email).font(Theme.mono(12)).foregroundStyle(Theme.acid).textSelection(.enabled)
                    AsyncButton(compact: true) {
                        do { try await store.db.updateSupportRequest(id: s.id, status: "answered", note: nil); error = nil; await reload() }
                        catch { self.error = (error as? AppError)?.message ?? "That didn’t work." }
                    } label: { Text("Mark answered") }.frame(width: 190)
                }
            }
        }
    }
}

private struct StaffUsersTab: View {
    @Environment(AppStore.self) private var store
    let isAdmin: Bool
    @State private var query = ""
    @State private var submitted = ""
    @State private var suspending: StaffUser?
    @State private var error: String?
    var body: some View {
        VStack(spacing: 8) {
            HStack { Image(systemName: "magnifyingglass").foregroundStyle(Theme.paperDim); TextField("Search email, username or id", text: $query).textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.search).onSubmit { submitted = query } }
                .fieldStyle().padding(.horizontal, 20)
            if let error { Banner(kind: .error, text: error).padding(.horizontal, 20) }
            StaffList(load: { try await store.db.staffUsers(query: submitted) }, emptyText: "No users found.", reloadKey: submitted) { (u: StaffUser, reload: @escaping () async -> Void) in
                StaffCard {
                    HStack { Text(u.email).font(Theme.body(15, weight: .semibold)).foregroundStyle(Theme.paper); Spacer(); Tag(u.role); if u.adminRole != nil { Tag(u.adminRole!, tint: Theme.acid) } }
                    Text("@\(u.username ?? "—") · joined \(UKDates.timeAgo(u.createdAt))").font(Theme.body(12)).foregroundStyle(Theme.paperDim)
                    if let when = u.suspendedAt { Text("Suspended \(UKDates.timeAgo(when)): \(u.suspensionReason ?? "")").font(Theme.body(13)).foregroundStyle(Theme.signal) }
                    FlowLayout(spacing: 8) {
                        if u.suspendedAt != nil {
                            AsyncButton(kind: .outline, compact: true) { await run { try await store.db.unsuspendUser(id: u.id) }; await reload() } label: { Text("Unsuspend") }.frame(width: 150)
                        } else if u.adminRole == nil {
                            Button("Suspend…") { suspending = u }.buttonStyle(.app(.danger, compact: true)).frame(width: 150)
                        }
                        if isAdmin {
                            AsyncButton(kind: .outline, compact: true) { await run { try await store.db.setVerification(profileId: u.id, verified: true) } } label: { Text("Mark verified") }.frame(width: 170)
                            AsyncButton(kind: .outline, compact: true) { await run { try await store.db.setVerification(profileId: u.id, verified: false) } } label: { Text("Remove verified") }.frame(width: 190)
                        }
                    }
                }
            }
        }
        .sheet(item: $suspending) { u in
            ReasonSheet(title: "Suspend this account?", message: "They can’t apply, post or message while suspended, and are told why.", confirmLabel: "Suspend", requireReason: true) { reason in
                do { try await store.db.suspendUser(id: u.id, reason: reason); submitted = submitted + " "; submitted = submitted.trimmingCharacters(in: .whitespaces); return nil }
                catch { return (error as? AppError)?.message ?? "That didn’t work." }
            }
        }
    }
    private func run(_ work: () async throws -> Void) async {
        do { try await work(); error = nil } catch { self.error = (error as? AppError)?.message ?? "That didn’t work." }
    }
}

private struct StaffListingsTab: View {
    @Environment(AppStore.self) private var store
    @State private var query = ""
    @State private var submitted = ""
    @State private var removing: StaffSlot?
    var body: some View {
        VStack(spacing: 8) {
            HStack { Image(systemName: "magnifyingglass").foregroundStyle(Theme.paperDim); TextField("Search headliner or promoter", text: $query).autocorrectionDisabled().submitLabel(.search).onSubmit { submitted = query } }.fieldStyle().padding(.horizontal, 20)
            StaffList(load: { try await store.db.staffListings(query: submitted) }, emptyText: "No listings found.", reloadKey: submitted) { (s: StaffSlot, reload: @escaping () async -> Void) in
                StaffCard {
                    HStack { Text(s.headliner).font(Theme.body(15, weight: .semibold)).foregroundStyle(Theme.paper); Spacer(); Tag(s.status) }
                    Text("\(s.promoterCompany) · \(s.city) · \(UKDates.formatShowDate(s.date, withYear: true)) · \(s.applicantCount) applicants").font(Theme.body(12)).foregroundStyle(Theme.paperDim)
                    if s.status != "cancelled" { Button("Remove listing…") { removing = s }.buttonStyle(.app(.danger, compact: true)).frame(width: 200) }
                }
            }
        }
        .sheet(item: $removing) { s in
            ReasonSheet(title: "Remove this listing?", message: "Applicants are told it was cancelled and the promoter is told why. A confirmed booking is cancelled.", confirmLabel: "Remove listing", requireReason: true) { reason in
                do { try await store.db.removeListing(id: s.id, reason: reason); submitted = submitted + " "; submitted = submitted.trimmingCharacters(in: .whitespaces); return nil }
                catch { return (error as? AppError)?.message ?? "That didn’t work." }
            }
        }
    }
}

private struct StaffBookingsTab: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        VStack(spacing: 8) {
            Text("Admin only. The agreed terms of recent bookings. Support Slot doesn’t handle payment, so there is no payment status here.").dimBody(12).padding(.horizontal, 20)
            StaffList(load: { try await store.db.staffBookings() }, emptyText: "No bookings yet.") { (b: StaffBooking, _: @escaping () async -> Void) in
                StaffCard {
                    HStack { Text(b.headliner).font(Theme.body(15, weight: .semibold)).foregroundStyle(Theme.paper); Spacer(); Tag(b.status) }
                    Text("\(b.artistName) · \(b.promoterCompany)").font(Theme.body(13)).foregroundStyle(Theme.paperDim)
                    Text("\(UKDates.formatShowDate(b.eventDate, withYear: true)) · fee \(Money.pence(b.feePence)) · travel \(Money.pence(b.travelPence))").font(Theme.mono(11)).foregroundStyle(Theme.paper)
                }
            }
        }
    }
}

private struct StaffAuditTab: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        StaffList(load: { try await store.db.staffAudit() }, emptyText: "No audit entries yet.") { (a: AuditEntry, _: @escaping () async -> Void) in
            StaffCard {
                HStack { Text(a.action).font(Theme.mono(13, weight: .semibold)).foregroundStyle(Theme.acid); Spacer(); Text(UKDates.timeAgo(a.createdAt)).font(Theme.mono(10)).foregroundStyle(Theme.paperDim) }
                Text("\(a.actorRole) · \(a.targetType) \(a.targetId ?? "")").font(Theme.body(12)).foregroundStyle(Theme.paperDim)
            }
        }
    }
}
