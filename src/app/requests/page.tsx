"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import {
  blockPromoter,
  createReport,
  getAvailabilityRequestsForArtist,
  respondToAvailabilityRequest,
  startAvailabilityRequestQuestion,
} from "@/lib/queries";
import { DEFAULT_FALLBACK } from "@/components/ui/AvatarUploadField";
import { isRequestExpired } from "@/lib/availability";
import type { AvailabilityRequestForArtist } from "@/lib/types";

export default function ArtistRequestsPage() {
  const { currentArtistId } = useStore();
  const router = useRouter();
  const [requests, setRequests] = useState<AvailabilityRequestForArtist[] | null>(null);
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);

  const load = () => {
    if (!currentArtistId) return;
    const supabase = createClient();
    getAvailabilityRequestsForArtist(supabase, currentArtistId).then(setRequests);
    supabase
      .from("profiles")
      .select("notify_availability_requests")
      .eq("id", currentArtistId)
      .maybeSingle()
      .then(({ data }) => setNotifyEnabled(data?.notify_availability_requests ?? true));
  };

  useEffect(load, [currentArtistId]);

  const toggleNotify = async (v: boolean) => {
    setNotifyEnabled(v);
    await createClient().from("profiles").update({ notify_availability_requests: v }).eq("id", currentArtistId);
  };

  const respond = async (recipientId: string, response: "available" | "unavailable") => {
    await respondToAvailabilityRequest(createClient(), recipientId, response);
    load();
  };

  const askQuestion = async (req: AvailabilityRequestForArtist) => {
    const result = await startAvailabilityRequestQuestion(createClient(), {
      recipientId: req.myResponse.id,
      artistId: currentArtistId,
      promoterId: req.promoterId,
      requestId: req.id,
    });
    if (result.ok) router.push(`/messages?thread=${result.threadId}`);
  };

  const block = async (promoterId: string) => {
    await blockPromoter(createClient(), currentArtistId, promoterId);
    setMenuOpenFor(null);
    load();
  };

  const report = async (req: AvailabilityRequestForArtist) => {
    const reason = window.prompt("What's happening? A short description helps us review it.");
    if (!reason) return;
    await createReport(createClient(), {
      reporterId: currentArtistId,
      reportedProfileId: req.promoterId,
      contextType: "availability_request",
      contextId: req.id,
      reason,
    });
    setMenuOpenFor(null);
    window.alert("Thanks — we've logged this for review.");
  };

  return (
    <div className="mx-auto max-w-[900px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-2">
        Free · Always
      </p>
      <h1 className="font-display uppercase text-3xl sm:text-5xl leading-none">
        Availability requests
      </h1>
      <p className="mt-3 max-w-[60ch] text-paper-dim">
        Promoters ask if you&rsquo;re free for a show before booking. Saying you&rsquo;re available
        never reserves anything or costs you anything — a real booking only happens through the
        usual apply/book flow, and you always get paid the same way either way.
      </p>

      <label className="mt-6 flex items-center gap-2.5 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={notifyEnabled}
          onChange={(e) => toggleNotify(e.target.checked)}
          className="accent-[var(--color-acid)]"
        />
        Notify me about new availability requests
      </label>

      <div className="mt-8 space-y-4">
        {requests === null ? (
          <p className="text-sm text-paper-dim">Loading…</p>
        ) : requests.length === 0 ? (
          <div className="border border-dashed border-ink-border p-10 text-center">
            <p className="font-display text-xl">No requests yet</p>
            <p className="mt-2 text-sm text-paper-dim">
              When a promoter asks if you&rsquo;re free for a show, it&rsquo;ll show up here.
            </p>
          </div>
        ) : (
          requests.map((req) => {
            const expired = isRequestExpired(req);
            const answered = req.myResponse.response !== "pending";
            const canRespond = req.status === "sent" && !expired;
            return (
              <div key={req.id} className="border border-ink-border bg-ink-raised p-5 relative">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={req.promoterAvatar || DEFAULT_FALLBACK}
                      alt=""
                      className="h-10 w-10 object-cover shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
                        {req.promoterCompany}
                      </p>
                      <p className="font-display text-xl mt-0.5">{req.eventName}</p>
                    </div>
                  </div>
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setMenuOpenFor(menuOpenFor === req.id ? null : req.id)}
                      aria-label="More options"
                      className="text-paper-dim hover:text-paper px-2"
                    >
                      ⋯
                    </button>
                    {menuOpenFor === req.id && (
                      <div className="absolute right-0 z-10 mt-1 w-48 border border-ink-border bg-ink-card text-sm shadow-xl">
                        <button
                          type="button"
                          onClick={() => report(req)}
                          className="block w-full px-3.5 py-2.5 text-left hover:bg-ink-raised"
                        >
                          Report
                        </button>
                        <button
                          type="button"
                          onClick={() => block(req.promoterId)}
                          className="block w-full px-3.5 py-2.5 text-left text-signal hover:bg-ink-raised"
                        >
                          Block this promoter
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <p className="mt-3 text-sm text-paper-dim">
                  {req.venueName}, {req.venueLocation} · {req.eventDate} {req.eventTime} (
                  {req.timezone})
                </p>
                <p className="text-sm text-paper-dim">
                  {req.currency} {req.proposedFee} proposed · {req.setLengthMins} min set
                </p>
                {req.message && <p className="mt-2 text-sm">{req.message}</p>}

                <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-paper-dim">
                  {req.status === "withdrawn"
                    ? "Withdrawn by the promoter"
                    : req.status === "filled"
                      ? "This slot has been filled"
                      : expired
                        ? "Response window closed"
                        : `Reply by ${new Date(req.responseDeadline).toLocaleString("en-GB")}`}
                </p>

                {canRespond ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => respond(req.myResponse.id, "available")}
                      className={
                        "font-mono text-[11px] uppercase tracking-widest px-4 py-2.5 border transition-colors " +
                        (req.myResponse.response === "available"
                          ? "border-ok bg-ok/10 text-ok"
                          : "border-ink-border hover:border-paper")
                      }
                    >
                      Available
                    </button>
                    <button
                      type="button"
                      onClick={() => respond(req.myResponse.id, "unavailable")}
                      className={
                        "font-mono text-[11px] uppercase tracking-widest px-4 py-2.5 border transition-colors " +
                        (req.myResponse.response === "unavailable"
                          ? "border-signal bg-signal/10 text-signal"
                          : "border-ink-border hover:border-paper")
                      }
                    >
                      Unavailable
                    </button>
                    <button
                      type="button"
                      onClick={() => askQuestion(req)}
                      className="font-mono text-[11px] uppercase tracking-widest px-4 py-2.5 border border-ink-border hover:border-paper transition-colors"
                    >
                      Ask a question
                    </button>
                  </div>
                ) : answered ? (
                  <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-paper-dim">
                    You said: {req.myResponse.response}
                  </p>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
