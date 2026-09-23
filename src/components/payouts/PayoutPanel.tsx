"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { formatGBP, formatDate } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getArtistEarnings } from "@/lib/queries";
import type { SupportSlot } from "@/lib/types";

/**
 * The artist-side view of payouts — real Stripe Connect, not a mock ledger.
 * Every booking transfers the artist's cut straight to their connected
 * account the moment a promoter pays (see BookModal / create-intent route);
 * Stripe itself then pays that out to their bank on its own schedule. This
 * panel just shows what's transferred so far and links out to the real
 * Stripe Express dashboard for bank details, payout schedule and history.
 */
export default function PayoutPanel() {
  const { currentArtist } = useStore();
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [openingDashboard, setOpeningDashboard] = useState(false);
  const [earnings, setEarnings] = useState<{ total: number; bookings: Array<{ slot: SupportSlot; amount: number }> }>({
    total: 0,
    bookings: [],
  });
  const me = currentArtist;

  useEffect(() => {
    if (!me) return;
    const supabase = createClient();
    getArtistEarnings(supabase, me.id).then(setEarnings);
  }, [me]);

  const setUpPayouts = async () => {
    setConnectError(null);
    setConnecting(true);
    try {
      const res = await fetch("/api/stripe/connect/onboard", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.url) throw new Error(body.error ?? "Couldn't start Stripe onboarding.");
      window.location.href = body.url;
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Couldn't start Stripe onboarding.");
      setConnecting(false);
    }
  };

  const openDashboard = async () => {
    setConnectError(null);
    setOpeningDashboard(true);
    try {
      const res = await fetch("/api/stripe/connect/dashboard", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.url) throw new Error(body.error ?? "Couldn't open your Stripe dashboard.");
      window.location.href = body.url;
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Couldn't open your Stripe dashboard.");
      setOpeningDashboard(false);
    }
  };

  if (!me) return null;

  return (
    <div className="border border-ink-border bg-ink-raised p-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
            Total earned
          </p>
          <p className="font-display text-4xl mt-1">{formatGBP(earnings.total)}</p>
        </div>
        {me.stripeTransfersActive && (
          <button
            type="button"
            onClick={openDashboard}
            disabled={openingDashboard}
            className="inline-flex items-center gap-2 border border-ink-border px-4 py-2.5 font-mono text-xs uppercase tracking-widest hover:border-paper transition-colors shrink-0 disabled:opacity-50"
          >
            {openingDashboard ? "Opening…" : "View Stripe dashboard"}
          </button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-paper-dim">
        Every booking pays you automatically the moment a promoter completes checkout — Stripe
        then transfers it to your bank on its own schedule. Manage your bank details, payout
        schedule and full payout history in your Stripe dashboard.
      </p>

      {me.stripeTransfersActive ? (
        <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-ok">
          Stripe payouts active ✓
        </p>
      ) : (
        <div className="mt-4 border border-acid/50 bg-acid/5 p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-acid mb-1">
            Real payouts not set up yet
          </p>
          <p className="text-xs text-paper-dim mb-3">
            Add your bank details with Stripe so real bookings can actually pay you. Takes a
            couple of minutes.
          </p>
          <button
            type="button"
            onClick={setUpPayouts}
            disabled={connecting}
            className="border border-acid px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-acid hover:bg-acid hover:text-acid-ink transition-colors disabled:opacity-50"
          >
            {connecting ? "Redirecting…" : "Set up payouts with Stripe"}
          </button>
        </div>
      )}
      {connectError && <p className="mt-3 text-xs text-signal">{connectError}</p>}

      <div className="mt-6 border-t border-ink-border pt-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-3">
          {earnings.bookings.length === 0 ? "No bookings yet" : `Booked shows (${earnings.bookings.length})`}
        </p>
        {earnings.bookings.length === 0 ? (
          <p className="text-sm text-paper-dim">
            Once a promoter books you, the payout will show up here.
          </p>
        ) : (
          <div className="space-y-3">
            {earnings.bookings.map(({ slot, amount }) => (
              <div key={slot.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm truncate">{slot.headliner}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim truncate">
                    {slot.city} · {formatDate(slot.date)}
                  </p>
                </div>
                <p className="font-display text-lg text-ok shrink-0">+{formatGBP(amount)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
