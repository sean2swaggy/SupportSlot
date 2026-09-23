"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import {
  bookFromAvailabilityResponse,
  getAvailabilityRequestsForPromoter,
  getRoster,
  getSlotsForPromoter,
  markAvailabilityRequestFilled,
  withdrawAvailabilityRequest,
} from "@/lib/queries";
import { DEFAULT_FALLBACK } from "@/components/ui/AvatarUploadField";
import Button from "@/components/ui/Button";
import RequestComposerModal from "@/components/requests/RequestComposerModal";
import BookModal from "@/components/BookModal";
import { isRequestExpired } from "@/lib/availability";
import type { Application, AvailabilityRequestWithRecipients, RosterEntry, SupportSlot } from "@/lib/types";

export default function PromoterRequestsPage() {
  const { currentPromoterId, isSupportPlus } = useStore();
  const [requests, setRequests] = useState<AvailabilityRequestWithRecipients[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [mySlots, setMySlots] = useState<SupportSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [bookTarget, setBookTarget] = useState<{ artist: RosterEntry["artist"]; slot: SupportSlot; application: Application } | null>(null);

  const load = () => {
    if (!currentPromoterId) return;
    const supabase = createClient();
    Promise.all([
      getAvailabilityRequestsForPromoter(supabase, currentPromoterId),
      getRoster(supabase, currentPromoterId),
      getSlotsForPromoter(supabase, currentPromoterId),
    ]).then(([r, rost, slots]) => {
      setRequests(r);
      setRoster(rost);
      setMySlots(slots);
      setLoading(false);
    });
  };

  useEffect(load, [currentPromoterId]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      <Link
        href="/dashboard/promoter"
        className="font-mono text-[11px] uppercase tracking-widest text-paper-dim hover:text-paper"
      >
        ← Back to dashboard
      </Link>

      <div className="mt-4 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-2">
            Support+
          </p>
          <h1 className="font-display uppercase text-3xl sm:text-5xl leading-none">
            Availability requests
          </h1>
          <p className="mt-3 max-w-[62ch] text-paper-dim">
            Ask roster artists if they&rsquo;re free before you commit to a booking. An
            &ldquo;available&rdquo; reply is guidance, not a reservation — you still book and pay
            through the normal flow.
          </p>
        </div>
        {isSupportPlus ? (
          <Button onClick={() => setComposerOpen(true)} size="md">
            New request
          </Button>
        ) : (
          <Button href="/support-plus" size="md" variant="outline">
            Resubscribe to send new requests
          </Button>
        )}
      </div>

      <div className="mt-10 space-y-5">
        {loading ? (
          <p className="text-sm text-paper-dim">Loading…</p>
        ) : requests.length === 0 ? (
          <div className="border border-dashed border-ink-border p-10 text-center">
            <p className="font-display text-xl">No requests sent yet</p>
            <p className="mt-2 text-sm text-paper-dim max-w-[46ch] mx-auto">
              Save a few artists to your roster, then send your first availability request.
            </p>
            <Button href="/dashboard/promoter/roster" size="md" className="mt-5">
              Open roster
            </Button>
          </div>
        ) : (
          requests.map((req) => (
            <RequestCard
              key={req.id}
              request={req}
              expired={isRequestExpired(req)}
              mySlots={mySlots}
              onChanged={load}
              onBook={(artist, slot, application) => setBookTarget({ artist, slot, application })}
            />
          ))
        )}
      </div>

      <RequestComposerModal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        promoterId={currentPromoterId}
        roster={roster}
        onSent={load}
      />

      {bookTarget && (
        <BookModal
          open={!!bookTarget}
          onClose={() => setBookTarget(null)}
          artist={bookTarget.artist}
          slot={bookTarget.slot}
          application={bookTarget.application}
        />
      )}
    </div>
  );
}

function RequestCard({
  request,
  expired,
  mySlots,
  onChanged,
  onBook,
}: {
  request: AvailabilityRequestWithRecipients;
  expired: boolean;
  mySlots: SupportSlot[];
  onChanged: () => void;
  onBook: (artist: RosterEntry["artist"], slot: SupportSlot, application: Application) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pickingSlotFor, setPickingSlotFor] = useState<string | null>(null);

  const withdraw = async () => {
    setBusy(true);
    const ok = await withdrawAvailabilityRequest(createClient(), request.id);
    if (ok) onChanged();
    setBusy(false);
  };

  const markFilled = async () => {
    setBusy(true);
    const ok = await markAvailabilityRequestFilled(createClient(), request.id);
    if (ok) onChanged();
    setBusy(false);
  };

  const linkSlotAndBook = async (recipientId: string, artist: RosterEntry["artist"], slotId: string) => {
    const supabase = createClient();
    await supabase.from("availability_requests").update({ linked_slot_id: slotId }).eq("id", request.id);
    const slot = mySlots.find((s) => s.id === slotId);
    if (!slot) return;
    const result = await bookFromAvailabilityResponse(supabase, {
      requestId: request.id,
      recipientId,
      artist,
      slot,
    });
    setPickingSlotFor(null);
    onChanged();
    if (result.ok) onBook(artist, slot, result.application);
  };

  const statusLabel =
    request.status === "withdrawn" ? "Withdrawn" : request.status === "filled" ? "Filled" : expired ? "Expired" : "Open";

  return (
    <div className="border border-ink-border bg-ink-raised p-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
            {request.venueName}, {request.venueLocation} · {request.eventDate} {request.eventTime}
          </p>
          <p className="font-display text-2xl mt-1">{request.eventName}</p>
          <p className="text-sm text-paper-dim mt-1">
            {request.currency} {request.proposedFee} proposed · {request.setLengthMins} min set ·
            reply by {new Date(request.responseDeadline).toLocaleString("en-GB")}
          </p>
        </div>
        <span
          className={
            "font-mono text-[10px] uppercase tracking-widest px-2.5 py-1.5 border shrink-0 " +
            (statusLabel === "Open"
              ? "border-acid text-acid"
              : statusLabel === "Filled"
                ? "border-ok text-ok"
                : "border-ink-border text-paper-dim")
          }
        >
          {statusLabel}
        </span>
      </div>

      <div className="mt-4 divide-y divide-ink-border border-t border-ink-border">
        {request.recipients.map((r) => {
          const alreadyBooked = r.linkedApplicationStatus === "booked";
          return (
            <div key={r.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <img src={r.artist.image || DEFAULT_FALLBACK} alt="" className="h-9 w-9 object-cover shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm truncate">{r.artist.name}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
                    {r.response === "pending"
                      ? r.questionAsked
                        ? "Asked a question"
                        : "Awaiting response"
                      : r.response}
                  </p>
                </div>
              </div>
              {r.response === "available" && request.status === "sent" && !expired && (
                <div className="shrink-0">
                  {alreadyBooked ? (
                    <span className="font-mono text-[10px] uppercase tracking-widest text-ok">Booked ✓</span>
                  ) : pickingSlotFor === r.id ? (
                    <select
                      autoFocus
                      onChange={(e) => e.target.value && linkSlotAndBook(r.id, r.artist, e.target.value)}
                      defaultValue=""
                      className="border border-ink-border bg-transparent px-2 py-1.5 text-xs outline-none"
                    >
                      <option value="" disabled>
                        Pick a slot…
                      </option>
                      {mySlots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.headliner} · {s.date}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPickingSlotFor(r.id)}
                      className="font-mono text-[10px] uppercase tracking-widest border border-acid text-acid px-3 py-2 hover:bg-acid hover:text-acid-ink transition-colors"
                    >
                      Book
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {request.status === "sent" && !expired && (
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={withdraw}
            disabled={busy}
            className="font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-signal disabled:opacity-50"
          >
            Withdraw
          </button>
          <button
            type="button"
            onClick={markFilled}
            disabled={busy}
            className="font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-ok disabled:opacity-50"
          >
            Mark filled
          </button>
        </div>
      )}
      {mySlots.length === 0 && request.recipients.some((r) => r.response === "available") && (
        <p className="mt-3 text-[11px] text-paper-dim">
          To book, you&rsquo;ll need a posted slot for this show first —{" "}
          <Link href="/create-slot" className="underline hover:text-paper">
            post one
          </Link>
          , then come back here.
        </p>
      )}
    </div>
  );
}
