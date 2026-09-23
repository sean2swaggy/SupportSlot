"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { toArtist, type ArtistRow } from "@/lib/supabase/mappers";
import { formatDate, formatGBP } from "@/lib/utils";
import ArtistCard from "@/components/artists/ArtistCard";
import StatusPill from "@/components/applications/StatusPill";
import Button from "@/components/ui/Button";
import BookModal from "@/components/BookModal";
import BookingActionsLinks from "@/components/bookings/BookingActionsLinks";
import SaveToRosterButton from "@/components/roster/SaveToRosterButton";
import SectionHeading from "@/components/ui/SectionHeading";
import type { Artist, SupportSlot, Venue, Application } from "@/lib/types";

const ARTIST_COLUMNS =
  "id, handle, name, image_url, banner_image_url, location, genres, spotify_url, instagram_url, tiktok_url, soundcloud_url, bandcamp_url, youtube_url, website_url, monthly_listeners, bio, live_video_thumbnail_url, live_video_url, availability, travel_radius_miles, verification, artist_size, last_minute_alerts, member_since";

export default function ApplicantManagementClient({
  slot,
  venue,
}: {
  slot: SupportSlot;
  venue: Venue;
}) {
  const { applications, updateApplicationStatus } = useStore();
  const [bookTarget, setBookTarget] = useState<Application | null>(null);
  const [artistsById, setArtistsById] = useState<Record<string, Artist>>({});

  const slotApplicationRows = useMemo(
    () => applications.filter((a) => a.slotId === slot.id),
    [applications, slot.id]
  );

  useEffect(() => {
    const ids = Array.from(new Set(slotApplicationRows.map((a) => a.artistId)));
    const missing = ids.filter((id) => !artistsById[id]);
    if (missing.length === 0) return;
    createClient()
      .from("artists")
      .select(ARTIST_COLUMNS)
      .in("id", missing)
      .then(({ data }) => {
        if (!data) return;
        setArtistsById((prev) => ({
          ...prev,
          ...Object.fromEntries((data as ArtistRow[]).map((row) => [row.id, toArtist(row)])),
        }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotApplicationRows]);

  const slotApplications = useMemo(
    () =>
      slotApplicationRows
        .map((a) => ({ application: a, artist: artistsById[a.artistId] }))
        .filter((x): x is { application: Application; artist: Artist } => !!x.artist)
        .sort((a, b) => b.application.matchPercent - a.application.matchPercent),
    [slotApplicationRows, artistsById]
  );

  const bestMatches = slotApplications.slice(0, 3);
  const alreadyBooked = slotApplications.some((x) => x.application.status === "booked");

  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      <Link
        href="/dashboard/promoter"
        className="font-mono text-[11px] uppercase tracking-widest text-paper-dim hover:text-paper"
      >
        ← Back to dashboard
      </Link>

      <div className="mt-4 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-2">
            Applicant management
          </p>
          <h1 className="font-display uppercase text-3xl sm:text-5xl leading-none">
            {slot.headliner}
          </h1>
          <p className="mt-3 text-paper-dim">
            {venue.name}, {slot.city} · {formatDate(slot.date, { withYear: true })} ·{" "}
            {formatGBP(slot.supportFee)} support fee
            {slot.rescheduledAt && <span className="text-acid"> · rescheduled</span>}
          </p>
        </div>
        <div className="flex items-end gap-4 shrink-0">
          <Link
            href={`/promoter/slot/${slot.id}/schedule`}
            className="font-mono text-[10px] uppercase tracking-widest border border-ink-border px-3.5 py-2.5 hover:border-acid hover:text-acid transition-colors"
          >
            Show Schedule
          </Link>
          <div className="text-right">
            <p className="font-display text-4xl">{slot.applicantCount}</p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
              Total applicants
            </p>
          </div>
        </div>
      </div>

      {alreadyBooked && (
        <div className="mt-8 border border-ok/50 bg-ok/10 px-4 py-3">
          <p className="font-mono text-xs uppercase tracking-widest text-ok">
            Support act booked for this show
          </p>
          {(() => {
            const booked = slotApplications.find((x) => x.application.status === "booked");
            if (!booked) return null;
            return (
              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-ok/20">
                <p className="font-mono text-[10px] uppercase tracking-widest text-ok">Paid ✓</p>
                <BookingActionsLinks application={booked.application} slot={slot} className="flex items-center gap-4" />
              </div>
            );
          })()}
        </div>
      )}

      {bestMatches.length > 0 && (
        <div className="mt-10">
          <SectionHeading eyebrow="Skip the scroll" title="Best matches" />
          <p className="mt-3 text-sm text-paper-dim max-w-[60ch]">
            Instead of reading through {slot.applicantCount} applications, here are the strongest
            fits based on genre, location, audience compatibility, artist size and availability.
          </p>
          <div className="mt-6 space-y-4">
            {bestMatches.map(({ application, artist }) => (
              <ArtistCard key={application.id} artist={artist} matchPercent={application.matchPercent}>
                <ActionButtons
                  application={application}
                  artistId={artist.id}
                  disabled={alreadyBooked}
                  onShortlist={() => updateApplicationStatus(application.id, "shortlisted")}
                  onBook={() => setBookTarget(application)}
                />
              </ArtistCard>
            ))}
          </div>
        </div>
      )}

      <div className="mt-12">
        <SectionHeading eyebrow="Every applicant" title={`All applications (${slotApplications.length})`} />
        <div className="mt-6 space-y-4">
          {slotApplications.length === 0 ? (
            <p className="text-sm text-paper-dim">No applications yet.</p>
          ) : (
            slotApplications.map(({ application, artist }) => (
              <ArtistCard key={application.id} artist={artist} matchPercent={application.matchPercent}>
                <ActionButtons
                  application={application}
                  artistId={artist.id}
                  disabled={alreadyBooked}
                  onShortlist={() => updateApplicationStatus(application.id, "shortlisted")}
                  onBook={() => setBookTarget(application)}
                />
              </ArtistCard>
            ))
          )}
        </div>
      </div>

      {bookTarget && artistsById[bookTarget.artistId] && (
        <BookModal
          open={!!bookTarget}
          onClose={() => setBookTarget(null)}
          artist={artistsById[bookTarget.artistId]}
          slot={slot}
          application={bookTarget}
        />
      )}
    </div>
  );
}

function ActionButtons({
  application,
  artistId,
  disabled,
  onShortlist,
  onBook,
}: {
  application: Application;
  artistId: string;
  disabled: boolean;
  onShortlist: () => void;
  onBook: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill status={application.status} />
      <button
        onClick={onShortlist}
        disabled={disabled || application.status === "shortlisted" || application.status === "booked"}
        className="font-mono text-[10px] uppercase tracking-widest border border-ink-border px-3 py-2 hover:border-paper transition-colors disabled:opacity-30"
      >
        Shortlist
      </button>
      <Link
        href="/messages"
        className="font-mono text-[10px] uppercase tracking-widest border border-ink-border px-3 py-2 hover:border-paper transition-colors"
      >
        Message
      </Link>
      <Button
        size="sm"
        variant="primary"
        onClick={onBook}
        disabled={disabled || application.status === "booked"}
      >
        {application.status === "booked" ? "Booked" : "Book"}
      </Button>
      <SaveToRosterButton artistId={artistId} size="sm" />
    </div>
  );
}
