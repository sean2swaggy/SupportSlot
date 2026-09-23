import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-[760px] px-4 sm:px-6 lg:px-10 py-10 sm:py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">
        Legal
      </p>
      <h1 className="font-display uppercase text-4xl sm:text-5xl leading-[0.95] tracking-tight">
        Privacy Policy
      </h1>
      <p className="mt-4 text-sm text-paper-dim">Last updated: 23 September 2026</p>

      <div className="mt-10 space-y-10 text-paper-dim [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-paper [&_h2]:mb-3 [&_p]:leading-relaxed [&_p+p]:mt-3 [&_li]:leading-relaxed [&_ul]:mt-3 [&_ul]:space-y-2 [&_ul]:list-disc [&_ul]:pl-5">
        <section>
          <h2>1. Who we are</h2>
          <p>
            Support Slot (&ldquo;we&rdquo;, &ldquo;us&rdquo;) operates the Support Slot
            marketplace, connecting musicians (&ldquo;artists&rdquo;) with promoters and venues
            posting support-slot opportunities. This policy explains what personal data we
            collect, why, and what rights you have over it. We&rsquo;re the data controller for
            the personal data described below.
          </p>
        </section>

        <section>
          <h2>2. What we collect</h2>
          <p>
            <span className="text-paper">Account data.</span> Your email address and password
            (handled entirely by our authentication provider, Supabase — we never see or store
            your password ourselves).
          </p>
          <p>
            <span className="text-paper">Profile data.</span> Depending on your role: your
            artist/band or company name, city, bio, genres, profile photo, and any platform links
            you add (Spotify, Instagram, TikTok, SoundCloud, Bandcamp, YouTube, website). For
            artists, a self-reported monthly listener count.
          </p>
          <p>
            <span className="text-paper">Age check.</span> During sign-up we ask for your date of
            birth to confirm you&rsquo;re 16 or over. This check happens in your browser and your
            date of birth is never sent to or stored on our servers.
          </p>
          <p>
            <span className="text-paper">Activity data.</span> Slots you post or apply to,
            application messages, booking status, and messages you send to other users through the
            platform.
          </p>
          <p>
            <span className="text-paper">Payment &amp; payout data.</span> Card payments are
            entered directly into Stripe&rsquo;s own secure payment form — our servers never see
            or store your full card number. For artists receiving payouts, identity verification
            and bank account details are collected directly by Stripe as part of onboarding a
            Stripe Connect account; we only store a reference to that Stripe account and whether
            it&rsquo;s able to receive payouts, not the underlying documents or bank details
            themselves.
          </p>
          <p>
            <span className="text-paper">Technical data.</span> Standard request logs (e.g. IP
            address) from our hosting and infrastructure providers, and a session cookie used only
            to keep you signed in.
          </p>
        </section>

        <section>
          <h2>3. How we use it</h2>
          <ul>
            <li>To create and run your account, and gate the platform behind sign-up</li>
            <li>To operate the marketplace — matching, applications, bookings, messaging</li>
            <li>To process payments and payouts through Stripe when a booking is confirmed</li>
            <li>To send you notifications about applications, bookings, and messages</li>
            <li>To investigate reports made under our Trust &amp; Safety policies</li>
            <li>To meet our legal and regulatory obligations</li>
          </ul>
        </section>

        <section>
          <h2>4. Who we share it with</h2>
          <p>
            <span className="text-paper">Stripe</span>, to process payments and payouts. Stripe
            acts as an independent controller for the identity and bank details it collects
            directly from artists during Connect onboarding — see{" "}
            <a
              href="https://stripe.com/gb/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-acid"
            >
              Stripe&rsquo;s privacy policy
            </a>
            .
          </p>
          <p>
            <span className="text-paper">Supabase</span>, our database and authentication
            infrastructure provider, which stores your account and profile data on our behalf.
          </p>
          <p>
            Other users see only what your role&rsquo;s public profile is designed to show (e.g.
            an artist&rsquo;s public profile, or a promoter&rsquo;s posted slots) — we don&rsquo;t
            sell your personal data to anyone, and we don&rsquo;t use third-party advertising or
            analytics trackers.
          </p>
        </section>

        <section>
          <h2>5. Where it&rsquo;s processed</h2>
          <p>
            Our infrastructure providers may process data outside the UK/EEA. Where that happens,
            it&rsquo;s covered by appropriate safeguards required under UK GDPR, such as standard
            contractual clauses.
          </p>
        </section>

        <section>
          <h2>6. How long we keep it</h2>
          <p>
            We keep your account and activity data for as long as your account is active. If you
            want your account and personal data deleted, contact us using the details below and
            we&rsquo;ll action it, subject to any records we&rsquo;re legally required to retain
            (for example, transaction records for tax purposes).
          </p>
        </section>

        <section>
          <h2>7. Cookies</h2>
          <p>
            We use one essential session cookie, set by Supabase, to keep you signed in. We
            don&rsquo;t use advertising, marketing, or third-party tracking cookies.
          </p>
        </section>

        <section>
          <h2>8. Your rights</h2>
          <p>Under UK GDPR, you have the right to:</p>
          <ul>
            <li>Access the personal data we hold about you</li>
            <li>Correct inaccurate data</li>
            <li>Request deletion of your data</li>
            <li>Restrict or object to certain processing</li>
            <li>Receive your data in a portable format</li>
            <li>
              Complain to the{" "}
              <a
                href="https://ico.org.uk"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-acid"
              >
                Information Commissioner&rsquo;s Office (ICO)
              </a>
            </li>
          </ul>
        </section>

        <section>
          <h2>9. Children</h2>
          <p>
            Support Slot is for users aged 16 and over. We don&rsquo;t knowingly collect personal
            data from anyone under 16.
          </p>
        </section>

        <section>
          <h2>10. Changes to this policy</h2>
          <p>
            We&rsquo;ll update the &ldquo;last updated&rdquo; date above if this policy changes,
            and post the new version here.
          </p>
        </section>

        <section>
          <h2>11. Contact us</h2>
          <p>
            Questions about this policy or your data — email{" "}
            <a href="mailto:privacy@supportslot.example" className="underline hover:text-acid">
              privacy@supportslot.example
            </a>
            .
          </p>
        </section>
      </div>

      <div className="mt-16 border-t border-ink-border pt-6">
        <Link
          href="/terms"
          className="font-mono text-xs uppercase tracking-widest text-acid hover:underline"
        >
          Read our Terms of Service →
        </Link>
      </div>
    </div>
  );
}
