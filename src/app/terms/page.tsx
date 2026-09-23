import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-[760px] px-4 sm:px-6 lg:px-10 py-10 sm:py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">
        Legal
      </p>
      <h1 className="font-display uppercase text-4xl sm:text-5xl leading-[0.95] tracking-tight">
        Terms of Service
      </h1>
      <p className="mt-4 text-sm text-paper-dim">Last updated: 23 September 2026</p>

      <div className="mt-10 space-y-10 text-paper-dim [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-paper [&_h2]:mb-3 [&_p]:leading-relaxed [&_p+p]:mt-3 [&_li]:leading-relaxed [&_ul]:mt-3 [&_ul]:space-y-2 [&_ul]:list-disc [&_ul]:pl-5">
        <section>
          <h2>1. Agreement</h2>
          <p>
            By creating a Support Slot account or using the platform, you agree to these terms.
            If you don&rsquo;t agree, don&rsquo;t use Support Slot. See also our{" "}
            <Link href="/privacy" className="underline hover:text-acid">
              Privacy Policy
            </Link>
            , which explains how we handle your data.
          </p>
        </section>

        <section>
          <h2>2. What Support Slot is</h2>
          <p>
            Support Slot is a marketplace that connects artists with promoters and venues posting
            support-slot (opening act) opportunities. We provide the platform, matching, and
            payment facilitation — we&rsquo;re not a party to the performance itself, and
            we&rsquo;re not a talent agency, promoter, or venue.
          </p>
        </section>

        <section>
          <h2>3. Eligibility &amp; accounts</h2>
          <ul>
            <li>You must be at least 16 years old to use Support Slot.</li>
            <li>
              Each account is either an artist account or a promoter account, chosen at sign-up —
              a single account can&rsquo;t switch between roles.
            </li>
            <li>
              You&rsquo;re responsible for keeping your login details secure and for all activity
              under your account.
            </li>
            <li>Information you provide (profile details, listings, bookings) must be accurate.</li>
          </ul>
        </section>

        <section>
          <h2>4. No pay-to-play</h2>
          <p>
            Artists never pay a promoter, venue, or Support Slot for the opportunity to perform.
            Applying to a slot is always free. Anyone requesting payment from an artist to perform
            is breaking these terms — see our{" "}
            <Link href="/trust" className="underline hover:text-acid">
              Trust &amp; Safety policy
            </Link>{" "}
            for how to report it.
          </p>
        </section>

        <section>
          <h2>5. Applications, matching &amp; bookings</h2>
          <p>
            Match percentages shown on the platform are guidance based on genre, location and
            other factors — they&rsquo;re not a guarantee of being booked. A booking is only
            confirmed once a promoter completes payment through the platform; nothing is confirmed
            by a message, verbal agreement, or shortlisting alone.
          </p>
        </section>

        <section>
          <h2>6. Payments &amp; fees</h2>
          <p>
            Payments are processed by Stripe. When a promoter books an artist, they pay the
            artist&rsquo;s agreed fee, any travel contribution, and a separate Support Slot
            booking fee — the booking fee is always paid by the promoter, never deducted from the
            artist&rsquo;s fee. Payouts to artists are made to their own connected Stripe account;
            Support Slot doesn&rsquo;t hold your funds or handle cash.
          </p>
          <p>
            You&rsquo;re responsible for any taxes arising from fees you receive through the
            platform.
          </p>
        </section>

        <section>
          <h2>7. Cancellations &amp; rescheduling</h2>
          <p>
            Either party can cancel or propose a new date/time for a confirmed booking through the
            platform. Repeated late cancellations may affect your account standing and visibility
            in search results.
          </p>
        </section>

        <section>
          <h2>8. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Request or offer payment for a support slot (see §4)</li>
            <li>Post false, misleading, or impersonating information</li>
            <li>Harass, threaten, or discriminate against another user</li>
            <li>Attempt to circumvent the platform&rsquo;s payment system</li>
            <li>Use the platform for any unlawful purpose</li>
          </ul>
          <p>
            We may suspend or terminate accounts that break these terms, and you can report
            concerns about another user through our{" "}
            <Link href="/trust" className="underline hover:text-acid">
              Trust &amp; Safety
            </Link>{" "}
            tools.
          </p>
        </section>

        <section>
          <h2>9. Your content</h2>
          <p>
            You keep ownership of anything you upload (photos, bios, tracks, messages). By posting
            it on Support Slot, you give us a licence to display it on the platform for the
            purpose of operating the marketplace. Don&rsquo;t upload anything you don&rsquo;t have
            the rights to.
          </p>
        </section>

        <section>
          <h2>10. Disclaimers</h2>
          <p>
            Support Slot facilitates connections between artists and promoters but isn&rsquo;t
            responsible for the conduct of any user, the quality of a performance, or what happens
            at a venue. We provide the platform &ldquo;as is&rdquo; without warranties of any
            kind. Nothing in these terms limits liability that can&rsquo;t legally be limited
            (for example, for fraud or death or personal injury caused by our negligence).
          </p>
        </section>

        <section>
          <h2>11. Termination</h2>
          <p>
            You can stop using Support Slot at any time. We may suspend or close an account that
            breaches these terms, or to protect the platform or other users.
          </p>
        </section>

        <section>
          <h2>12. Changes to these terms</h2>
          <p>
            We&rsquo;ll update the &ldquo;last updated&rdquo; date above if these terms change,
            and post the new version here. Continuing to use Support Slot after a change means you
            accept the updated terms.
          </p>
        </section>

        <section>
          <h2>13. Governing law</h2>
          <p>
            These terms are governed by the laws of England and Wales, and any disputes will be
            handled by the courts of England and Wales.
          </p>
        </section>

        <section>
          <h2>14. Contact us</h2>
          <p>
            Questions about these terms — email{" "}
            <a href="mailto:hello@supportslot.example" className="underline hover:text-acid">
              hello@supportslot.example
            </a>
            .
          </p>
        </section>
      </div>

      <div className="mt-16 border-t border-ink-border pt-6">
        <Link
          href="/privacy"
          className="font-mono text-xs uppercase tracking-widest text-acid hover:underline"
        >
          Read our Privacy Policy →
        </Link>
      </div>
    </div>
  );
}
