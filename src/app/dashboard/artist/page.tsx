"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { getOpenSlots } from "@/lib/queries";
import { computeMatch } from "@/lib/match";
import StatCard from "@/components/ui/StatCard";
import SectionHeading from "@/components/ui/SectionHeading";
import SlotCard from "@/components/slots/SlotCard";
import ApplicationRow from "@/components/applications/ApplicationRow";
import Button from "@/components/ui/Button";
import VerifiedBadge from "@/components/ui/VerifiedBadge";
import AvatarUploadField from "@/components/ui/AvatarUploadField";
import ArtistLinksEditor from "@/components/artists/ArtistLinksEditor";
import ArtistMonthlyListenersEditor from "@/components/artists/ArtistMonthlyListenersEditor";
import EmailVerifyBanner from "@/components/account/EmailVerifyBanner";
import PayoutPanel from "@/components/payouts/PayoutPanel";
import type { SupportSlot } from "@/lib/types";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function ArtistDashboard() {
  const { currentArtist, currentArtistId, applications, artistAvatar, setArtistAvatar } =
    useStore();
  const me = currentArtist;

  const [openSlots, setOpenSlots] = useState<SupportSlot[]>([]);
  useEffect(() => {
    getOpenSlots(createClient()).then(setOpenSlots);
  }, []);

  const myApplications = useMemo(
    () => applications.filter((a) => a.artistId === currentArtistId),
    [applications, currentArtistId]
  );

  const stats = useMemo(() => {
    const sent = myApplications.length;
    const viewed = myApplications.filter((a) =>
      ["viewed", "shortlisted", "booked"].includes(a.status)
    ).length;
    const shortlisted = myApplications.filter((a) =>
      ["shortlisted", "booked"].includes(a.status)
    ).length;
    const booked = myApplications.filter((a) => a.status === "booked").length;
    return { sent, viewed, shortlisted, booked };
  }, [myApplications]);

  const appliedSlotIds = new Set(myApplications.map((a) => a.slotId));
  const recommended = useMemo(() => {
    if (!me) return [];
    return openSlots
      .filter((s) => !appliedSlotIds.has(s.id))
      .map((s) => ({ slot: s, match: computeMatch(me, s) }))
      .sort((a, b) => b.match - a.match)
      .slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, openSlots, applications]);

  const recentApplications = [...myApplications]
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
    .slice(0, 4);

  if (!me) return null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      <div className="flex flex-col sm:flex-row sm:items-center gap-5 justify-between">
        <div className="flex items-center gap-4">
          <AvatarUploadField
            value={artistAvatar}
            fallbackSrc={me.image}
            onChange={setArtistAvatar}
            alt={me.name}
            size={72}
          />
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-2">
              Artist dashboard
            </p>
            <h1 className="font-display uppercase text-3xl sm:text-5xl leading-none flex items-center gap-2">
              {getGreeting()}, {me.name}.
              {me.verification === "verified" && <VerifiedBadge size="md" />}
            </h1>
          </div>
        </div>
        <Button href={`/artist/${me.handle}`} variant="outline" size="md">
          View public profile
        </Button>
      </div>

      <EmailVerifyBanner />

      <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Applications sent" value={stats.sent} />
        <StatCard label="Viewed" value={stats.viewed} />
        <StatCard label="Shortlisted" value={stats.shortlisted} />
        <StatCard label="Bookings" value={stats.booked} />
      </div>

      <div className="mt-10 space-y-6">
        <PayoutPanel />
        <ArtistMonthlyListenersEditor artist={me} />
        <ArtistLinksEditor artist={me} />
      </div>

      <div className="mt-14">
        <SectionHeading
          eyebrow="Matched for you"
          title="Recommended slots"
          action={
            <Link href="/discover" className="font-mono text-xs uppercase tracking-widest text-acid hover:underline">
              See all slots →
            </Link>
          }
        />
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-5">
          {recommended.map(({ slot, match }) => (
            <SlotCard key={slot.id} slot={slot} matchPercent={match} />
          ))}
        </div>
      </div>

      <div className="mt-14">
        <SectionHeading
          eyebrow="Track your progress"
          title="Your applications"
          action={
            <Link href="/applications" className="font-mono text-xs uppercase tracking-widest text-acid hover:underline">
              View all →
            </Link>
          }
        />
        <div className="mt-6 space-y-3">
          {recentApplications.length === 0 ? (
            <div className="border border-dashed border-ink-border p-10 text-center">
              <p className="font-display text-xl">No applications yet</p>
              <p className="mt-2 text-sm text-paper-dim">
                Browse open slots and apply in under 30 seconds.
              </p>
              <Button href="/discover" size="md" className="mt-5">
                Find a slot
              </Button>
            </div>
          ) : (
            recentApplications.map((a) => <ApplicationRow key={a.id} application={a} />)
          )}
        </div>
      </div>
    </div>
  );
}
