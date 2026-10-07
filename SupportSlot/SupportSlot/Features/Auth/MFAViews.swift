import SwiftUI

/// Every account must set up an authenticator app (TOTP). This screen shows the
/// QR code and checks the first code.
struct MFASetupView: View {
    @Environment(AppStore.self) private var store
    @State private var enrollment: TOTPEnrollment?
    @State private var loadError: String?
    @State private var code = ""
    @State private var verifyError: String?
    @State private var started = false
    @State private var copied = false

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Logo(size: 22)
                Button("Log out") { Task { await store.signOut() } }.font(Theme.mono(10)).textCase(.uppercase).foregroundStyle(Theme.paperDim)
                VStack(spacing: 10) {
                    Text("Set up two-factor authentication").font(Theme.display(24)).foregroundStyle(Theme.paper).multilineTextAlignment(.center)
                    Text("Every Support Slot account needs this — it protects your account even if your password is ever compromised. You’ll need an authenticator app (Google Authenticator, Authy, 1Password and so on).")
                        .dimBody(14).multilineTextAlignment(.center)
                }

                if let loadError {
                    VStack(spacing: 12) {
                        Banner(kind: .error, text: loadError)
                        Button("Try again") { Task { await begin() } }.buttonStyle(.appOutline)
                    }
                } else if let enrollment {
                    VStack(spacing: 18) {
                        QRCodeView(text: enrollment.otpauthURI)
                            .frame(width: 200, height: 200)
                            .padding(14)
                            .background(Theme.paper)
                        VStack(spacing: 6) {
                            Text("Can’t scan it? Enter this code in your app instead:").font(Theme.body(12)).foregroundStyle(Theme.paperDim)
                            Text(enrollment.secret).font(Theme.mono(13)).foregroundStyle(Theme.paper).textSelection(.enabled).multilineTextAlignment(.center)
                            Button(copied ? "Copied" : "Copy code") { UIPasteboard.general.string = enrollment.secret; copied = true }
                                .font(Theme.mono(11)).foregroundStyle(Theme.acid)
                        }
                        LabeledField(label: "6-digit code from your app", error: verifyError) {
                            TextField("123456", text: $code).keyboardType(.numberPad).textContentType(.oneTimeCode).fieldStyle(invalid: verifyError != nil)
                                .onChange(of: code) { _, new in code = String(new.filter(\.isNumber).prefix(6)) }
                        }
                        AsyncButton { await verify(enrollment) } label: { Text("Verify and continue") }
                            .disabled(code.count != 6)
                    }
                } else {
                    LoadingView(label: "Setting up…")
                }
            }
            .padding(24)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .task { await begin() }
    }

    private func begin() async {
        guard !started || loadError != nil else { return }
        started = true
        loadError = nil
        // An abandoned earlier attempt leaves an unverified factor; clear it before starting fresh.
        for f in store.session?.user.factors ?? [] where f.factorType == "totp" && f.status == "unverified" {
            await store.auth.unenroll(factorID: f.id)
        }
        do { enrollment = try await store.auth.enrollTOTP() }
        catch { loadError = (error as? AppError)?.message ?? "Couldn’t start two-factor setup — try again." }
    }

    private func verify(_ e: TOTPEnrollment) async {
        verifyError = nil
        do { try await store.auth.verifyTOTP(factorID: e.factorID, code: code) }
        catch { verifyError = (error as? AppError)?.message ?? "That code didn’t work."; code = "" }
    }
}

/// Asks for the current code from the authenticator app after logging in.
struct MFAChallengeView: View {
    @Environment(AppStore.self) private var store
    @State private var code = ""
    @State private var error: String?
    @State private var showHelp = false

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Logo(size: 22)
                Button("Log out") { Task { await store.signOut() } }.font(Theme.mono(10)).textCase(.uppercase).foregroundStyle(Theme.paperDim)
                Text("Enter your code").font(Theme.display(26)).foregroundStyle(Theme.paper)
                Text("Open your authenticator app and enter the 6-digit code for Support Slot.").dimBody(14).multilineTextAlignment(.center)
                LabeledField(label: "6-digit code", error: error) {
                    TextField("123456", text: $code).keyboardType(.numberPad).textContentType(.oneTimeCode).fieldStyle(invalid: error != nil)
                        .onChange(of: code) { _, new in
                            code = String(new.filter(\.isNumber).prefix(6))
                        }
                }
                AsyncButton { await verify() } label: { Text("Verify") }.disabled(code.count != 6)
                Button("Lost your phone?") { showHelp = true }.font(Theme.mono(11)).foregroundStyle(Theme.paperDim)
            }
            .padding(24)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .sheet(isPresented: $showHelp) { NavigationStack { SupportView() }.environment(store) }
    }

    private func verify() async {
        error = nil
        guard let factor = store.session?.user.verifiedTOTPFactorID else {
            error = "We couldn’t find your authenticator. Log out and back in."
            return
        }
        do { try await store.auth.verifyTOTP(factorID: factor, code: code) }
        catch { self.error = (error as? AppError)?.message ?? "That code didn’t work."; code = "" }
    }
}
