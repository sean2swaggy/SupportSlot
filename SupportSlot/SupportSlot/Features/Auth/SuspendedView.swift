import SwiftUI

struct SuspendedView: View {
    @Environment(AppStore.self) private var store
    @State private var showSupport = false
    @State private var legal: LegalPage?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Logo(size: 22).frame(maxWidth: .infinity)
                Eyebrow("Account", color: Theme.signal)
                DisplayTitle("This account is suspended", size: 30)
                Text("You can’t apply, post or message while an account is suspended. Anything you had in progress was left as it was.").dimBody()
                if let reason = store.profile?.suspensionReason, !reason.isEmpty {
                    Card(accent: Theme.signal.opacity(0.5)) {
                        VStack(alignment: .leading, spacing: 6) { MonoLabel("Reason given"); Text(reason).font(Theme.body(15)).foregroundStyle(Theme.paper) }
                    }
                }
                Text("If you think this is a mistake, contact support and we’ll look into it.").dimBody()
                Button("Contact support") { showSupport = true }.buttonStyle(.appPrimary)
                HStack(spacing: 16) {
                    ForEach(LegalPage.allCases) { p in Button(p.label) { legal = p }.font(Theme.mono(11)).foregroundStyle(Theme.paperDim) }
                }
                Button("Log out") { Task { await store.signOut() } }.buttonStyle(.appOutline)
            }
            .padding(24)
        }
        .screenBackground()
        .sheet(isPresented: $showSupport) { NavigationStack { SupportView() }.environment(store) }
        .sheet(item: $legal) { page in NavigationStack { LegalView(document: page.document).navigationTitle(page.label) }.presentationBackground(Theme.ink) }
    }
}
