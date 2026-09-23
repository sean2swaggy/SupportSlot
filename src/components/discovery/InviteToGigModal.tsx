"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { createGigInvitation, getSlotsForPromoter } from "@/lib/queries";
import type { Artist, SupportSlot } from "@/lib/types";

export default function InviteToGigModal({
  open,
  onClose,
  artist,
  promoterId,
}: {
  open: boolean;
  onClose: () => void;
  artist: Artist;
  promoterId: string;
}) {
  const [openSlots, setOpenSlots] = useState<SupportSlot[] | null>(null);
  const [slotId, setSlotId] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (!open || !promoterId) return;
    getSlotsForPromoter(createClient(), promoterId).then((slots) => {
      const open = slots.filter((s) => s.status === "open");
      setOpenSlots(open);
      setSlotId(open[0]?.id ?? "");
    });
  }, [open, promoterId]);

  const close = () => {
    onClose();
    setTimeout(() => {
      setSent(false);
      setMessage("");
      setError(null);
      submittedRef.current = false;
    }, 250);
  };

  const send = async () => {
    if (submittedRef.current || !slotId) return;
    submittedRef.current = true;
    setSubmitting(true);
    setError(null);
    const result = await createGigInvitation(createClient(), {
      slotId,
      promoterId,
      artistId: artist.id,
      message: message.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      submittedRef.current = false;
      return;
    }
    setSent(true);
  };

  return (
    <Modal open={open} onClose={close} labelledBy="invite-modal-title">
      <div className="p-6 sm:p-7">
        {sent ? (
          <div className="py-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center border border-acid text-acid">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M4 12.5 9.5 18 20 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="font-display text-xl mt-4">Invitation sent</p>
            <p className="mt-2 text-sm text-paper-dim max-w-[36ch] mx-auto">
              {artist.name} will see this in their account and can apply if they&rsquo;re
              interested — this doesn&rsquo;t book them, and they&rsquo;re never charged
              anything either way.
            </p>
            <Button size="md" className="mt-6" onClick={close}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
              Invite to gig
            </p>
            <h2 id="invite-modal-title" className="font-display text-2xl mt-1 mb-5">
              Invite {artist.name}
            </h2>

            {openSlots === null ? (
              <p className="text-sm text-paper-dim">Loading your open gigs…</p>
            ) : openSlots.length === 0 ? (
              <div className="border border-dashed border-ink-border p-6 text-center">
                <p className="text-sm text-paper-dim">
                  You don&rsquo;t have any open gigs to invite them to yet.
                </p>
                <Button href="/create-slot" size="md" className="mt-4">
                  Post a gig
                </Button>
              </div>
            ) : (
              <>
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
                    Which gig?
                  </label>
                  <select
                    value={slotId}
                    onChange={(e) => setSlotId(e.target.value)}
                    className="w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper"
                  >
                    {openSlots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.headliner} · {s.city} · {s.date}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-4">
                  <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
                    Optional message
                  </label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    maxLength={280}
                    placeholder="Why you think they'd be a good fit..."
                    className="w-full resize-none border border-ink-border bg-transparent p-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60"
                  />
                </div>
                <p className="mt-4 text-[11px] text-paper-dim">
                  This sends an invitation to apply — it never books or charges anyone
                  automatically. {artist.name} can accept, decline, or ignore it.
                </p>
                {error && <p className="mt-3 text-sm text-signal">{error}</p>}
                <Button size="lg" className="w-full mt-4" disabled={submitting} onClick={send}>
                  {submitting ? "Sending…" : "Send invitation"}
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
