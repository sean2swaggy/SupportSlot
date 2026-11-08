import SwiftUI

/// Apply to a listing: choose a track to feature and add a short note.
struct ApplySheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let slot: Slot
    var onApplied: () -> Void = {}

    @State private var trackId: ID?
    @State private var message = ""
    @State private var error: String?
    @State private var done = false

    private var tracks: [Track] { store.artist?.tracks ?? [] }
    static let messageLimit = 500

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if done {
                    SentAnimationView().frame(maxWidth: .infinity)
                    DisplayTitle("Application sent.", size: 28).frame(maxWidth: .infinity, alignment: .center).multilineTextAlignment(.center)
                    Text("The promoter sees your profile, your chosen song and your message. We’ll notify you when they respond.").dimBody().multilineTextAlignment(.center)
                    Button("Done") { dismiss() }.buttonStyle(.appPrimary)
                } else {
                    Eyebrow("Apply")
                    DisplayTitle("Apply for \(slot.headliner)", size: 26)
                    Text("The promoter sees your profile, your chosen song and this message.").dimBody(14)

                    if tracks.isEmpty {
                        Banner(kind: .info, text: "You haven’t added any tracks yet. You can still apply — add tracks in your profile to feature one next time.")
                    } else {
                        LabeledField(label: "Feature a track") {
                            VStack(spacing: 0) {
                                ForEach(tracks) { t in
                                    Button { trackId = t.id } label: {
                                        HStack {
                                            Image(systemName: trackId == t.id ? "largecircle.fill.circle" : "circle").foregroundStyle(trackId == t.id ? Theme.acid : Theme.paperDim)
                                            Text(t.title).foregroundStyle(Theme.paper)
                                            Spacer()
                                            Text(t.duration).font(Theme.mono(12)).foregroundStyle(Theme.paperDim)
                                        }
                                        .padding(.horizontal, 14).frame(minHeight: 50)
                                        .background(trackId == t.id ? Theme.acid.opacity(0.06) : .clear)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityAddTraits(trackId == t.id ? .isSelected : [])
                                    if t.id != tracks.last?.id { Divider1() }
                                }
                            }
                            .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
                        }
                    }

                    LabeledField(label: "Optional short message", hint: "\(message.count)/\(Self.messageLimit)") {
                        TextArea(text: $message, placeholder: "Tell them why you’re a good fit for this show…", minHeight: 110)
                            .onChange(of: message) { _, new in if new.count > Self.messageLimit { message = String(new.prefix(Self.messageLimit)) } }
                    }
                    if let error { Banner(kind: .error, text: error) }
                    AsyncButton { await submit() } label: { Text("Submit application") }
                    Text("No application fees. Ever.").font(Theme.mono(10)).foregroundStyle(Theme.paperDim).textCase(.uppercase).frame(maxWidth: .infinity)
                }
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarLeading) { if !done { Button("Cancel") { dismiss() } } } }
        .onAppear { if trackId == nil { trackId = tracks.first?.id } }
    }

    private func submit() async {
        error = nil
        guard let artistId = store.userId else { error = AppError.sessionExpired.message; return }
        do {
            try await store.perform { try await store.db.apply(slotId: slot.id, artistId: artistId, featuredTrackId: trackId, message: message) }
            done = true
            onApplied()
        } catch { self.error = (error as? AppError)?.message ?? "We couldn’t submit your application." }
    }
}
