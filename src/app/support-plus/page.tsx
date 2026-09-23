"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import Button from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { supportPlusPrice, supportPlusSavingsLabel } from "@/lib/pricing";

const FEATURES = [
  {
    t: "Artist Roster",
    d: "Save artists straight from their profile or an application into your own private list — never visible to the artist, never seeded from anywhere else.",
  },
  {
    t: "Availability requests",
    d: "Ask roster artists if they're free for a show before you commit to a real booking. Not a reservation — just a faster way to check who's around.",
  },
  { t: "Reusable event templates", d: "Save a show's details once and reuse them the next time you're booking a similar night." },
  { t: "Team collaboration", d: "Share roster access with people on your team. (Coming soon — single-owner accounts for now.)" },
  { t: "Scheduled reminders", d: "Get nudged before a response deadline passes. (Coming soon.)" },
  { t: "Booking & payment report exports", d: "Download a CSV of your bookings and what you paid, any time." },
];

const FREE_INCLUDES = [
  "Post support slots — no numerical limit",
  "Review every applicant",
  "Message artists directly",
  "Complete real, paid bookings",
];

export default function SupportPlusPage() {
  const { role, isSupportPlus, supportPlusBillingPeriod, startSupportPlusCheckout, openBillingPortal } = useStore();
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activePeriod = isSupportPlus ? supportPlusBillingPeriod : period;
  const price = supportPlusPrice(activePeriod);

  const subscribe = async () => {
    setError(null);
    setStarting(true);
    try {
      await startSupportPlusCheckout(period);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start checkout.");
      setStarting(false);
    }
  };

  const manage = async () => {
    setError(null);
    setStarting(true);
    try {
      await openBillingPortal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open billing.");
      setStarting(false);
    }
  };

  if (role === "artist") {
    return (
      <div className="mx-auto max-w-[760px] px-4 sm:px-6 lg:px-10 py-16 sm:py-24 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">
          Support+
        </p>
        <h1 className="font-display uppercase text-4xl sm:text-5xl leading-[0.95] tracking-tight">
          A promoter tool
        </h1>
        <p className="mt-5 text-paper-dim">
          Support+ helps promoters organise shows and manage artist relationships — it&rsquo;s a
          subscription for promoter accounts, not artists. Every core feature you use to find
          gigs, apply, message promoters and get paid stays free, always.
        </p>
        <Button href="/discover" size="lg" className="mt-8">
          Find a slot
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1000px] px-4 sm:px-6 lg:px-10 py-10 sm:py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">
        For promoters
      </p>
      <h1 className="font-display uppercase text-5xl sm:text-7xl leading-[0.9] tracking-tight">
        Support+
      </h1>
      <p className="mt-5 max-w-[60ch] text-lg text-paper-dim">
        Organise your shows and your artist relationships in one place — a private roster,
        availability checks before you commit to a booking, and reporting. £
        {supportPlusPrice("monthly").toFixed(2)}/month or £{supportPlusPrice("annual").toFixed(2)}
        /year, cancel anytime.
      </p>

      <div className="mt-8 border border-acid bg-acid/10 px-5 py-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-acid">
          Artists always use Support Slot for free.
        </p>
        <p className="mt-1 text-sm text-paper-dim">
          Support+ never affects an artist&rsquo;s match score, ranking, or ability to apply, get
          booked and get paid — it&rsquo;s entirely about how promoters organise their side of the
          platform. Booking and payment-processing fees are separate from this subscription; see
          the fee breakdown on every booking.
        </p>
      </div>

      {!isSupportPlus && (
        <div className="mt-10 inline-flex border border-ink-border p-1">
          <button
            type="button"
            onClick={() => setPeriod("monthly")}
            className={cn(
              "font-mono text-[10px] uppercase tracking-widest px-4 py-2 transition-colors",
              period === "monthly" ? "bg-acid text-acid-ink" : "text-paper-dim hover:text-paper"
            )}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setPeriod("annual")}
            className={cn(
              "flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest px-4 py-2 transition-colors",
              period === "annual" ? "bg-acid text-acid-ink" : "text-paper-dim hover:text-paper"
            )}
          >
            Annual
            <span
              className={cn(
                "px-1.5 py-0.5 text-[9px]",
                period === "annual" ? "bg-acid-ink text-acid" : "border border-ink-border text-paper-dim"
              )}
            >
              Save
            </span>
          </button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="border border-ink-border p-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">Free</p>
          <p className="font-display text-3xl mt-2">£0</p>
          <ul className="mt-5 space-y-3">
            {FREE_INCLUDES.map((f) => (
              <li key={f} className="flex gap-3 text-sm text-paper-dim">
                <span className="text-paper-dim">—</span>
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div className="border border-acid p-6 relative">
          <span className="absolute -top-3 right-6 bg-acid px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-acid-ink">
            For growing promoters
          </span>
          <p className="font-mono text-[10px] uppercase tracking-widest text-acid">
            Support+ {isSupportPlus && `· billed ${supportPlusBillingPeriod}`}
          </p>
          <p className="font-display text-3xl mt-2">
            £{price.toFixed(2)}
            <span className="text-base text-paper-dim font-body">
              /{activePeriod === "annual" ? "year" : "month"}
            </span>
          </p>
          {!isSupportPlus && period === "annual" && (
            <p className="mt-1.5 text-xs text-acid">{supportPlusSavingsLabel()}</p>
          )}
          <ul className="mt-5 space-y-3">
            {FEATURES.map((f) => (
              <li key={f.t} className="flex gap-3 text-sm">
                <span className="text-acid">✓</span>
                {f.t}
              </li>
            ))}
          </ul>
          {isSupportPlus ? (
            <>
              <Button variant="outline" size="lg" className="w-full mt-6" disabled>
                Subscribed ✓
              </Button>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button href="/dashboard/promoter/roster" size="sm" variant="outline">
                  Open roster
                </Button>
                <Button href="/dashboard/promoter/requests" size="sm" variant="outline">
                  Availability requests
                </Button>
                <Button href="/api/reports/bookings" size="sm" variant="outline">
                  Download bookings report
                </Button>
              </div>
            </>
          ) : (
            <Button onClick={subscribe} disabled={starting} size="lg" className="w-full mt-6">
              {starting ? "Redirecting…" : "Subscribe to Support+"}
            </Button>
          )}
        </div>
      </div>

      {isSupportPlus && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border border-ok/50 bg-ok/10 px-5 py-4">
          <p className="font-mono text-xs uppercase tracking-widest text-ok">
            Support+ active — £{price.toFixed(2)}/{activePeriod === "annual" ? "year" : "month"}
          </p>
          <button
            onClick={manage}
            disabled={starting}
            className="font-mono text-[11px] uppercase tracking-widest text-paper-dim hover:text-paper hover:underline disabled:opacity-50"
          >
            Manage billing / cancel
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-signal">{error}</p>}

      <div className="mt-16">
        <p className="font-mono text-[11px] uppercase tracking-widest text-paper-dim mb-6">
          What you get
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-8">
          {FEATURES.map((f, i) => (
            <div key={f.t} className="border-t border-ink-border pt-4">
              <p className="font-mono text-xs text-acid">{String(i + 1).padStart(2, "0")}</p>
              <p className="font-display text-lg mt-2">{f.t}</p>
              <p className="text-sm text-paper-dim mt-1.5">{f.d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
