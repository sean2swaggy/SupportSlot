import SwiftUI

struct ForgotPasswordView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var email: String
    @State private var sent = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if sent {
                    Eyebrow("Email sent")
                    DisplayTitle("Check your inbox", size: 28)
                    Text("If there’s an account for \(email), we’ve sent a link to reset your password. Open it on this phone.").dimBody()
                    Button("Done") { dismiss() }.buttonStyle(.appPrimary)
                } else {
                    Eyebrow("Account")
                    DisplayTitle("Reset your password", size: 28)
                    Text("Enter your email and we’ll send you a link to choose a new password.").dimBody()
                    LabeledField(label: "Email") { TextField("you@email.com", text: $email).emailField().fieldStyle() }
                    if let error { Banner(kind: .error, text: error) }
                    AsyncButton { await send() } label: { Text("Send reset link") }
                }
            }
            .padding(24)
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } } }
    }

    private func send() async {
        error = nil
        let address = email.trimmingCharacters(in: .whitespaces)
        guard EmailRules.isValid(address) else { error = "Enter a valid email address."; return }
        do { try await store.auth.sendPasswordReset(email: address); sent = true }
        catch { self.error = (error as? AppError)?.message ?? "Couldn't send that email." }
    }
}

/// Choose a new password after following the emailed link (or from Settings).
struct SetNewPasswordView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var fromEmailLink = false
    @State private var password = ""
    @State private var confirm = ""
    @State private var error: String?
    @State private var done = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if done {
                    Eyebrow("Done")
                    DisplayTitle("Password changed", size: 28)
                    Text("Your password has been updated.").dimBody()
                    Button("Continue") { store.pendingPasswordReset = false; dismiss() }.buttonStyle(.appPrimary)
                } else {
                    Eyebrow("Account")
                    DisplayTitle("Choose a new password", size: 28)
                    LabeledField(label: "New password") {
                        SecureField("••••••••", text: $password).textContentType(.newPassword).fieldStyle()
                        PasswordStrengthMeter(password: password)
                    }
                    LabeledField(label: "Confirm password") {
                        SecureField("••••••••", text: $confirm).textContentType(.newPassword).fieldStyle(invalid: !confirm.isEmpty && confirm != password)
                    }
                    if let error { Banner(kind: .error, text: error) }
                    AsyncButton { await save() } label: { Text("Save password") }
                }
            }
            .padding(24)
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { if !fromEmailLink { ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } } } }
    }

    private func save() async {
        error = nil
        guard PasswordRules.evaluate(password).isAcceptable else { error = "Choose a stronger password."; return }
        guard password == confirm else { error = "The two passwords don’t match."; return }
        do { try await store.auth.updatePassword(password); done = true }
        catch { self.error = (error as? AppError)?.message ?? "Couldn't change your password." }
    }
}
