"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { formatDate, formatPence } from "@/lib/utils";
import { summariseArtistEarnings } from "@/lib/queries";
import PaymentBadge from "@/components/bookings/PaymentBadge";

interface BankPayout {
  id: string;
  amountPence: number;
  status: string;
  arrivalDate: string;
  failureMessage: string | null;
}

/**
 * The artist's view of money — real Stripe Connect, not a ledger of our own.
 *
 *  - Per booking, what the promoter has paid (confirmed by Stripe) vs. what
 *    is still awaiting payment. Support Slot is not an escrow: nothing here
 *    is "held" — an unpaid booking is simply unpaid.
 *  - Bank payouts are read live from Stripe, with Stripe's own status. They
 *    batch many bookings together, so they aren't attached to single shows.
 */
export default function PayoutPanel() {
  const { currentArtist, bookings, reload } = useStore();
  const search = useSearchParams();
  const [connecting, setConnecting] = useState(false);
  const [openingDashboard, setOpeningDashboard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payouts, setPayouts] = useState<BankPayout[] | null>(null);
  const [payoutsError, setPayoutsError] = useState<string | null>(null);
  const me = currentArtist;
  const returned = search.get("payouts"); // set by /api/stripe/connect/return

  const confirmed = useMemo(
    () => bookings.filter((b) => b.status === "confirmed" || (b.status === "cancelled" && b.paymentStatus !== "unpaid")),
    [bookings]
  );
  const { receivedPence, awaitingPaymentPence } = useMemo(() => summariseArtistEarnings(bookings), [bookings]);

  // Coming back from Stripe onboarding changes our cached eligibility.
  useEffect(() => {
    if (returned === "ready" || returned === "pending") void reload();
  }, [returned, reload]);

  useEffect(() => {
    if (!me?.stripeTransfersActive) return;
    let cancelled = false;
    fetch("/api/stripe/connect/payouts")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "We couldn't load your payouts.");
        if (!cancelled) setPayouts(body.payouts ?? []);
      })
      .catch((err) => {
        if (!cancelled) setPayoutsError(err instanceof Error ? err.message : "We couldn't load your payouts.");
      });
    return () => {
      cancelled = true;
    };
  }, [me?.stripeTransfersActive]);

  const go = async (path: string, setBusy: (b: boolean) => void, failure: string) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(path, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error ?? failure);
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
      setBusy(false);
    }
  };

  if (!me) return null;

  return (
    <div className="border border-ink-border bg-ink-raised p-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="grid grid-cols-2 gap-8">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">Paid by promoters</p>
            <p className="font-display text-4xl mt-1">{formatPence(receivedPence)}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">Awaiting payment</p>
            <p className="font-display text-4xl mt-1 text-paper-dim">{formatPence(awaitingPaymentPence)}</p>
          </div>
        </div>
        {me.stripeTransfersActive && (
          <button
            type="button"
            onClick={() => go("/api/stripe/connect/dashboard", setOpeningDashboard, "We couldn't open your Stripe dashboard.")}
            disabled={openingDashboard}
            className="inline-flex items-center gap-2 border border-ink-border px-4 py-2.5 font-mono text-xs uppercase tracking-widest hover:border-paper transition-colors shrink-0 disabled:opacity-50"
          >
            {openingDashboard ? "Opening…" : "Stripe dashboard"}
          </button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-paper-dim">
        Amounts are the performance fee plus travel you agreed — Support Slot&rsquo;s fees are paid by the promoter. When a
        promoter pays, Stripe sends your share to your connected account, then pays it to your bank on its own schedule.
      </p>

      {returned === "pending" && (
        <p className="mt-4 text-xs text-acid" role="status">
          Stripe still needs a few details before you can be paid. Use the button below to continue where you left off.
        </p>
      )}
      {returned === "error" && (
        <p className="mt-4 text-xs text-signal" role="alert">
          We couldn&rsquo;t check your Stripe account just now. Please try again.
        </p>
      )}

      {me.stripeTransfersActive ? (
        <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-ok">Able to receive payments ✓</p>
      ) : (
        <div className="mt-4 border border-acid/50 bg-acid/5 p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-acid mb-1">Payout setup needed</p>
          <p className="text-xs text-paper-dim mb-3">
            Promoters can&rsquo;t pay you until you&rsquo;ve added your details with Stripe. It takes a couple of minutes and
            you don&rsquo;t pay anything.
          </p>
          <button
            type="button"
            onClick={() => go("/api/stripe/connect/onboard", setConnecting, "We couldn't start Stripe setup.")}
            disabled={connecting}
            className="border border-acid px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-acid hover:bg-acid hover:text-acid-ink transition-colors disabled:opacity-50"
          >
            {connecting ? "Redirecting…" : "Set up payouts with Stripe"}
          </button>
        </div>
      )}
      {error && (
        <p className="mt-3 text-xs text-signal" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6 border-t border-ink-border pt-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-3">
          {confirmed.length === 0 ? "No confirmed bookings yet" : `Bookings (${confirmed.length})`}
        </p>
        {confirmed.length === 0 ? (
          <p className="text-sm text-paper-dim">Once you accept an offer, the booking and its payment status appear here.</p>
        ) : (
          <div className="space-y-3">
            {confirmed.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm truncate">{b.headliner}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim truncate">
                    {b.venueCity} · {formatDate(b.eventDate)}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <PaymentBadge booking={b} />
                    {b.receiptUrl && (
                      <a href={b.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] underline text-paper-dim">
                        Receipt
                      </a>
                    )}
                  </div>
                </div>
                <p className="font-display text-lg shrink-0">{formatPence(b.feePence + b.travelPence)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {me.stripeTransfersActive && (
        <div className="mt-6 border-t border-ink-border pt-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-3">Recent bank payouts (from Stripe)</p>
          {payoutsError ? (
            <p className="text-sm text-signal" role="alert">{payoutsError}</p>
          ) : payouts === null ? (
            <p className="text-sm text-paper-dim">Loading…</p>
          ) : payouts.length === 0 ? (
            <p className="text-sm text-paper-dim">No bank payouts yet. Stripe pays out on its own schedule once funds are available.</p>
          ) : (
            <ul className="space-y-2">
              {payouts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-paper-dim">
                    {formatDate(p.arrivalDate.slice(0, 10), { withYear: true })} · <span className="font-mono text-[10px] uppercase tracking-widest">{p.status.replace("_", " ")}</span>
                    {p.failureMessage && <span className="text-signal"> — {p.failureMessage}</span>}
                  </span>
                  <span>{formatPence(p.amountPence)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
