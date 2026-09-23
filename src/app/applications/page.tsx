"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { getInvitationsForArtist, respondToGigInvitation } from "@/lib/queries";
import ApplicationRow from "@/components/applications/ApplicationRow";
import Button from "@/components/ui/Button";
import { DEFAULT_FALLBACK } from "@/components/ui/AvatarUploadField";
import { cn, formatGBP } from "@/lib/utils";
import type { ApplicationStatus, GigInvitationForArtist } from "@/lib/types";

const TABS: { value: "all" | ApplicationStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "submitted", label: "Submitted" },
  { value: "viewed", label: "Viewed" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "booked", label: "Booked" },
  { value: "not_selected", label: "Not selected" },
  { value: "cancelled", label: "Cancelled" },
];

export default function ApplicationsPage() {
  const { applications, currentArtist, currentArtistId, refreshApplications } = useStore();
  const [tab, setTab] = useState<"all" | ApplicationStatus>("all");
  const [invitations, setInvitations] = useState<GigInvitationForArtist[]>([]);

  const loadInvitations = () => {
    if (!currentArtistId) return;
    getInvitationsForArtist(createClient(), currentArtistId).then(setInvitations);
  };

  useEffect(loadInvitations, [currentArtistId]);

  const pendingInvitations = invitations.filter((i) => i.status === "pending");

  const respond = async (invitation: GigInvitationForArtist, response: "accepted" | "declined") => {
    if (!currentArtist) return;
    await respondToGigInvitation(createClient(), {
      invitationId: invitation.id,
      response,
      artist: currentArtist,
      slot: invitation.slot,
    });
    loadInvitations();
    if (response === "accepted") await refreshApplications();
  };

  const mine = useMemo(
    () =>
      applications
        .filter((a) => a.artistId === currentArtistId)
        .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()),
    [applications, currentArtistId]
  );

  const filtered = tab === "all" ? mine : mine.filter((a) => a.status === tab);

  return (
    <div className="mx-auto max-w-[1000px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">
        Your applications
      </p>
      <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">
        Applications
      </h1>
      <p className="mt-4 max-w-[54ch] text-paper-dim">
        Every slot you&rsquo;ve applied for, all in one place. A &ldquo;not selected&rdquo; here
        just means the timing wasn&rsquo;t right — new matches turn up every week.
      </p>

      {pendingInvitations.length > 0 && (
        <div className="mt-8">
          <p className="font-mono text-[10px] uppercase tracking-widest text-acid mb-3">
            Gig invitations ({pendingInvitations.length})
          </p>
          <div className="space-y-3">
            {pendingInvitations.map((inv) => (
              <div key={inv.id} className="border border-acid/50 bg-acid/5 p-4">
                <div className="flex items-start gap-3">
                  <img
                    src={inv.slot.headlinerImage || DEFAULT_FALLBACK}
                    alt=""
                    className="h-11 w-11 object-cover shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="text-paper-dim">{inv.promoterCompany} invited you to</span>{" "}
                      {inv.slot.headliner}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mt-0.5">
                      {inv.slot.city} · {formatGBP(inv.slot.supportFee)}
                    </p>
                    {inv.message && <p className="mt-2 text-sm">{inv.message}</p>}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => respond(inv, "accepted")}>
                    Apply
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => respond(inv, "declined")}>
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const count = t.value === "all" ? mine.length : mine.filter((a) => a.status === t.value).length;
          return (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                "font-mono text-[11px] uppercase tracking-widest px-3.5 py-2.5 border transition-colors",
                tab === t.value
                  ? "border-acid text-acid"
                  : "border-ink-border text-paper-dim hover:border-paper hover:text-paper"
              )}
            >
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="mt-8 space-y-3">
        {filtered.length === 0 ? (
          <div className="border border-dashed border-ink-border p-10 text-center">
            <p className="font-display text-xl">Nothing here yet</p>
            <p className="mt-2 text-sm text-paper-dim">
              {tab === "all"
                ? "Apply to a support slot and it'll show up here."
                : "No applications currently have this status."}
            </p>
            <Button href="/discover" size="md" className="mt-5">
              Find a slot
            </Button>
          </div>
        ) : (
          filtered.map((a) => <ApplicationRow key={a.id} application={a} />)
        )}
      </div>
    </div>
  );
}
