import SwiftUI

/// The bell in the navigation bar, with an unread badge.
struct NotificationsButton: View {
    @Environment(AppStore.self) private var store
    @State private var show = false

    var body: some View {
        Button { show = true } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "bell").font(.system(size: 18)).foregroundStyle(Theme.paper)
                if store.unreadNotificationCount > 0 {
                    Text(store.unreadNotificationCount > 9 ? "9+" : "\(store.unreadNotificationCount)")
                        .font(Theme.mono(9, weight: .bold)).foregroundStyle(Theme.acidInk)
                        .padding(.horizontal, 4).frame(minWidth: 16, minHeight: 16)
                        .background(Theme.acid).offset(x: 9, y: -7)
                }
            }
            .frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityLabel(store.unreadNotificationCount > 0 ? "Notifications, \(store.unreadNotificationCount) unread" : "Notifications")
        .sheet(isPresented: $show) { NavigationStack { NotificationsView() }.environment(store).presentationBackground(Theme.ink) }
    }
}

struct NotificationsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if store.notifications.isEmpty {
                    EmptyState(title: "Nothing yet", message: "Offers, application updates and messages show up here.").padding(20)
                } else {
                    ForEach(store.notifications) { n in
                        Button {
                            Task {
                                await store.markNotificationRead(n)
                                dismiss()
                                // Let this sheet finish closing first, or the next screen can fail to appear.
                                try? await Task.sleep(nanoseconds: 450_000_000)
                                store.open(href: n.href)
                            }
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: icon(n.type)).foregroundStyle(warn(n.type) ? Theme.signal : Theme.acid).frame(width: 24)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(n.text).font(Theme.body(15, weight: n.read ? .regular : .semibold)).foregroundStyle(n.read ? Theme.paperDim : Theme.paper).multilineTextAlignment(.leading)
                                    Text(UKDates.timeAgo(n.createdAt)).font(Theme.mono(10)).foregroundStyle(Theme.paperDim).textCase(.uppercase)
                                }
                                Spacer(minLength: 0)
                                if !n.read { Circle().fill(Theme.acid).frame(width: 8, height: 8).padding(.top, 6).accessibilityLabel("Unread") }
                            }
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        Divider1()
                    }
                }
            }
        }
        .screenBackground()
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } }
            ToolbarItem(placement: .topBarTrailing) {
                if store.unreadNotificationCount > 0 { Button("Mark all read") { Task { await store.markAllNotificationsRead() } } }
            }
        }
        .refreshable { await store.refreshNotifications() }
        .task { await store.refreshNotifications() }
    }

    private func icon(_ type: String) -> String {
        switch type {
        case "viewed": return "eye"
        case "shortlisted": return "star"
        case "urgent": return "bolt"
        case "booked", "offer_accepted": return "checkmark.circle"
        case "message": return "bubble.left"
        case "availability_request", "availability_response": return "calendar.badge.questionmark"
        case "offer": return "envelope.open"
        case "offer_declined", "application_declined", "application_withdrawn": return "circle"
        case "booking_cancelled": return "xmark.circle"
        case "listing_changed": return "arrow.triangle.2.circlepath"
        case "report_update": return "flag"
        case "review_received": return "star"
        case "saved_search": return "bell.badge"
        default: return "circle.fill"
        }
    }
    private func warn(_ type: String) -> Bool { type == "urgent" || type == "booking_cancelled" }
}
