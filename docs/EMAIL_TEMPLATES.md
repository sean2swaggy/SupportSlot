# Email templates (Supabase)

The app confirms new accounts with a **6-digit code typed into the app** (works on any device),
and still accepts the confirmation link as a fallback. Supabase only puts a code in the email if
the template contains `{{ .Token }}`.

## One-time setup (Supabase dashboard)
1. **Authentication → Emails → Templates → Confirm signup** (in older dashboards: Authentication → Email Templates).
2. Subject: `Your Support Slot code: {{ .Token }}`
3. Body: paste the whole of `supabase/email-templates/confirm-signup.html`, then Save.
4. **Authentication → Providers → Email**: keep **Confirm email** ON. Leave the email OTP length at 6
   (the app auto-submits at 6 digits) and the expiry at 3600 seconds or less.

## Notes
- Supabase's built-in email sender is rate-limited (a few emails an hour) and for testing only. Before real
  users, set up custom SMTP (Authentication → Emails → SMTP Settings).
- The password-reset email still uses a link (`supportslot://auth-callback`); only sign-up uses a code.
- Tested in the app: code verification and error handling in unit tests (`AuthServiceTests`). Not tested live
  against Supabase: the email arriving and the code being accepted.
