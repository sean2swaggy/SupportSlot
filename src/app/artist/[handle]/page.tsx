import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getArtistByHandle } from "@/lib/queries";
import { formatDate } from "@/lib/utils";
import VerifiedBadge from "@/components/ui/VerifiedBadge";
import ArtistAvatarImage from "@/components/artists/ArtistAvatarImage";
import ArtistMonthlyListenersLabel from "@/components/artists/ArtistMonthlyListenersLabel";
import { ArtistListenButton, ArtistSocialLinksRow } from "@/components/artists/ArtistLinksDisplay";
import ShareButton from "@/components/artists/ShareButton";
import SaveToRosterButton from "@/components/roster/SaveToRosterButton";
import { cn } from "@/lib/utils";

const AVAILABILITY_LABEL: Record<string, { label: string; className: string }> = {
  available: { label: "Available for support", className: "text-acid border-acid" },
  limited: { label: "Limited availability", className: "text-paper border-paper-dim" },
  unavailable: { label: "Not currently available", className: "text-paper-dim border-ink-border" },
};

export default async function ArtistProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const supabase = await createClient();
  const artist = await getArtistByHandle(supabase, handle);
  if (!artist) notFound();

  const availability = AVAILABILITY_LABEL[artist.availability];

  return (
    <div>
      <div className="relative h-56 sm:h-72 w-full overflow-hidden border-b border-ink-border bg-ink-raised">
        {artist.bannerImage && (
          <img src={artist.bannerImage} alt="" className="h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
      </div>

      <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-10">
        <div className="flex flex-col sm:flex-row sm:items-end gap-5 -mt-16 sm:-mt-20 relative">
          <div className="h-32 w-32 sm:h-40 sm:w-40 shrink-0 overflow-hidden border-4 border-ink bg-ink">
            <ArtistAvatarImage
              artistId={artist.id}
              src={artist.image}
              alt={artist.name}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex-1 sm:pb-2">
            <div className="flex items-center gap-2">
              <h1 className="font-display uppercase text-3xl sm:text-4xl leading-none">
                {artist.name}
              </h1>
              {artist.verification === "verified" && <VerifiedBadge size="md" />}
            </div>
            <p className="mt-2 text-paper-dim">
              {artist.location}, UK · {artist.genres.join(" / ")}
            </p>
          </div>
          <div className="flex gap-3 sm:pb-2">
            <ArtistListenButton artist={artist} size="md" />
            <SaveToRosterButton artistId={artist.id} />
            <ShareButton />
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <span
            className={cn(
              "inline-flex items-center border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest",
              availability.className
            )}
          >
            {availability.label}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-widest text-paper-dim">
            <ArtistMonthlyListenersLabel artist={artist} /> monthly listeners
          </span>
          <span className="font-mono text-[11px] uppercase tracking-widest text-paper-dim">
            Travels up to {artist.travelRadiusMiles} miles
          </span>
          <ArtistSocialLinksRow artist={artist} className="flex flex-wrap items-center gap-3 ml-auto" />
        </div>

        <section className="mt-10 max-w-[65ch]">
          <p className="text-paper leading-relaxed">{artist.bio}</p>
        </section>

        <section className="mt-14">
          <h2 className="font-mono text-[11px] uppercase tracking-widest text-paper-dim mb-4">
            Featured tracks
          </h2>
          <div className="border border-ink-border divide-y divide-ink-border">
            {artist.tracks.map((t, i) => (
              <div key={t.id} className="flex items-center gap-4 p-4">
                <span className="font-mono text-xs text-paper-dim w-5">{String(i + 1).padStart(2, "0")}</span>
                <img src={t.coverImage} alt="" className="h-12 w-12 object-cover border border-ink-border" />
                <span className="flex-1 font-display text-lg">{t.title}</span>
                <span className="font-mono text-xs text-paper-dim">{t.duration}</span>
              </div>
            ))}
          </div>
        </section>

        {artist.liveVideoThumbnail && (
          <section className="mt-14">
            <h2 className="font-mono text-[11px] uppercase tracking-widest text-paper-dim mb-4">
              Live performance
            </h2>
            <div className="relative aspect-video overflow-hidden border border-ink-border">
              <img src={artist.liveVideoThumbnail} alt="Live performance" className="h-full w-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center bg-ink/30">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-paper/90 text-ink">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l12-7Z" />
                  </svg>
                </span>
              </div>
            </div>
          </section>
        )}

        <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 gap-10">
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-widest text-paper-dim mb-4">
              Previous shows
            </h2>
            {artist.pastShows.length === 0 ? (
              <p className="text-sm text-paper-dim">No previous shows listed yet.</p>
            ) : (
              <ul className="space-y-3">
                {artist.pastShows.map((s) => (
                  <li key={s.id} className="border-b border-ink-border pb-3">
                    <p className="text-sm">
                      Supported <span className="text-paper">{s.headliner}</span>
                    </p>
                    <p className="font-mono text-[11px] uppercase tracking-widest text-paper-dim mt-1">
                      {s.venue}, {s.city} · {formatDate(s.date, { withYear: true })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-widest text-paper-dim mb-4">
              Upcoming shows
            </h2>
            {artist.upcomingShows.length === 0 ? (
              <p className="text-sm text-paper-dim">Nothing confirmed yet — check back soon.</p>
            ) : (
              <ul className="space-y-3">
                {artist.upcomingShows.map((s) => (
                  <li key={s.id} className="border-b border-ink-border pb-3">
                    <p className="text-sm">
                      Supporting <span className="text-paper">{s.headliner}</span>
                    </p>
                    <p className="font-mono text-[11px] uppercase tracking-widest text-paper-dim mt-1">
                      {s.venue}, {s.city} · {formatDate(s.date, { withYear: true })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="mt-16 mb-8 border-t border-ink-border pt-6">
          <Link href="/discover" className="font-mono text-xs uppercase tracking-widest text-acid hover:underline">
            ← Back to Find a Slot
          </Link>
        </div>
      </div>
    </div>
  );
}
