"use client";

import { useEffect, useRef, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import BookingTerms from "./BookingTerms";
import { formatPence } from "@/lib/utils";
import { getStripe } from "@/lib/stripe/client";
import type { Booking } from "@/lib/types";

type Phase = "loading" | "ready" | "processing" | "done" | "error";

/**
 * Pays for ONE confirmed booking. The browser sends only the booking id; the
 * server works out the amount, recipient and fees from the stored terms. A
 * booking is shown as paid only after the server has confirmed it with
 * Stripe — never because this form says it submitted.
 */
export default function PayBookingModal({
  open,
  booking,
  onClose,
  onChanged,
}: {
  open: boolean;
  booking: Booking;
  onClose: () => void;
  /** Called whenever the booking's payment state may have changed. */
  onChanged: () => void | Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requested = useRef(false);

  async function start() {
    setPhase("loading");
    setMessage(null);
    setClientSecret(null);
    try {
      const res = await fetch(`/api/bookings/${booking.id}/pay`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "We couldn't start the payment.");
      if (body.clientSecret) {
        setClientSecret(body.clientSecret);
        setPhase("ready");
      } else if (body.status === "processing") {
        setMessage(body.message ?? "Your payment is being processed.");
        setPhase("processing");
      } else {
        // Stripe already has the money; ask the server to confirm and record it.
        await settle();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "We couldn't start the payment.");
      setPhase("error");
    }
  }

  // Start (or resume) the payment when the modal opens. The ref stops React
  // StrictMode's double effect from asking for two payments.
  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Asks the server (which asks Stripe) what the payment's real state is.
  async function settle() {
    try {
      const res = await fetch(`/api/bookings/${booking.id}/sync`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "We couldn't confirm the payment yet.");
      await onChanged();
      if (body.paymentStatus === "paid") {
        setPhase("done");
      } else if (body.paymentStatus === "processing") {
        setMessage("Your bank is still processing this payment. We'll update the booking as soon as Stripe confirms it — you don't need to pay again.");
        setPhase("processing");
      } else {
        setMessage("The payment hasn't gone through. You haven't been charged — you can try again.");
        setPhase("error");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "We couldn't confirm the payment yet.");
      setPhase("error");
    }
  }

  const close = () => {
    onClose();
    setTimeout(() => {
      requested.current = false;
      setPhase("loading");
      setClientSecret(null);
      setMessage(null);
    }, 300);
  };

  return (
    <Modal open={open} onClose={close} labelledBy="pay-title">
      <div className="p-6 sm:p-7">
        {phase === "done" ? (
          <div className="text-center py-2">
            <p id="pay-title" className="font-display text-2xl">Payment received</p>
            <p className="mt-2 text-sm text-paper-dim max-w-[40ch] mx-auto">
              Stripe confirmed your payment of {formatPence(booking.totalPence)}. {booking.artistName} has been notified, and a
              receipt is available on the booking.
            </p>
            <Button size="md" className="mt-6" onClick={close}>Done</Button>
          </div>
        ) : (
          <>
            <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">Pay for booking</p>
            <h2 id="pay-title" className="font-display text-2xl mt-1">{booking.artistName}</h2>
            <p className="mt-1 text-sm text-paper-dim mb-5">to support {booking.headliner}</p>
            <BookingTerms booking={booking} viewer="promoter" />
            <p className="mt-3 text-[11px] text-paper-dim">
              Payment goes through Stripe. {booking.artistName} receives the performance fee and travel in full; Support Slot&rsquo;s
              fee and card processing are covered by the lines above.
            </p>

            <div className="mt-5">
              {phase === "loading" && <p className="text-sm text-paper-dim">Setting up payment…</p>}
              {phase === "error" && (
                <div>
                  <p className="text-sm text-signal" role="alert">{message}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => void start()}
                  >
                    Try again
                  </Button>
                </div>
              )}
              {phase === "processing" && <p className="text-sm text-acid" role="status">{message}</p>}
              {phase === "ready" && clientSecret && (
                <Elements stripe={getStripe()} options={{ clientSecret, appearance: { theme: "night" } }}>
                  <CheckoutForm total={booking.totalPence} onSubmitted={settle} />
                </Elements>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function CheckoutForm({ total, onSubmitted }: { total: number; onSubmitted: () => Promise<void> }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!stripe || !elements || submitting) return; // guards repeat clicks
    setError(null);
    setSubmitting(true);
    try {
      const { error: confirmError } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: "if_required",
      });
      if (confirmError) {
        setError(confirmError.message ?? "The payment failed. You haven't been charged — please try again.");
        return;
      }
      await onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please check your booking before trying again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PaymentElement />
      {error && <p className="mt-3 text-sm text-signal" role="alert">{error}</p>}
      <Button onClick={submit} size="lg" className="w-full mt-5" disabled={!stripe || submitting}>
        {submitting ? "Processing…" : `Pay ${formatPence(total)}`}
      </Button>
    </div>
  );
}
