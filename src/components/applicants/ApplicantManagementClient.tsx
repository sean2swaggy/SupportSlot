"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { toArtist, type ArtistRow } from "@/lib/supabase/mappers";
import { formatDate, formatGBP } from "@/lib/utils";
import ArtistCard from "@/components/artists/ArtistCard";
import StatusPill, { OPEN_STATUSES } from "@/components/applications/StatusPill";
import { PromoterApplicantControls } from "@/components/bookings/BookingControls";
import RescheduleListing from "@/components/bookings/RescheduleListing";
import { explainFit } from "@/lib/fit";
import { markApplicationViewed } from "@/lib/actions";
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
  const router = useRouter();
  const { applications, bookings, refreshApplications } = useStore();
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
        // Live applications first (oldest first, so nobody is overlooked),
        // then the closed ones.
        .sort((a, b) => {
          const aOpen = OPEN_STATUSES.includes(a.application.status) || a.application.status === "confirmed" ? 0 : 1;
          const bOpen = OPEN_STATUSES.includes(b.application.status) || b.application.status === "confirmed" ? 0 : 1;
          if (aOpen !== bOpen) return aOpen - bOpen;
          return new Date(a.application.submittedAt).getTime() - new Date(b.application.submittedAt).getTime();
        }),
    [slotApplicationRows, artistsById]
  );

  const confirmed = slotApplications.find((x) => x.application.status === "confirmed");
  const slotOpen = slot.status === "open";

  // A promoter opening this page is what makes "viewed" true: mark every
  // still-"submitted" application as viewed (idempotent on the server), then
  // re-read. Only the slot's owner can do this — the function checks.
  const unviewedIds = slotApplicationRows.filter((a) => a.status === "submitted").map((a) => a.id).join(",");
  useEffect(() => {
    if (!unviewedIds) return;
    const supabase = createClient();
    Promise.all(unviewedIds.split(",").map((id) => markApplicationViewed(supabase, id)))
      .then(() => refreshApplications())
      .catch(() => undefined);
  }, [unviewedIds, refreshApplications]);

  const bookingFor = (applicationId: string) =>
    bookings.find((b) => b.applicationId === applicationId && (b.status === "offered" || b.status === "confirmed" || b.status === "cancelled"));

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

      {slot.status !== "open" && (
        <div className="mt-8 border border-ink-border px-4 py-3 text-sm text-paper-dim">
          {slot.status === "filled" && "This slot is filled."}
          {slot.status === "closed" && "This listing is closed to new applications."}
          {slot.status === "cancelled" && "This listing was cancelled."}
        </div>
      )}

      {confirmed && (
        <div className="mt-8 border border-ok/50 bg-ok/10 px-4 py-3">
          <p className="font-mono text-xs uppercase tracking-widest text-ok">
            {confirmed.artist.name} is confirmed for this show
          </p>
          <div className="mt-3 pt-3 border-t border-ok/20">
            <RescheduleListing slot={slot} onChanged={() => router.refresh()} />
          </div>
        </div>
      )}
      {!confirmed && slot.status === "open" && (
        <div className="mt-8">
          <RescheduleListing slot={slot} onChanged={() => router.refresh()} />
        </div>
      )}

      <div className="mt-12">
        <SectionHeading eyebrow="Every applicant" title={`All applications (${slotApplications.length})`} />
        <div className="mt-6 space-y-4">
          {slotApplications.length === 0 ? (
            <p className="text-sm text-paper-dim">No applications yet.</p>
          ) : (
            slotApplications.map(({ application, artist }) => (
              <ArtistCard key={application.id} artist={artist} fit={explainFit(artist, slot)}>
                <div className="w-full space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={application.status} />
                    <SaveToRosterButton artistId={artist.id} size="sm" />
                  </div>
                  {application.message && <p className="text-sm border-l-2 border-ink-border pl-3">&ldquo;{application.message}&rdquo;</p>}
                  <PromoterApplicantControls
                    application={application}
                    booking={bookingFor(application.id)}
                    slotOpen={slotOpen}
                  />
                </div>
              </ArtistCard>
            ))
          )}
        </div>
      </div>

    </div>
  );
}
