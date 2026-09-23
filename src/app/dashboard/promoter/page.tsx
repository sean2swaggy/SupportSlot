"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { getInvitationsForPromoterSlots, getSlotsForPromoter, getVenues } from "@/lib/queries";
import { toArtist, type ArtistRow } from "@/lib/supabase/mappers";
import { DEFAULT_FALLBACK } from "@/components/ui/AvatarUploadField";
import { formatDate, formatGBP } from "@/lib/utils";
import StatCard from "@/components/ui/StatCard";
import SectionHeading from "@/components/ui/SectionHeading";
import Button from "@/components/ui/Button";
import VerifiedBadge from "@/components/ui/VerifiedBadge";
import MatchBadge from "@/components/ui/MatchBadge";
import AvatarUploadField from "@/components/ui/AvatarUploadField";
import EmailVerifyBanner from "@/components/account/EmailVerifyBanner";
import BookingActionsLinks from "@/components/bookings/BookingActionsLinks";
import type { Artist, GigInvitationForPromoter, SupportSlot, Venue } from "@/lib/types";

const ARTIST_COLUMNS =
  "id, handle, name, image_url, banner_image_url, location, genres, spotify_url, instagram_url, tiktok_url, soundcloud_url, bandcamp_url, youtube_url, website_url, monthly_listeners, bio, live_video_thumbnail_url, live_video_url, availability, travel_radius_miles, verification, artist_size, last_minute_alerts, member_since";

export default function PromoterDashboard() {
  const { currentPromoter, currentPromoterId, applications, promoterAvatar, setPromoterAvatar } =
    useStore();

  const [mySlots, setMySlots] = useState<SupportSlot[]>([]);
  const [venuesById, setVenuesById] = useState<Record<string, Venue>>({});
  const [artistsById, setArtistsById] = useState<Record<string, Artist>>({});
  const [invitations, setInvitations] = useState<GigInvitationForPromoter[]>([]);

  const applicationsForMySlots = useMemo(
    () => applications.filter((a) => mySlots.some((s) => s.id === a.slotId)),
    [applications, mySlots]
  );

  useEffect(() => {
    if (!currentPromoterId) return;
    const supabase = createClient();
    getSlotsForPromoter(supabase, currentPromoterId).then(setMySlots);
    getVenues(supabase).then((venues) =>
      setVenuesById(Object.fromEntries(venues.map((v) => [v.id, v])))
    );
    getInvitationsForPromoterSlots(supabase, currentPromoterId).then(setInvitations);
  }, [currentPromoterId]);

  useEffect(() => {
    const ids = Array.from(new Set(applicationsForMySlots.map((a) => a.artistId)));
    if (ids.length === 0) return;
    const supabase = createClient();
    supabase
      .from("artists")
      .select(ARTIST_COLUMNS)
      .in("id", ids)
      .then(({ data }) => {
        if (!data) return;
        setArtistsById((prev) => ({
          ...prev,
          ...Object.fromEntries((data as ArtistRow[]).map((row) => [row.id, toArtist(row)])),
        }));
      });
  }, [applicationsForMySlots]);

  const openSlots = mySlots.filter((s) => s.status === "open");
  const shortlisted = applicationsForMySlots.filter((a) => a.status === "shortlisted");
  const booked = applicationsForMySlots.filter((a) => a.status === "booked");

  if (!currentPromoter) return null;
  const promoter = currentPromoter;

  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      <div className="flex flex-col sm:flex-row sm:items-center gap-5 justify-between">
        <div className="flex items-center gap-4">
          <AvatarUploadField
            value={promoterAvatar}
            fallbackSrc={promoter.avatar}
            onChange={setPromoterAvatar}
            alt={promoter.company}
            size={72}
          />
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-2">
              My Gigs
            </p>
            <h1 className="font-display uppercase text-3xl sm:text-5xl leading-none flex items-center gap-2">
              {promoter.company}
              {promoter.verification === "verified" && <VerifiedBadge size="md" />}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button href="/dashboard/promoter/roster" variant="outline" size="md">
            Artist roster
          </Button>
          <Button href="/create-slot" size="md">
            Post a support slot
          </Button>
        </div>
      </div>

      <Link
        href="/discover"
        className="mt-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-acid bg-acid/5 px-6 py-5 hover:bg-acid/10 transition-colors group"
      >
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-acid mb-1">
            Find your next support act
          </p>
          <p className="font-display text-xl">Discover artists →</p>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-widest text-acid group-hover:underline shrink-0">
          Browse the platform
        </span>
      </Link>

      <EmailVerifyBanner />

      <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Upcoming shows" value={mySlots.length} />
        <StatCard label="Open support slots" value={openSlots.length} />
        <StatCard label="Total applications" value={applicationsForMySlots.length} />
        <StatCard label="Confirmed support artists" value={booked.length} />
      </div>

      <div id="applicants" className="mt-14 scroll-mt-24">
        <SectionHeading eyebrow="Manage" title="Upcoming shows" />
        <div className="mt-6 space-y-4">
          {mySlots.length === 0 ? (
            <div className="border border-dashed border-ink-border p-10 text-center">
              <p className="font-display text-xl">No shows posted yet</p>
              <Button href="/create-slot" size="md" className="mt-5">
                Post your first slot
              </Button>
            </div>
          ) : (
            mySlots.map((slot) => {
              const venue = venuesById[slot.venueId];
              const slotApps = applications
                .filter((a) => a.slotId === slot.id)
                .sort((a, b) => b.matchPercent - a.matchPercent);
              const bestMatches = slotApps.slice(0, 3);
              const totalApplicants = Math.max(slot.applicantCount, slotApps.length);

              return (
                <div key={slot.id} className="border border-ink-border bg-ink-raised p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-widest text-paper-dim">
                        {slot.city} — {formatDate(slot.date, { withYear: true })}
                        {slot.rescheduledAt && <span className="text-acid"> · rescheduled</span>}
                      </p>
                      <p className="font-display text-2xl mt-1">{slot.headliner}</p>
                      <p className="text-sm text-paper-dim mt-1">
                        {venue?.name} · {formatGBP(slot.supportFee)} support fee
                      </p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="font-display text-2xl">{totalApplicants}</p>
                        <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
                          Applicants
                        </p>
                      </div>
                      <Button href={`/promoter/slot/${slot.id}/applicants`} variant="outline" size="sm">
                        Manage applicants
                      </Button>
                    </div>
                  </div>

                  {bestMatches.length > 0 && (
                    <div className="mt-5 border-t border-ink-border pt-4">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-3">
                        Best matches
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {bestMatches.map((a) => {
                          const artist = artistsById[a.artistId];
                          if (!artist) return null;
                          return (
                            <Link
                              key={a.id}
                              href={`/artist/${artist.handle}`}
                              className="flex items-center gap-2 border border-ink-border px-2.5 py-1.5 hover:border-paper transition-colors"
                            >
                              <img src={artist.image || DEFAULT_FALLBACK} alt="" className="h-6 w-6 object-cover" />
                              <span className="text-xs">{artist.name}</span>
                              <MatchBadge percent={a.matchPercent} size="sm" />
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {shortlisted.length > 0 && (
        <div className="mt-14">
          <SectionHeading eyebrow="Narrowed down" title="Shortlisted artists" />
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {shortlisted.map((a) => {
              const artist = artistsById[a.artistId];
              const slot = mySlots.find((s) => s.id === a.slotId);
              if (!artist || !slot) return null;
              return (
                <Link
                  key={a.id}
                  href={`/promoter/slot/${slot.id}/applicants`}
                  className="flex items-center gap-3 border border-ink-border bg-ink-raised p-4 hover:border-paper transition-colors"
                >
                  <img src={artist.image || DEFAULT_FALLBACK} alt="" className="h-12 w-12 object-cover" />
                  <div className="min-w-0">
                    <p className="text-sm truncate">{artist.name}</p>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim truncate">
                      for {slot.headliner}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {booked.length > 0 && (
        <div className="mt-14">
          <SectionHeading eyebrow="Locked in" title="Confirmed support artists" />
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {booked.map((a) => {
              const artist = artistsById[a.artistId];
              const slot = mySlots.find((s) => s.id === a.slotId);
              if (!artist || !slot) return null;
              return (
                <div key={a.id} className="border border-ok/40 bg-ok/5 p-4">
                  <div className="flex items-center gap-3">
                    <img src={artist.image || DEFAULT_FALLBACK} alt="" className="h-12 w-12 object-cover shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm truncate">{artist.name}</p>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim truncate">
                        {slot.headliner} · {formatDate(slot.date)}
                        {slot.rescheduledAt && <span className="text-acid"> · rescheduled</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-ok/20">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-ok">
                      Paid ✓
                    </p>
                    <BookingActionsLinks application={a} slot={slot} className="flex items-center gap-4" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {invitations.length > 0 && (
        <div className="mt-14">
          <SectionHeading eyebrow="Sent from Discover Artists" title="Recent invitations" />
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {invitations.slice(0, 6).map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 border border-ink-border bg-ink-raised p-4">
                <img src={inv.artist.image || DEFAULT_FALLBACK} alt="" className="h-11 w-11 object-cover shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{inv.artist.name}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim truncate">
                    {mySlots.find((s) => s.id === inv.slotId)?.headliner ?? "Gig"}
                  </p>
                </div>
                <span
                  className={
                    "font-mono text-[10px] uppercase tracking-widest shrink-0 " +
                    (inv.status === "accepted"
                      ? "text-ok"
                      : inv.status === "declined"
                        ? "text-signal"
                        : "text-paper-dim")
                  }
                >
                  {inv.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
