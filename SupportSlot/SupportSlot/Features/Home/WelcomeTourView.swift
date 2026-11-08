import SwiftUI

/// Three quick screens shown once, the first time someone reaches the app after setting up.
struct WelcomeTourView: View {
    let role: UserRole
    let onDone: () -> Void
    @State private var page = 0

    private struct Page { let icon: String; let title: String; let body: String }
    private var pages: [Page] {
        role == .artist ? [
            Page(icon: "magnifyingglass", title: "Find slots that fit", body: "Browse real support slots near you. Each one says why it suits your genre, location and size."),
            Page(icon: "paperplane", title: "Apply in seconds", body: "Send a short note with your profile. Promoters shortlist, then send an offer with the terms locked in."),
            Page(icon: "checkmark.seal", title: "Play the show", body: "Confirmed gigs go in your calendar with reminders. You’re paid directly by the promoter — we never take a cut."),
        ] : [
            Page(icon: "plus.square.on.square", title: "Post a slot", body: "Add your venue and show details. Nothing is public until you publish, and your first open listing is free."),
            Page(icon: "person.2", title: "Review artists", body: "Shortlist applicants, message them, or invite artists from the Artists tab."),
            Page(icon: "calendar", title: "Book and plan", body: "Send an offer, then use Tools for your roster, show schedules and a bookings export. You pay the artist directly."),
        ]
    }

    var body: some View {
        VStack(spacing: 28) {
            Spacer(minLength: 20)
            TabView(selection: $page) {
                ForEach(Array(pages.enumerated()), id: \.offset) { i, p in
                    VStack(spacing: 18) {
                        Image(systemName: p.icon).font(.system(size: 40)).foregroundStyle(Theme.acid)
                            .frame(width: 88, height: 88).overlay(Rectangle().stroke(Theme.acid, lineWidth: 1)).accessibilityHidden(true)
                        Text(p.title).font(Theme.display(28)).foregroundStyle(Theme.paper).multilineTextAlignment(.center)
                        Text(p.body).dimBody().multilineTextAlignment(.center)
                    }
                    .padding(.horizontal, 28).tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .frame(maxHeight: 360)
            HStack(spacing: 12) {
                if page < pages.count - 1 {
                    Button("Skip") { onDone() }.buttonStyle(.appOutline)
                    Button("Next") { withAnimation { page += 1 } }.buttonStyle(.appPrimary)
                } else {
                    Button("Get started") { onDone() }.buttonStyle(.appPrimary)
                }
            }
            .padding(.horizontal, 24)
            Spacer(minLength: 20)
        }
        .screenBackground()
    }
}

enum TourSeen {
    private static func key(_ uid: String) -> String { "tourSeen.\(uid)" }
    static func isSeen(_ uid: String) -> Bool { UserDefaults.standard.bool(forKey: key(uid)) }
    static func markSeen(_ uid: String) { UserDefaults.standard.set(true, forKey: key(uid)) }
}
