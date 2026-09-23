"use client";

import { useState } from "react";
import Link from "next/link";
import type { SupportSlot, Venue, Promoter } from "@/lib/types";
import { formatDate, formatGBP, applicationCloseLabel, formatWeekday } from "@/lib/utils";
import { computeMatch, matchFactors } from "@/lib/match";
import { effectiveTravelContribution, isLongTravel, MIN_LONG_TRAVEL_FEE } from "@/lib/travel";
import MatchBadge from "@/components/ui/MatchBadge";
import Button from "@/components/ui/Button";
import VerifiedBadge from "@/components/ui/VerifiedBadge";
import UrgentPulse from "@/components/ui/UrgentPulse";
import ApplyModal from "@/components/ApplyModal";
import BookingActionsLinks from "@/components/bookings/BookingActionsLinks";
import { useStore } from "@/lib/store";
import { DEFAULT_FALLBACK } from "@/components/ui/AvatarUploadField";

export default function SlotDetailClient({
  slot,
  venue,
  promoter,
}: {
  slot: SupportSlot;
  venue: Venue;
  promoter: Promoter;
}) {
  const { currentArtist, currentPromoterId, applications, promoterAvatar } = useStore();
  const me = currentArtist;
  const [applyOpen, setApplyOpen] = useState(false);
  const promoterAvatarSrc =
    (promoter.id === currentPromoterId && promoterAvatar ? promoterAvatar : promoter.avatar) ||
    DEFAULT_FALLBACK;
  const viewingOwnSlot = promoter.id === currentPromoterId;

  const match = me ? computeMatch(me, slot) : 0;
  const travelFee = me ? effectiveTravelContribution(slot.travelContribution, me.location, slot.city) : 0;
  const longTravel = me ? isLongTravel(me.location, slot.city) : false;
  const existingApplication = me
    ? applications.find((a) => a.slotId === slot.id && a.artistId === me.id)
    : undefined;

  return (
    <div>
      <div className="relative aspect-[16/9] sm:aspect-[21/9] w-full overflow-hidden border-b border-ink-border">
        <img src={slot.headlinerImage} alt={slot.headliner} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-[1400px] w-full px-4 sm:px-6 lg:px-10 pb-8">
          <Link
            href="/discover"
            className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-widest text-paper-dim hover:text-paper mb-4"
          >
            ← Back to slots
          </Link>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            {slot.isUrgent && <UrgentPulse label="Needed tonight" />}
            {me && <MatchBadge percent={match} />}
          </div>
          <h1 className="font-display uppercase text-4xl sm:text-6xl leading-[0.95] tracking-tight">
            {slot.headliner}
          </h1>
          <p className="mt-3 text-paper-dim">
            {venue.name}, {slot.city} · {formatWeekday(slot.date)}, {formatDate(slot.date, { withYear: true })}
            {slot.rescheduledAt && <span className="text-acid"> · rescheduled</span>}
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-10 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-12">
        <div>
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-widest text-paper-dim mb-4">
              About this slot
            </h2>
            <div className="flex flex-col sm:flex-row gap-5">
              <p className="text-paper leading-relaxed max-w-[65ch]">{slot.description}</p>
              {slot.artistPhoto && (
                <div className="shrink-0">
                  <img
                    src={slot.artistPhoto}
                    alt="Reference photo of the artist the promoter is picturing for this slot"
                    className="h-28 w-28 rounded-full border border-ink-border object-cover"
                  />
                  <p className="mt-2 max-w-[9rem] text-center font-mono text-[9px] uppercase tracking-widest text-paper-dim">
                    What they&rsquo;re picturing
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="mt-10 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-6 border-y border-ink-border py-8">
            <Field label="Date" value={formatDate(slot.date, { withYear: true })} />
            <Field label="Doors" value={slot.doorsTime} />
            <Field label="Performance time" value={slot.setTime} />
            <Field label="Set length" value={`${slot.performanceLengthMins} min`} />
            <Field label="Expected attendance" value={`${slot.expectedAttendance}`} />
            <Field label="Support fee" value={formatGBP(slot.supportFee)} />
            <Field
              label="Travel contribution"
              value={travelFee > 0 ? formatGBP(travelFee) : "Not offered"}
              hint={
                longTravel && me
                  ? `Includes a guaranteed ${formatGBP(MIN_LONG_TRAVEL_FEE)} minimum — this venue is over an hour from ${me.location}.`
                  : undefined
              }
            />
            <Field label="Application deadline" value={formatDate(slot.applicationDeadline, { withYear: true })} />
            <Field label="Applicants so far" value={`${slot.applicantCount}`} />
          </section>

          <section className="mt-10">
            <h2 className="font-mono text-[11px] uppercase tracking-widest text-paper-dim mb-4">
              Genres
            </h2>
            <div className="flex flex-wrap gap-2">
              {slot.genres.map((g) => (
                <span key={g} className="border border-ink-border px-3 py-1.5 text-sm">
                  {g}
                </span>
              ))}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="font-mono text-[11px] uppercase tracking-widest text-paper-dim mb-4">
              Requirements
            </h2>
            <ul className="space-y-2">
              {slot.requirements.map((r) => (
                <li key={r} className="flex gap-3 text-sm text-paper">
                  <span className="text-acid">—</span>
                  {r}
                </li>
              ))}
            </ul>
          </section>

          {me && (
            <section className="mt-10">
              <h2 className="font-mono text-[11px] uppercase tracking-widest text-paper-dim mb-4">
                Why this match?
              </h2>
              <p className="text-sm text-paper-dim max-w-[60ch]">
                Your {match}% match is guidance, not a guarantee — based on {matchFactors().join(", ").toLowerCase()}.
                Promoters see the same factors when reviewing your application.
              </p>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 h-fit space-y-6">
          <div className="border border-ink-border bg-ink-raised p-6">
            <div className="flex items-center gap-3">
              <img src={venue.image} alt="" className="h-12 w-12 object-cover border border-ink-border" />
              <div>
                <p className="flex items-center gap-1.5 font-display text-lg leading-tight">
                  {venue.name}
                  {venue.verification === "verified" && <VerifiedBadge />}
                </p>
                <p className="text-xs text-paper-dim">{venue.address}</p>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-3 border-t border-ink-border pt-5">
              <img src={promoterAvatarSrc} alt="" className="h-10 w-10 object-cover rounded-full border border-ink-border" />
              <div>
                <p className="flex items-center gap-1.5 text-sm">
                  {promoter.company}
                  {promoter.verification === "verified" && <VerifiedBadge />}
                </p>
                <p className="text-xs text-paper-dim">Posted by {promoter.name}</p>
              </div>
            </div>
          </div>

          <div className="border border-ink-border bg-ink-raised p-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
              {applicationCloseLabel(slot.applicationDeadline)}
            </p>

            {viewingOwnSlot ? (
              <Button href={`/promoter/slot/${slot.id}/applicants`} size="lg" className="w-full mt-4">
                Manage applicants
              </Button>
            ) : me && existingApplication ? (
              <div className="mt-4">
                <p className="font-display text-xl">
                  Application {existingApplication.status.replace("_", " ")}
                </p>
                <Button href="/applications" variant="outline" size="md" className="w-full mt-4">
                  View application
                </Button>
                {existingApplication.status === "booked" && (
                  <BookingActionsLinks
                    application={existingApplication}
                    slot={slot}
                    className="flex items-center gap-4 mt-4 pt-4 border-t border-ink-border"
                  />
                )}
              </div>
            ) : me ? (
              <Button
                onClick={() => setApplyOpen(true)}
                size="lg"
                className="w-full mt-4"
              >
                Apply for support
              </Button>
            ) : null}
            <p className="mt-3 text-center text-[11px] text-paper-dim">No application fees.</p>
          </div>
        </aside>
      </div>

      {me && !viewingOwnSlot && !existingApplication && (
        <div className="fixed bottom-16 lg:hidden inset-x-0 z-20 border-t border-ink-border bg-ink/95 backdrop-blur p-3">
          <Button onClick={() => setApplyOpen(true)} size="lg" className="w-full">
            Apply for support
          </Button>
        </div>
      )}

      {me && <ApplyModal open={applyOpen} onClose={() => setApplyOpen(false)} slot={slot} artist={me} />}
    </div>
  );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">{label}</p>
      <p className="mt-1.5 text-base">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-paper-dim">{hint}</p>}
    </div>
  );
}
