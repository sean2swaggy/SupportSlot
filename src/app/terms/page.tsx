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
      <p className="mt-4 text-sm text-paper-dim">Last updated: 7 October 2026</p>

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
            support-slot (opening act) opportunities. We provide the platform and listing discovery — we&rsquo;re
            not a party to the performance or to any payment, and
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
          <h2>5. Applications, offers &amp; bookings</h2>
          <p>
            Where we show how a listing fits an artist&rsquo;s profile, it is information drawn from
            the profile and the listing — not a score, and not a guarantee or a ranking: promoters
            choose who to book. A promoter makes an offer; a booking is confirmed only when the
            artist accepts that offer through the platform. The terms of the offer (date, times,
            fee, travel contribution and fees) are fixed when it is made and shown to both sides.
            Nothing is confirmed by a message, a verbal agreement, or shortlisting alone. After the
            artist accepts, the promoter pays through the platform.
          </p>
        </section>

        <section>
          <h2>6. Payment</h2>
          <p>
            Support Slot doesn&rsquo;t take, hold or process payments, and isn&rsquo;t a bank or an
            escrow service. An offer records the fee and travel contribution the promoter has agreed
            to pay; once the artist accepts, the promoter is responsible for paying the artist
            directly, as agreed between them. Support Slot never takes a cut of an artist&rsquo;s
            fee and artists never pay to apply or perform. Any disagreement about payment is between
            the artist and the promoter, but you can report it to us and we may act on an account
            that breaks these terms.
          </p>
          <p>
            You&rsquo;re responsible for any taxes arising from fees you receive through the
            platform.
          </p>
        </section>

        <section>
          <h2>7. Cancellations &amp; rescheduling</h2>
          <p>
            Either party can cancel a confirmed booking through the platform, giving a reason; the
            other party is told straight away. Only the promoter can change the date or
            times of a show; if they do, the artist is told and can cancel. Repeated late
            cancellations may lead us to act on an account.
          </p>
        </section>

        <section>
          <h2>8. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Request or offer payment for a support slot (see §4)</li>
            <li>Post false, misleading, or impersonating information</li>
            <li>Harass, threaten, or discriminate against another user</li>
            <li>Misrepresent the fee or terms of an offer</li>
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
            Questions about these terms — contact us through our{" "}
            <Link href="/support" className="underline hover:text-acid">
              support page
            </Link>
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
