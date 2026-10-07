import SwiftUI

/// Shown when the build has no Supabase project configured.
struct SetupRequiredView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Logo(size: 26)
                Eyebrow("Setup needed")
                DisplayTitle("Connect a database", size: 30)
                Text("This copy of the app doesn’t know which Supabase project to use, so it can’t load anything yet.").dimBody()
                Card {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Fix it in three steps").font(Theme.display(17)).foregroundStyle(Theme.paper)
                        step(1, "Create a Supabase project and run supabase/migrations/0001 and 0002 in its SQL editor.")
                        step(2, "Put its URL and anon key in .env.local, then run node scripts/make-app-config.mjs.")
                        step(3, "Build and run the app again.")
                    }
                }
            }
            .padding(24)
        }
        .screenBackground()
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)").font(Theme.mono(12, weight: .bold)).foregroundStyle(Theme.acid).frame(width: 18)
            Text(text).dimBody(14)
        }
    }
}
