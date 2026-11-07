import SwiftUI

/// Contact support — works signed in or out (someone locked out can't be asked
/// to log in first).
struct SupportView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var topic = "account"
    @State private var message = ""
    @State private var email = ""
    @State private var sent = false
    @State private var error: String?

    private let topics = [("account", "My account"), ("booking", "A booking or listing"), ("bug", "Something isn’t working"), ("other", "Something else")]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if sent {
                    Eyebrow("Help", color: Theme.ok)
                    DisplayTitle("Request received", size: 28)
                    Text(store.isSignedIn && store.hasEmail ? "We’ll reply to the email on your account." : "We’ll reply to \(email).").dimBody()
                    Button("Done") { dismiss() }.buttonStyle(.appPrimary)
                } else {
                    Eyebrow("Help")
                    DisplayTitle("Contact support", size: 28)
                    Text("Tell us what’s wrong and we’ll reply by email. For a problem with a specific listing or person, use Report on that listing or conversation instead.").dimBody(14)
                    LabeledField(label: "What’s it about?") {
                        Menu {
                            Picker("Topic", selection: $topic) { ForEach(topics, id: \.0) { Text($0.1).tag($0.0) } }
                        } label: {
                            HStack { Text(topics.first { $0.0 == topic }?.1 ?? ""); Spacer(); Image(systemName: "chevron.up.chevron.down").foregroundStyle(Theme.paperDim) }
                                .foregroundStyle(Theme.paper).fieldStyle()
                        }
                    }
                    if !store.isSignedIn || !store.hasEmail {
                        LabeledField(label: "Your email", hint: "So we can reply.") { TextField("you@email.com", text: $email).emailField().fieldStyle() }
                    }
                    LabeledField(label: "Message", hint: "\(message.count)/4000") { TextArea(text: $message, placeholder: "What happened?", minHeight: 140) }
                    if let error { Banner(kind: .error, text: error) }
                    AsyncButton { await send() } label: { Text("Send") }
                }
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } } }
    }

    private func send() async {
        error = nil
        if message.trimmingCharacters(in: .whitespacesAndNewlines).count < 10 { error = "Please tell us a little more (at least 10 characters)."; return }
        if !store.isSignedIn || !store.hasEmail, !EmailRules.isValid(email) { error = "Enter an email address we can reply to."; return }
        do {
            try await store.db.submitSupportRequest(topic: topic, message: message, email: store.isSignedIn && store.hasEmail ? nil : email.trimmingCharacters(in: .whitespaces))
            sent = true
        } catch { self.error = (error as? AppError)?.message ?? "We couldn’t send that. Please try again." }
    }
}
