"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { getOpenSlots } from "@/lib/queries";
import { explainFit, fitRank } from "@/lib/fit";
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
import { profileChecklist, profileCompletion } from "@/lib/profile";
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
    // "Viewed" counts applications a promoter genuinely opened (viewedAt is
    // only ever set by the server when they did), including ones that later
    // moved on.
    const viewed = myApplications.filter((a) => !!a.viewedAt).length;
    const shortlisted = myApplications.filter((a) => ["shortlisted", "offered", "confirmed"].includes(a.status)).length;
    const booked = myApplications.filter((a) => a.status === "confirmed").length;
    return { sent, viewed, shortlisted, booked };
  }, [myApplications]);

  const appliedSlotIds = new Set(myApplications.map((a) => a.slotId));
  const recommended = useMemo(() => {
    if (!me) return [];
    return openSlots
      .filter((s) => !appliedSlotIds.has(s.id))
      .map((s) => ({ slot: s, fit: explainFit(me, s) }))
      .sort((a, b) => fitRank(b.fit) - fitRank(a.fit))
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
        <div className="flex gap-3">
          <Button href="/dashboard/artist/profile" variant="outline" size="md">
            Edit profile
          </Button>
          <Button href={`/artist/${me.handle}`} variant="outline" size="md">
            View public profile
          </Button>
        </div>
      </div>

      <EmailVerifyBanner />

      {(() => {
        const items = profileChecklist(me);
        const { done, total } = profileCompletion(items);
        const next = items.find((i) => !i.done);
        if (!next) return null;
        return (
          <Link href="/dashboard/artist/profile" className="mt-8 flex items-center justify-between gap-4 border border-acid/50 bg-acid/5 px-5 py-4 hover:bg-acid/10 transition-colors">
            <span className="text-sm">
              <span className="font-mono text-[10px] uppercase tracking-widest text-acid block mb-0.5">Profile {done}/{total}</span>
              Next: {next.label.toLowerCase()}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-widest text-acid shrink-0">Finish profile →</span>
          </Link>
        );
      })()}

      <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Applications sent" value={stats.sent} />
        <StatCard label="Viewed" value={stats.viewed} />
        <StatCard label="Shortlisted" value={stats.shortlisted} />
        <StatCard label="Bookings" value={stats.booked} />
      </div>

      <div className="mt-10 space-y-6">
        <Suspense fallback={null}>
          <PayoutPanel />
        </Suspense>
        <ArtistMonthlyListenersEditor artist={me} />
        <ArtistLinksEditor artist={me} />
      </div>

      <div className="mt-14">
        <SectionHeading
          eyebrow="Based on your profile"
          title="Slots that may suit you"
          action={
            <Link href="/discover" className="font-mono text-xs uppercase tracking-widest text-acid hover:underline">
              See all slots →
            </Link>
          }
        />
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-5">
          {recommended.length === 0 && (
            <p className="text-sm text-paper-dim sm:col-span-3">No open slots to suggest right now — check back soon or browse everything.</p>
          )}
          {recommended.map(({ slot, fit }) => (
            <SlotCard key={slot.id} slot={slot} fit={fit} />
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
