"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cancelSlot, closeSlot, reopenSlot } from "@/lib/actions";
import type { Result } from "@/lib/result";
import ReasonModal from "./ReasonModal";
import type { SupportSlot } from "@/lib/types";

/**
 * Owner-only lifecycle controls for one listing. Every action is enforced in
 * SQL (owner check, state check, confirmed-booking check); this only offers
 * the ones that make sense for the listing's current status.
 */
export default function ListingActions({ slot, onChanged }: { slot: SupportSlot; onChanged: () => void | Promise<void> }) {
  const [modal, setModal] = useState<"close" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<Result<unknown>>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setModal(null);
    await onChanged();
  };

  const link = "font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:underline disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {(slot.status === "open" || slot.status === "closed") && (
        <a href={`/promoter/slot/${slot.id}/edit`} className={`${link} hover:text-acid`}>
          Edit
        </a>
      )}
      {slot.status === "open" && (
        <button type="button" disabled={busy} className={`${link} hover:text-acid`} onClick={() => { setError(null); setModal("close"); }}>
          Close applications
        </button>
      )}
      {slot.status === "closed" && (
        <button type="button" disabled={busy} className={`${link} hover:text-acid`} onClick={() => run(() => reopenSlot(createClient(), slot.id))}>
          Reopen
        </button>
      )}
      {(slot.status === "open" || slot.status === "filled") && (
        <button type="button" disabled={busy} className={`${link} hover:text-signal`} onClick={() => { setError(null); setModal("cancel"); }}>
          Cancel listing
        </button>
      )}
      {error && modal === null && (
        <span className="basis-full text-xs text-signal" role="alert">{error}</span>
      )}

      <ReasonModal
        open={modal === "close"}
        title="Close applications?"
        body="No new applications can be sent. Existing applicants keep their status and you can still make offers. You can reopen later."
        confirmLabel="Close applications"
        busy={busy}
        error={error}
        onClose={() => setModal(null)}
        onConfirm={() => run(() => closeSlot(createClient(), slot.id))}
      />
      <ReasonModal
        open={modal === "cancel"}
        title="Cancel this listing?"
        body={
          slot.status === "filled"
            ? "This listing has a confirmed artist. Cancelling it cancels their booking and tells them."
            : "Everyone who applied is told the listing was cancelled, and any outstanding offer is withdrawn."
        }
        confirmLabel="Cancel listing"
        requireReason={false}
        busy={busy}
        error={error}
        onClose={() => setModal(null)}
        onConfirm={(reason) => run(() => cancelSlot(createClient(), slot.id, reason || undefined))}
      />
    </div>
  );
}
