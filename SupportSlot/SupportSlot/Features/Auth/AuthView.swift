import SwiftUI

/// Log in and sign up on one screen (the role is chosen once, at sign-up).
struct AuthView: View {
    enum Mode { case login, signup }

    @Environment(AppStore.self) private var store
    @State var mode: Mode
    var onBack: (() -> Void)?
    @State private var role: UserRole = .artist
    @State private var email = ""
    @State private var password = ""
    @State private var agreed = false
    @State private var error: String?
    @State private var alreadyRegistered = false
    @State private var awaitingConfirmation = false
    @State private var showForgot = false
    @State private var legal: LegalPage?
    @State private var resendNote: String?
    @State private var code = ""
    @State private var verifying = false
    @State private var cooldown = 0
    @FocusState private var focus: Field?
    private enum Field { case email, password, code }

    init(mode: Mode = .login, onBack: (() -> Void)? = nil) {
        _mode = State(initialValue: mode)
        self.onBack = onBack
    }

    private var address: String { email.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if let onBack, !awaitingConfirmation {
                    Button { onBack() } label: { Label("Back", systemImage: "chevron.left") }
                        .font(Theme.mono(12)).foregroundStyle(Theme.paperDim)
                        .frame(minHeight: 44, alignment: .leading)
                }
                Logo(size: 24).frame(maxWidth: .infinity)
                if awaitingConfirmation { confirmation } else { form }
            }
            .padding(24)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .sheet(isPresented: $showForgot) { NavigationStack { ForgotPasswordView(email: email) }.environment(store) }
        .sheet(item: $legal) { page in NavigationStack { LegalView(document: page.document).navigationTitle(page.label) }.presentationBackground(Theme.ink) }
        .onChange(of: mode) { _, _ in error = nil; alreadyRegistered = false }
        .task(id: cooldown > 0) {
            // Counts the resend cooldown down once a second.
            while cooldown > 0, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if !Task.isCancelled { cooldown = max(0, cooldown - 1) }
            }
        }
    }

    // MARK: Form

    private var form: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(mode == .login ? "Welcome back." : "Find your next stage.")
                .font(Theme.display(28)).foregroundStyle(Theme.paper).frame(maxWidth: .infinity, alignment: .center)

            if let notice = store.notice {
                Banner(kind: .info, text: notice).onTapGesture { store.notice = nil }
            }

            modePicker

            if mode == .signup {
                HStack(spacing: 10) {
                    roleButton(.artist, "I’m an artist")
                    roleButton(.promoter, "I’m a promoter")
                }
            }

            LabeledField(label: "Email") {
                TextField("you@email.com", text: $email).emailField().focused($focus, equals: .email)
                    .submitLabel(.next).onSubmit { focus = .password }.fieldStyle()
            }
            LabeledField(label: "Password") {
                SecureField("••••••••", text: $password)
                    .textContentType(mode == .signup ? .newPassword : .password)
                    .focused($focus, equals: .password).submitLabel(.go).onSubmit { Task { await submit() } }.fieldStyle()
                if mode == .signup { PasswordStrengthMeter(password: password) }
            }

            if mode == .signup {
                CheckboxRow(isOn: $agreed) {
                    (Text("I agree to the ") + Text("Terms").underline() + Text(" and ") + Text("Privacy Policy").underline() +
                     Text(", and understand there’s ") + Text("no pay-to-play").underline() + Text(" on Support Slot."))
                }
                HStack(spacing: 16) {
                    Button("Terms") { legal = .terms }
                    Button("Privacy") { legal = .privacy }
                    Button("No pay-to-play") { legal = .trust }
                }
                .font(Theme.mono(11)).foregroundStyle(Theme.paperDim)
            }

            if let error {
                VStack(alignment: .leading, spacing: 10) {
                    Banner(kind: .error, text: error)
                    if alreadyRegistered {
                        Button("Log in instead") { mode = .login }.buttonStyle(.app(.outline, compact: true))
                    }
                }
            }

            AsyncButton(kind: .primary) { await submit() } label: {
                Text(mode == .login ? "Log in" : "Create account")
            }

            if mode == .login {
                Button("Forgot your password?") { showForgot = true }
                    .buttonStyle(.app(.outline, compact: true)).frame(maxWidth: .infinity)
            }
        }
    }

    private var modePicker: some View {
        HStack(spacing: 0) {
            modeTab("Log in", .login)
            Rectangle().fill(Theme.inkBorder).frame(width: 1)
            modeTab("Sign up", .signup)
        }
        .frame(height: 46)
        .overlay(Rectangle().stroke(Theme.inkBorder, lineWidth: 1))
    }

    private func modeTab(_ title: String, _ m: Mode) -> some View {
        Button { mode = m } label: {
            Text(title.uppercased()).font(Theme.mono(12)).tracking(1.4)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .foregroundStyle(mode == m ? Theme.ink : Theme.paperDim)
                .background(mode == m ? Theme.paper : .clear)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(mode == m ? .isSelected : [])
    }

    private func roleButton(_ r: UserRole, _ title: String) -> some View {
        Button { role = r } label: {
            Text(title.uppercased()).font(Theme.mono(11)).tracking(1)
                .frame(maxWidth: .infinity, minHeight: 48)
                .foregroundStyle(role == r ? Theme.acid : Theme.paperDim)
                .overlay(Rectangle().stroke(role == r ? Theme.acid : Theme.inkBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(role == r ? .isSelected : [])
    }

    /// How many digits the confirmation email's code has. This must match Supabase →
    /// Authentication → Sign In / Providers → Email → "Email OTP Length" (currently 8).
    /// The app submits by itself when this many digits are typed; "Confirm" accepts 6–10.
    static let emailCodeLength = 8

    // MARK: Awaiting confirmation (emailed code)

    private var confirmation: some View {
        VStack(spacing: 18) {
            Image(systemName: "envelope.badge").font(.system(size: 34)).foregroundStyle(Theme.acid).accessibilityHidden(true)
            Text("Enter your code").font(Theme.display(26)).foregroundStyle(Theme.paper)
            Text("We emailed a \(Self.emailCodeLength)-digit code to \(address). It can take a minute to arrive, and it may land in spam.")
                .dimBody().multilineTextAlignment(.center)
            TextField(String(repeating: "0", count: Self.emailCodeLength), text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(Theme.mono(34, weight: .bold)).tracking(8)
                .multilineTextAlignment(.center)
                .focused($focus, equals: .code)
                .fieldStyle(invalid: error != nil)
                .accessibilityLabel("\(Self.emailCodeLength)-digit confirmation code")
                .onChange(of: code) { _, new in
                    let digits = String(new.filter(\.isNumber).prefix(10))
                    if digits != new { code = digits }
                    if digits.count == Self.emailCodeLength { Task { await verify() } }
                }
            if let resendNote { Banner(kind: .success, text: resendNote) }
            if let error { Banner(kind: .error, text: error) }
            AsyncButton(kind: .primary) { await verify() } label: { Text("Confirm email") }
            Button(cooldown > 0 ? "Send a new code in \(cooldown)s" : "Send a new code") { Task { await resend() } }
                .buttonStyle(.app(.outline, compact: true)).disabled(cooldown > 0)
            Text("You can also open the link in the email on this phone.").font(Theme.body(13)).foregroundStyle(Theme.paperDim).multilineTextAlignment(.center)
            Button("Use a different email") { awaitingConfirmation = false; code = ""; error = nil; resendNote = nil; mode = .signup }
                .buttonStyle(.app(.ghost))
        }
        .padding(.top, 20)
        .onAppear { focus = .code }
    }

    private func verify() async {
        guard !verifying else { return }
        error = nil
        let digits = code.filter(\.isNumber)
        guard digits.count >= 6 else { error = "Enter the code from the email."; return }
        verifying = true
        defer { verifying = false }
        do {
            try await store.auth.verifyEmailCode(email: address, code: digits)
            // Signed in: say thank you, then the app moves on by itself.
            store.showVerifiedThanks = true
        } catch {
            self.error = (error as? AppError)?.message ?? "That code didn’t work. Please try again."
            code = ""
            focus = .code
        }
    }

    private func resend() async {
        error = nil
        do {
            try await store.auth.resendConfirmation(email: address)
            resendNote = "New code sent. Use the latest email."
            cooldown = 30
        } catch {
            resendNote = nil
            self.error = (error as? AppError)?.message ?? "Couldn’t send a new code."
        }
    }

    // MARK: Submit

    private func submit() async {
        error = nil
        alreadyRegistered = false
        let address = email.trimmingCharacters(in: .whitespaces)
        guard EmailRules.isValid(address) else { error = "Enter a valid email address."; return }
        guard !password.isEmpty else { error = "Enter your password."; return }
        if mode == .signup {
            guard agreed else { error = "You need to agree to the Terms and Privacy Policy to continue."; return }
            guard PasswordRules.evaluate(password).isAcceptable else { error = "Choose a stronger password before continuing."; return }
        }
        do {
            if mode == .signup {
                switch try await store.auth.signUp(email: address, password: password, role: role.rawValue) {
                case .signedIn: break // the app moves on by itself
                case .confirmationRequired: code = ""; cooldown = 30; awaitingConfirmation = true
                case .alreadyRegistered: error = "An account with this email already exists."; alreadyRegistered = true
                }
            } else {
                try await store.auth.signIn(email: address, password: password)
            }
        } catch {
            if (error as? AppError)?.code == "email_not_confirmed" {
                // Signed up earlier but never confirmed: go straight to the code screen and send a fresh code.
                code = ""; awaitingConfirmation = true
                await resend()
                return
            }
            if (error as? AppError)?.code == "user_already_exists" || (error as? AppError)?.code == "email_exists" { alreadyRegistered = true }
            self.error = (error as? AppError)?.message ?? "Something went wrong. Please try again."
        }
    }
}
