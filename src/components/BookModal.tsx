"use client";

import { useEffect, useRef, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { formatGBP } from "@/lib/utils";
import { DEFAULT_FALLBACK } from "@/components/ui/AvatarUploadField";
import type { Application, Artist, SupportSlot } from "@/lib/types";
import { useStore } from "@/lib/store";
import { effectiveTravelContribution, isLongTravel, MIN_LONG_TRAVEL_FEE } from "@/lib/travel";
import { getStripe } from "@/lib/stripe/client";

export default function BookModal({
  open,
  onClose,
  artist,
  slot,
  application,
}: {
  open: boolean;
  onClose: () => void;
  artist: Artist;
  slot: SupportSlot;
  application: Application;
}) {
  const { syncApplicationStatus } = useStore();
  const [confirmed, setConfirmed] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  // Guards against React StrictMode's dev-only double-invocation of effects
  // — a plain `if (clientSecret) return` state check isn't enough here
  // because both invocations start before either fetch resolves, which
  // would create two separate PaymentIntents and desync the Elements
  // provider's clientSecret (Stripe treats it as immutable after mount).
  const intentRequested = useRef(false);

  const travelFee = effectiveTravelContribution(slot.travelContribution, artist.location, slot.city);
  const longTravel = isLongTravel(artist.location, slot.city);
  const travelToppedUp = longTravel && slot.travelContribution < travelFee;
  const total = slot.supportFee + slot.bookingFee + travelFee;

  useEffect(() => {
    if (!open || intentRequested.current || confirmed) return;
    intentRequested.current = true;
    fetch("/api/stripe/payments/create-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: application.id }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Couldn't start payment.");
        setClientSecret(body.clientSecret);
      })
      .catch((err) => setSetupError(err instanceof Error ? err.message : "Couldn't start payment."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    onClose();
    setTimeout(() => {
      setConfirmed(false);
      setClientSecret(null);
    }, 300);
  };

  const handleBooked = () => {
    syncApplicationStatus(application.id, "booked");
    setConfirmed(true);
  };

  if (confirmed) {
    return (
      <Modal open={open} onClose={close} labelledBy="book-modal-title">
        <div className="p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center border border-ok text-ok">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M4 12.5 9.5 18 20 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p id="book-modal-title" className="font-display text-2xl mt-5">
            Booking confirmed
          </p>
          <p className="mt-2 text-sm text-paper-dim max-w-[38ch] mx-auto">
            {artist.name} has been booked to support {slot.headliner}. They&rsquo;ll be notified
            immediately and the show will appear on both your calendars.
          </p>
          <Button size="md" className="mt-7" onClick={close}>
            Done
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={close} labelledBy="book-modal-title">
      <div className="p-6 sm:p-7">
        <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
          Confirm booking
        </p>
        <h2 id="book-modal-title" className="font-display text-2xl mt-1">
          Book {artist.name}
        </h2>
        <p className="mt-2 text-sm text-paper-dim">
          to support {slot.headliner} — {slot.city}
        </p>

        <div className="mt-6 flex items-center gap-3 border border-ink-border p-3">
          <img src={artist.image || DEFAULT_FALLBACK} alt="" className="h-12 w-12 object-cover" />
          <div>
            <p className="text-sm">{artist.name}</p>
            <p className="font-mono text-[11px] uppercase tracking-widest text-paper-dim">
              {artist.genres.join(" / ")}
            </p>
          </div>
        </div>

        <div className="mt-6 border border-ink-border divide-y divide-ink-border">
          <Row label="Artist fee" value={formatGBP(slot.supportFee)} />
          {travelFee > 0 && <Row label="Travel compensation" value={formatGBP(travelFee)} />}
          <Row label="Support Slot booking fee" value={formatGBP(slot.bookingFee)} />
          <Row label="Total" value={formatGBP(total)} bold />
        </div>

        <p className="mt-4 text-xs text-paper-dim">
          {artist.name} keeps their full agreed performance fee of {formatGBP(slot.supportFee)}.
          Support Slot&rsquo;s {formatGBP(slot.bookingFee)} booking fee is paid by you, the promoter —
          never the artist.
        </p>
        {longTravel && (
          <p className="mt-2 text-xs text-paper-dim">
            {artist.name} is travelling over an hour to reach {slot.city}, so a guaranteed{" "}
            {formatGBP(MIN_LONG_TRAVEL_FEE)} minimum travel compensation fee applies
            {travelToppedUp ? " — topped up automatically on top of your offered amount" : ""}.
          </p>
        )}

        <div className="mt-6">
          {setupError ? (
            <p className="text-sm text-signal">{setupError}</p>
          ) : !clientSecret ? (
            <p className="text-sm text-paper-dim">Setting up payment…</p>
          ) : (
            <Elements
              stripe={getStripe()}
              options={{ clientSecret, appearance: { theme: "night" } }}
            >
              <CheckoutForm
                applicationId={application.id}
                total={total}
                onBooked={handleBooked}
              />
            </Elements>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CheckoutForm({
  applicationId,
  total,
  onBooked,
}: {
  applicationId: string;
  total: number;
  onBooked: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!stripe || !elements) return;
    setError(null);
    setSubmitting(true);
    try {
      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: "if_required",
      });
      if (confirmError) {
        setError(confirmError.message ?? "Payment failed — try again.");
        return;
      }
      if (paymentIntent?.status !== "succeeded") {
        setError(`Payment status: ${paymentIntent?.status ?? "unknown"} — try again.`);
        return;
      }

      const res = await fetch("/api/stripe/payments/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Payment succeeded but booking couldn't be confirmed.");
      onBooked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PaymentElement />
      {error && <p className="mt-3 text-sm text-signal">{error}</p>}
      <Button
        onClick={handleSubmit}
        size="lg"
        className="w-full mt-6"
        disabled={!stripe || submitting}
      >
        {submitting ? "Processing…" : `Confirm and book — ${formatGBP(total)}`}
      </Button>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className={bold ? "font-display" : "text-sm text-paper-dim"}>{label}</span>
      <span className={bold ? "font-display text-lg" : "text-sm"}>{value}</span>
    </div>
  );
}
