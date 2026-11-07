# Phone-number sign-up (Supabase setup)

People can sign up and log in with **email** or with a **mobile number** (their choice, on the
sign-up screen). A phone sign-up is confirmed with a 6-digit code sent by text. Supabase has no
built-in text sender, so a provider has to be connected once.

## Connect a text provider (dashboard, once)
1. **Authentication → Sign In / Providers → Phone**, turn **Enable Phone provider** on.
2. Turn **Enable phone confirmations** on (so a code is required).
3. Choose an **SMS provider** (Twilio, MessageBird, Vonage or TextLocal) and type its credentials.
   Twilio needs an Account SID, Auth Token and a Message Service SID. Providers charge per text and
   a trial account usually only texts numbers you have verified with them.
4. Optional: set **SMS Message** to `Your Support Slot code: {{ .Code }}`, and **SMS OTP Expiry** to 300.
5. Save.

## Try it without sending any text (test numbers)
In the same Phone settings, under **Test Phone Numbers and OTPs**, add a pair such as
`447700900123=123456` (number written with the country code, no `+` or spaces) and choose an expiry
date. Signing up in the app with `07700 900123` then accepts the code `123456`, and nothing is sent.
Supabase still needs a provider selected, even for test numbers. Anyone who knows a test number and its
code can sign in as that account, so remove test numbers before launch.

## What the app does
- Numbers are turned into international form (`07700 900123` becomes `+447700900123`); UK is assumed
  when there is no country code.
- Log in with the number and password. If someone never confirmed, the app sends a fresh code.
- **Password reset by text is not built.** Phone accounts must contact support (the support form asks
  for an email to reply to).
- A phone account has no email address, so no emails are sent to it (notifications are in-app only).

## Database
Migration `0008` lets a profile have no email, makes the support form ask a phone-only account for a
reply-to address, and adds the phone number to "download my data".
