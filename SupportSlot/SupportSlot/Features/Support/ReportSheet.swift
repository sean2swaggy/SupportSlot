import SwiftUI

/// Report a listing, profile, message or booking to the Support Slot team.
struct ReportSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let contextType: String
    var contextId: ID?
    var reportedProfileId: ID?
    var subject: String

    @State private var reason = ""
    @State private var error: String?
    @State private var reference: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let reference {
                    Eyebrow("Reported", color: Theme.ok)
                    DisplayTitle("Thanks — we’ve got it", size: 28)
                    Text("Our team will review your report. Your reference is \(reference).").dimBody()
                    Button("Done") { dismiss() }.buttonStyle(.appPrimary)
                } else {
                    Eyebrow("Trust & safety")
                    DisplayTitle("Report", size: 28)
                    Text("Tell us what’s wrong with “\(subject)”. Report anything that asks an artist to pay, misrepresents a show, or breaks our policies.").dimBody(14)
                    LabeledField(label: "What happened?", hint: "\(reason.count)/1000") {
                        TextArea(text: $reason, placeholder: "Describe the problem (at least 10 characters)", minHeight: 140)
                    }
                    if let error { Banner(kind: .error, text: error) }
                    AsyncButton { await submit() } label: { Text("Send report") }
                }
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarLeading) { if reference == nil { Button("Cancel") { dismiss() } } } }
    }

    private func submit() async {
        error = nil
        let text = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.count < 10 { error = "Please describe what happened (at least 10 characters)."; return }
        if text.count > 1000 { error = "Please keep your report under 1,000 characters."; return }
        do {
            let id = try await store.db.submitReport(contextType: contextType, contextId: contextId, reportedProfileId: reportedProfileId, reason: text)
            reference = String(id.prefix(8)).uppercased()
        } catch { self.error = (error as? AppError)?.message ?? "We couldn’t send that report. Please try again." }
    }
}
