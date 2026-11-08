import Foundation

/// The wording of the Terms, Privacy Policy and Trust & Safety policy.
/// This text has not been reviewed by a lawyer.
struct LegalSection: Identifiable {
    let heading: String
    /// Paragraphs; a line starting with "• " is a bullet.
    let paragraphs: [String]
    var id: String { heading }
}

struct LegalDocument {
    let title: String
    let eyebrow: String
    let updated: String?
    let intro: String?
    let sections: [LegalSection]
}

enum LegalContent {
    static let updated = "Last updated: 7 October 2026"

    static let terms = LegalDocument(
        title: "Terms of Service", eyebrow: "Legal", updated: updated, intro: nil,
        sections: [
            LegalSection(heading: "1. Agreement", paragraphs: [
                "By creating a Support Slot account or using the app, you agree to these terms. If you don’t agree, don’t use Support Slot. See also our Privacy Policy, which explains how we handle your data.",
            ]),
            LegalSection(heading: "2. What Support Slot is", paragraphs: [
                "Support Slot is a marketplace that connects artists with promoters and venues posting support-slot (opening act) opportunities. We provide the app and listing discovery — we’re not a party to the performance or to any payment, and we’re not a talent agency, promoter, or venue.",
            ]),
            LegalSection(heading: "3. Eligibility & accounts", paragraphs: [
                "• You must be at least 16 years old to use Support Slot.",
                "• Each account is either an artist account or a promoter account, chosen at sign-up — a single account can’t switch between roles.",
                "• You’re responsible for keeping your login details secure and for all activity under your account.",
                "• Information you provide (profile details, listings, bookings) must be accurate.",
            ]),
            LegalSection(heading: "4. No pay-to-play", paragraphs: [
                "Artists never pay a promoter, venue, or Support Slot for the opportunity to perform. Applying to a slot is always free. Anyone requesting payment from an artist to perform is breaking these terms — see our Trust & Safety policy for how to report it.",
            ]),
            LegalSection(heading: "5. Applications, offers & bookings", paragraphs: [
                "Where we show how a listing fits an artist’s profile, it is information drawn from the profile and the listing — not a score, and not a guarantee or a ranking: promoters choose who to book. A promoter makes an offer; a booking is confirmed only when the artist accepts that offer in the app. The terms of the offer (date, times, fee and travel contribution) are fixed when it is made and shown to both sides. Nothing is confirmed by a message, a verbal agreement, or shortlisting alone. After the artist accepts, the promoter and artist arrange payment directly (see section 6).",
            ]),
            LegalSection(heading: "6. Payment", paragraphs: [
                "Support Slot doesn’t take, hold or process payments, and isn’t a bank or an escrow service. An offer records the fee and travel contribution the promoter has agreed to pay; once the artist accepts, the promoter is responsible for paying the artist directly, as agreed between them. Support Slot never takes a cut of an artist’s fee and artists never pay to apply or perform. Any disagreement about payment is between the artist and the promoter, but you can report it to us and we may act on an account that breaks these terms.",
                "You’re responsible for any taxes arising from fees you receive through Support Slot.",
            ]),
            LegalSection(heading: "6A. Optional purchases", paragraphs: [
                "Support Slot is free to use. We also sell two optional extras through Apple’s in-app purchase: a one-time Gig diary for artists (a private log of your own shows), and a monthly or yearly Team plan for promoters (unlimited open listings and the private promoter tools). A free promoter account can have one open listing at a time.",
                "Purchases are paid to Apple, not to us, and are subject to Apple’s terms. Subscriptions renew automatically until you cancel in your Apple ID settings, at least 24 hours before the period ends. You can restore earlier purchases from the purchase screen. Refunds are handled by Apple.",
                "Nothing you can buy gives anyone a better chance of being booked, any ranking, or any extra visibility. Artists never pay to apply, be booked or be seen.",
            ]),
            LegalSection(heading: "7. Cancellations & rescheduling", paragraphs: [
                "Either party can cancel a confirmed booking in the app, giving a reason; the other party is told straight away. Only the promoter can change the date or times of a show; if they do, the artist is told and can cancel. Repeated late cancellations may lead us to act on an account.",
            ]),
            LegalSection(heading: "8. Acceptable use", paragraphs: [
                "You agree not to:",
                "• Request or offer payment for a support slot (see section 4)",
                "• Post false, misleading, or impersonating information",
                "• Harass, threaten, or discriminate against another user",
                "• Misrepresent the fee or terms of an offer",
                "• Use the app for any unlawful purpose",
                "We may suspend or terminate accounts that break these terms, and you can report concerns about another user through our Trust & Safety tools.",
            ]),
            LegalSection(heading: "9. Your content", paragraphs: [
                "You keep ownership of anything you upload (photos, bios, tracks, messages). By posting it on Support Slot, you give us a licence to display it in the app for the purpose of operating the marketplace. Don’t upload anything you don’t have the rights to.",
            ]),
            LegalSection(heading: "10. Disclaimers", paragraphs: [
                "Support Slot facilitates connections between artists and promoters but isn’t responsible for the conduct of any user, the quality of a performance, or what happens at a venue. We provide the app “as is” without warranties of any kind. Nothing in these terms limits liability that can’t legally be limited (for example, for fraud or death or personal injury caused by our negligence).",
            ]),
            LegalSection(heading: "11. Termination", paragraphs: [
                "You can stop using Support Slot at any time. We may suspend or close an account that breaches these terms, or to protect the app or other users.",
            ]),
            LegalSection(heading: "12. Changes to these terms", paragraphs: [
                "We’ll update the “last updated” date above if these terms change, and post the new version here. Continuing to use Support Slot after a change means you accept the updated terms.",
            ]),
            LegalSection(heading: "13. Governing law", paragraphs: [
                "These terms are governed by the laws of England and Wales, and any disputes will be handled by the courts of England and Wales.",
            ]),
            LegalSection(heading: "14. Contact us", paragraphs: [
                "Questions about these terms — contact us through Help & support.",
            ]),
        ])

    static let privacy = LegalDocument(
        title: "Privacy Policy", eyebrow: "Legal", updated: updated, intro: nil,
        sections: [
            LegalSection(heading: "1. Who we are", paragraphs: [
                "Support Slot (“we”, “us”) operates the Support Slot marketplace, connecting musicians (“artists”) with promoters and venues posting support-slot opportunities. This policy explains what personal data we collect, why, and what rights you have over it. We’re the data controller for the personal data described below.",
            ]),
            LegalSection(heading: "2. What we collect", paragraphs: [
                "• Account data. Your email address and password (handled entirely by our authentication provider, Supabase — we never see or store your password ourselves).",
                "• Profile data. Depending on your role: your artist/band or company name, city, bio, genres, profile photo, and any platform links you add (Spotify, Instagram, TikTok, SoundCloud, Bandcamp, YouTube, website). For artists, a self-reported monthly listener count.",
                "• Age check. During sign-up we ask for your date of birth to confirm you’re 16 or over. This check happens on your device and your date of birth is never sent to or stored on our servers.",
                "• Activity data. Slots you post or apply to, application messages, booking status, and messages you send to other users through the app.",
                "• Payments. Support Slot doesn’t take payments between promoters and artists. An offer records the fee and travel the promoter agreed to pay; the promoter pays the artist directly. Optional in-app purchases are processed by Apple, so we never see or store your card or bank details; the purchase is tied to your account on your device.",
                "• Reports and support requests. If you report something or contact support, we keep what you send and the details needed to follow it up, and our staff see it. Staff actions on accounts are recorded in an audit log.",
                "• Technical data. Standard request logs (e.g. IP address) from our infrastructure providers, and a sign-in token stored securely on your device so you stay signed in.",
            ]),
            LegalSection(heading: "3. How we use it", paragraphs: [
                "• To create and run your account",
                "• To operate the marketplace — listings, applications, offers, bookings, messaging",
                "• To show you notifications about applications, bookings and messages in the app",
                "• To investigate reports made under our Trust & Safety policies",
                "• To meet our legal and regulatory obligations",
            ]),
            LegalSection(heading: "4. Who we share it with", paragraphs: [
                "Supabase, our database and authentication infrastructure provider, which stores your account and profile data on our behalf.",
                "Other users see only what your role’s public profile is designed to show (e.g. an artist’s public profile, or a promoter’s posted slots) — we don’t sell your personal data to anyone, and we don’t use third-party advertising or analytics trackers.",
            ]),
            LegalSection(heading: "5. Where it’s processed", paragraphs: [
                "Our infrastructure providers may process data outside the UK/EEA. Where that happens, it’s covered by appropriate safeguards required under UK GDPR, such as standard contractual clauses.",
            ]),
            LegalSection(heading: "6. How long we keep it", paragraphs: [
                "We keep your account and activity data for as long as your account is active. You can download a copy of your data, and delete your account, yourself from Settings. Deleting removes your profile, messages and saved gigs and withdraws anything still open. We keep records of past bookings (the agreed terms and the names shown at the time) so the other person’s history stays accurate, but they are no longer linked to your account. An account can’t be deleted while there is an upcoming confirmed booking.",
            ]),
            LegalSection(heading: "7. Storage on your device", paragraphs: [
                "The app stores one sign-in token in your device’s secure Keychain so you stay signed in. We don’t use advertising, marketing, or third-party tracking of any kind.",
            ]),
            LegalSection(heading: "8. Your rights", paragraphs: [
                "Under UK GDPR, you have the right to:",
                "• Access the personal data we hold about you",
                "• Correct inaccurate data",
                "• Request deletion of your data",
                "• Restrict or object to certain processing",
                "• Receive your data in a portable format",
                "• Complain to the Information Commissioner’s Office (ICO)",
            ]),
            LegalSection(heading: "9. Children", paragraphs: [
                "Support Slot is for users aged 16 and over. We don’t knowingly collect personal data from anyone under 16.",
            ]),
            LegalSection(heading: "10. Changes to this policy", paragraphs: [
                "We’ll update the “last updated” date above if this policy changes, and post the new version here.",
            ]),
            LegalSection(heading: "11. Contact us", paragraphs: [
                "Questions about this policy or your data — contact us through Help & support.",
            ]),
        ])

    static let trust = LegalDocument(
        title: "No pay-to-play. Ever.", eyebrow: "Trust & safety", updated: nil,
        intro: "Support Slot exists to get artists in front of the right audiences — never to charge them for the opportunity. Here’s exactly how we protect that.",
        sections: [
            LegalSection(heading: "01  No pay-to-play", paragraphs: ["Artists never pay a promoter, venue or Support Slot for the privilege of performing. Anyone requesting payment to perform is breaking our terms — report them immediately."]),
            LegalSection(heading: "02  No application fees", paragraphs: ["Applying to a support slot is always free, no matter how many shows you apply to."]),
            LegalSection(heading: "03  Transparent compensation", paragraphs: ["Every listing shows the support fee and travel contribution up front, before you apply. What you see is what you’re offered."]),
            LegalSection(heading: "04  Verification badges", paragraphs: ["A badge means our team has checked a promoter or artist. Not everyone has one yet, and the absence of a badge doesn’t mean anything is wrong."]),
            LegalSection(heading: "05  Clear terms", paragraphs: ["Every offer shows its terms up front and they’re fixed once it’s made: the fee and travel the promoter has agreed to pay. The promoter pays the artist directly — Support Slot doesn’t take, hold or process payment."]),
            LegalSection(heading: "06  Cancellation policy", paragraphs: ["Either side can cancel a confirmed booking, giving a reason; the other side is told straight away. Repeated late cancellations may lead us to act on an account."]),
            LegalSection(heading: "See something wrong?", paragraphs: [
                "Report a listing that asks an artist to pay, misrepresents a show, or breaks any of the policies above. Artists can also block a promoter from a conversation.",
                "Use Report on a listing, in a conversation, or on an availability request. Reports go to our team and you get a reference when it’s received. Artists can also block a promoter from a conversation, which stops them messaging or inviting you.",
                "Locked out, or something to raise that isn’t about one listing or person? Use Help & support.",
            ]),
        ])
}
