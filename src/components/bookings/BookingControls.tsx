"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import {
  cancelBooking,
  declineApplication,
  makeOffer,
  openApplicationThread,
  respondToOffer,
  shortlistApplication,
  withdrawApplication,
  withdrawOffer,
} from "@/lib/actions";
import type { Result } from "@/lib/result";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import BookingTerms from "./BookingTerms";
import ReasonModal from "./ReasonModal";
import type { Application, Booking } from "@/lib/types";

const fieldCls =
  "w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60";

function expiryText(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * One in-flight action with its own busy flag and error. Disabling the
 * button while it runs is what stops a double-click sending two requests;
 * the SQL functions are idempotent-safe as the second line of defence.
 */
function useAction() {
  const { refreshApplications } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<Result<unknown>>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const result = await fn();
    if (!result.ok) setError(result.error);
    // Re-read either way: a failure often means the state moved under us
    // (offer expired, slot filled) and the screen should show the truth.
    await refreshApplications().catch(() => undefined);
    setBusy(false);
    return result.ok;
  };
  return { busy, error, setError, run };
}

function MessageLink({ applicationId }: { applicationId: string }) {
  const { refreshThreads } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await openApplicationThread(createClient(), applicationId);
          if (!res.ok) {
            setError(res.error);
            setBusy(false);
            return;
          }
          await refreshThreads().catch(() => undefined);
          window.location.href = `/messages?thread=${res.data}`;
        }}
        className="font-mono text-[10px] uppercase tracking-widest border border-ink-border px-3 py-2 hover:border-paper transition-colors disabled:opacity-40"
      >
        {busy ? "Opening…" : "Message"}
      </button>
      {error && <span className="basis-full text-xs text-signal" role="alert">{error}</span>}
    </>
  );
}

// --- Artist side ------------------------------------------------------------

export function ArtistApplicationControls({ application, booking }: { application: Application; booking?: Booking }) {
  const act = useAction();
  const [modal, setModal] = useState<"withdraw" | "decline" | "cancel" | null>(null);
  const [nowMs] = useState(() => Date.now());
  const close = () => {
    setModal(null);
    act.setError(null);
  };
  const s = application.status;

  return (
    <div className="space-y-4">
      {s === "offered" && booking && (
        <div className="border border-acid/60 bg-acid/5 p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-acid">
            {booking.promoterCompany} made you an offer
          </p>
          <div className="mt-3">
            <BookingTerms booking={booking} viewer="artist" />
          </div>
          <p className="mt-3 text-xs text-paper-dim">
            {new Date(booking.offerExpiresAt).getTime() < nowMs
              ? "This offer has expired."
              : `Respond by ${expiryText(booking.offerExpiresAt)}. Accepting confirms the booking.`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" disabled={act.busy} onClick={() => act.run(() => respondToOffer(createClient(), application.id, true))}>
              {act.busy ? "Working…" : "Accept offer"}
            </Button>
            <Button size="sm" variant="outline" disabled={act.busy} onClick={() => setModal("decline")}>
              Decline
            </Button>
          </div>
          {act.error && <p className="mt-3 text-sm text-signal" role="alert">{act.error}</p>}
        </div>
      )}

      {s === "confirmed" && booking && (
        <div className="border border-ok/50 bg-ok/5 p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ok">Booking confirmed</p>
          <div className="mt-3">
            <BookingTerms booking={booking} viewer="artist" />
          </div>
          <p className="mt-3 text-xs text-paper-dim">
            Agree how and when you&rsquo;re paid with the promoter — message them from here. Support Slot doesn&rsquo;t take or hold payment.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <MessageLink applicationId={application.id} />
            <button
              type="button"
              onClick={() => setModal("cancel")}
              className="font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-signal hover:underline"
            >
              Cancel booking
            </button>
          </div>
        </div>
      )}

      {(s === "submitted" || s === "viewed" || s === "shortlisted") && (
        <div className="flex flex-wrap items-center gap-3">
          <MessageLink applicationId={application.id} />
          <button
            type="button"
            onClick={() => setModal("withdraw")}
            className="font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-signal hover:underline"
          >
            Withdraw application
          </button>
        </div>
      )}

      {s === "cancelled" && booking?.cancelReason && (
        <p className="text-xs text-paper-dim">
          Cancelled. Reason: {booking.cancelReason}
        </p>
      )}
      {s === "declined" && application.closedReason === "slot_filled" && (
        <p className="text-xs text-paper-dim">The promoter booked another act for this slot.</p>
      )}
      {s === "declined" && application.closedReason === "listing_cancelled" && (
        <p className="text-xs text-paper-dim">The listing was cancelled by the promoter.</p>
      )}

      <ReasonModal
        open={modal === "withdraw"}
        title="Withdraw your application?"
        body="The promoter will no longer see it as active. You can apply again later only if the listing is still open."
        confirmLabel="Withdraw"
        busy={act.busy}
        error={act.error}
        onClose={close}
        onConfirm={async () => {
          if (await act.run(() => withdrawApplication(createClient(), application.id))) close();
        }}
      />
      <ReasonModal
        open={modal === "decline"}
        title="Decline this offer?"
        body="The promoter is told you've declined and the slot stays open for other artists."
        confirmLabel="Decline offer"
        requireReason={false}
        busy={act.busy}
        error={act.error}
        onClose={close}
        onConfirm={async (reason) => {
          if (await act.run(() => respondToOffer(createClient(), application.id, false, reason))) close();
        }}
      />
      <ReasonModal
        open={modal === "cancel"}
        title="Cancel this booking?"
        body="The promoter is told straight away and the slot goes back on the market."
        confirmLabel="Cancel booking"
        requireReason
        busy={act.busy}
        error={act.error}
        onClose={close}
        onConfirm={async (reason) => {
          if (await act.run(() => cancelBooking(createClient(), application.id, reason))) close();
        }}
      />
    </div>
  );
}

// --- Promoter side ----------------------------------------------------------

export function PromoterApplicantControls({
  application,
  booking,
  slotOpen,
}: {
  application: Application;
  booking?: Booking;
  /** False once the slot is filled / closed / cancelled — no new offers. */
  slotOpen: boolean;
}) {
  const act = useAction();
  const [modal, setModal] = useState<"offer" | "decline" | "withdraw" | "cancel" | null>(null);
  const [offerMessage, setOfferMessage] = useState("");
  const s = application.status;
  const close = () => {
    setModal(null);
    act.setError(null);
  };

  return (
    <div className="space-y-3 w-full">
      {s === "offered" && booking && (
        <div className="border border-acid/60 bg-acid/5 p-3 text-sm">
          Offer sent — {booking.artistName} has until {expiryText(booking.offerExpiresAt)} to respond. Nothing is confirmed until
          they accept.
        </div>
      )}
      {s === "confirmed" && booking && (
        <div className="border border-ok/50 bg-ok/5 p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ok">Confirmed by {booking.artistName}</p>
          <p className="mt-2 text-xs text-paper-dim">
            Agree payment with the artist directly — Support Slot doesn&rsquo;t take or hold payment.
          </p>
        </div>
      )}
      {s === "cancelled" && booking?.cancelReason && (
        <p className="text-xs text-paper-dim">Cancelled. Reason: {booking.cancelReason}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(s === "submitted" || s === "viewed" || s === "shortlisted") && slotOpen && (
          <>
            {s !== "shortlisted" && (
              <button
                disabled={act.busy}
                onClick={() => act.run(() => shortlistApplication(createClient(), application.id))}
                className="font-mono text-[10px] uppercase tracking-widest border border-ink-border px-3 py-2 hover:border-paper transition-colors disabled:opacity-40"
              >
                Shortlist
              </button>
            )}
            <Button size="sm" disabled={act.busy} onClick={() => setModal("offer")}>
              Make offer
            </Button>
            <button
              disabled={act.busy}
              onClick={() => setModal("decline")}
              className="font-mono text-[10px] uppercase tracking-widest border border-ink-border px-3 py-2 hover:border-signal hover:text-signal transition-colors disabled:opacity-40"
            >
              Decline
            </button>
          </>
        )}
        {s === "offered" && (
          <Button size="sm" variant="outline" disabled={act.busy} onClick={() => setModal("withdraw")}>
            Withdraw offer
          </Button>
        )}
        {s === "confirmed" && (
          <button
            type="button"
            onClick={() => setModal("cancel")}
            className="font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-signal hover:underline"
          >
            Cancel booking
          </button>
        )}
        <MessageLink applicationId={application.id} />
      </div>
      {act.error && modal === null && <p className="text-sm text-signal" role="alert">{act.error}</p>}

      <Modal open={modal === "offer"} onClose={close} labelledBy="offer-title">
        <div className="p-6 sm:p-7">
          <h2 id="offer-title" className="font-display text-2xl">Make an offer</h2>
          <p className="mt-2 text-sm text-paper-dim">
            The terms come from your listing — fee, travel, date and times — and are locked in when you send this. The artist
            then accepts or declines; only an accepted offer becomes a booking, and you then settle payment with them directly.
          </p>
          <label htmlFor="offer-msg" className="mt-4 block font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2">
            Message (optional)
          </label>
          <textarea id="offer-msg" rows={3} maxLength={1000} value={offerMessage} onChange={(e) => setOfferMessage(e.target.value)} className={fieldCls} />
          {act.error && <p className="mt-3 text-sm text-signal" role="alert">{act.error}</p>}
          <div className="flex gap-3 mt-6">
            <Button variant="outline" size="md" className="flex-1" onClick={close} disabled={act.busy}>Go back</Button>
            <Button
              size="md"
              className="flex-1"
              disabled={act.busy}
              onClick={async () => {
                if (await act.run(() => makeOffer(createClient(), application.id, offerMessage.trim() || undefined))) {
                  setOfferMessage("");
                  close();
                }
              }}
            >
              {act.busy ? "Sending…" : "Send offer"}
            </Button>
          </div>
        </div>
      </Modal>

      <ReasonModal
        open={modal === "decline"}
        title="Decline this applicant?"
        body="They're told it wasn't successful this time. This can't be undone."
        confirmLabel="Decline"
        requireReason={false}
        busy={act.busy}
        error={act.error}
        onClose={close}
        onConfirm={async (reason) => {
          if (await act.run(() => declineApplication(createClient(), application.id, reason || undefined))) close();
        }}
      />
      <ReasonModal
        open={modal === "withdraw"}
        title="Withdraw your offer?"
        body="The artist is told, and goes back to shortlisted. You can offer again or choose someone else."
        confirmLabel="Withdraw offer"
        busy={act.busy}
        error={act.error}
        onClose={close}
        onConfirm={async () => {
          if (await act.run(() => withdrawOffer(createClient(), application.id))) close();
        }}
      />
      <ReasonModal
        open={modal === "cancel"}
        title="Cancel this booking?"
        body="The artist is told straight away and the slot goes back on the market."
        confirmLabel="Cancel booking"
        requireReason
        busy={act.busy}
        error={act.error}
        onClose={close}
        onConfirm={async (reason) => {
          if (await act.run(() => cancelBooking(createClient(), application.id, reason))) close();
        }}
      />

    </div>
  );
}

