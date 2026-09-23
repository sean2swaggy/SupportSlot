import Link from "next/link";
import Button from "@/components/ui/Button";
import SlotCard from "@/components/slots/SlotCard";
import UrgentSlotCard from "@/components/slots/UrgentSlotCard";
import SectionHeading from "@/components/ui/SectionHeading";
import ArtistAvatarImage from "@/components/artists/ArtistAvatarImage";
import ArtistMonthlyListenersLabel from "@/components/artists/ArtistMonthlyListenersLabel";
import { createClient } from "@/lib/supabase/server";
import { getOpenSlots, getUrgentSlots, getFeaturedArtists } from "@/lib/queries";

export default async function Home() {
  const supabase = await createClient();
  const [openSlots, urgent, artists] = await Promise.all([
    getOpenSlots(supabase),
    getUrgentSlots(supabase),
    getFeaturedArtists(supabase),
  ]);
  const featured = openSlots.filter((s) => !s.isUrgent).slice(0, 6);
  const cities = ["London", "Manchester", "Birmingham", "Bristol", "Leeds", "Brighton"];

  return (
    <div>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-ink-border grain">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 pt-16 pb-14 sm:pt-24 sm:pb-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-6">
            A marketplace for support slots
          </p>
          <h1 className="font-display uppercase leading-[0.92] tracking-tight text-balance text-[13vw] sm:text-[9vw] lg:text-[6.4vw]">
            Find your
            <br />
            next stage.
          </h1>
          <p className="mt-8 max-w-[46ch] text-base sm:text-lg text-paper-dim">
            Discover support opportunities. Apply in seconds. Play in front of
            audiences that actually fit your music.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-3">
            <Button href="/discover" size="lg">
              Find Support Slots
            </Button>
            <Button href="/create-slot" variant="outline" size="lg">
              Post a Slot
            </Button>
          </div>

          <div className="mt-16 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-[11px] uppercase tracking-widest text-paper-dim">
            <span>Now booking in</span>
            {cities.map((c) => (
              <span key={c} className="text-paper">
                {c}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURED OPPORTUNITIES */}
      <section className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-16 sm:py-20">
        <SectionHeading
          eyebrow="Open now"
          title="Support needed"
          action={
            <Link
              href="/discover"
              className="font-mono text-xs uppercase tracking-widest text-acid hover:underline"
            >
              View all slots →
            </Link>
          }
        />
        {featured.length === 0 ? (
          <div className="mt-8 border border-dashed border-ink-border p-10 text-center">
            <p className="font-display text-xl">No open slots yet</p>
            <p className="mt-2 text-sm text-paper-dim">
              Be the first to post one, or check back soon.
            </p>
            <Button href="/create-slot" size="md" className="mt-5">
              Post a slot
            </Button>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {featured.map((slot) => (
              <SlotCard key={slot.id} slot={slot} />
            ))}
          </div>
        )}
      </section>

      {/* NEEDED TONIGHT */}
      {urgent.length > 0 && (
        <section className="border-y border-ink-border bg-ink-raised/40">
          <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-16 sm:py-20">
            <SectionHeading
              eyebrow="🚨 Last-minute support"
              title="Needed tonight"
              action={
                <Link
                  href="/last-minute"
                  className="font-mono text-xs uppercase tracking-widest text-signal hover:underline"
                >
                  See all urgent slots →
                </Link>
              }
            />
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-5">
              {urgent.map((slot) => (
                <UrgentSlotCard key={slot.id} slot={slot} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-16 sm:py-20">
        <SectionHeading eyebrow="How it works" title="Play in front of the right room" />
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-8">
          {[
            {
              n: "01",
              t: "Discover a slot",
              d: "Browse support opportunities near you, filtered by genre, date, pay and audience size.",
            },
            {
              n: "02",
              t: "Check your match",
              d: "See a guidance match score based on genre, location, audience compatibility and availability.",
            },
            {
              n: "03",
              t: "Apply in seconds",
              d: "Choose a track and a live clip from your profile. No forms, no repeated info — submit in under 30 seconds.",
            },
          ].map((s) => (
            <div key={s.n} className="border-t border-ink-border pt-5">
              <p className="font-mono text-xs text-acid">{s.n}</p>
              <p className="font-display text-xl mt-3">{s.t}</p>
              <p className="text-sm text-paper-dim mt-2">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ARTIST STRIP */}
      {artists.length > 0 && (
        <section className="border-t border-ink-border">
          <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-16 sm:py-20">
            <SectionHeading
              eyebrow="On the platform"
              title="Independent artists, ready to open"
              action={
                <Link
                  href={`/artist/${artists[0].handle}`}
                  className="font-mono text-xs uppercase tracking-widest text-acid hover:underline"
                >
                  View a sample profile →
                </Link>
              }
            />
            <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
              {artists.map((a) => (
                <Link key={a.id} href={`/artist/${a.handle}`} className="group">
                  <div className="aspect-square overflow-hidden border border-ink-border">
                    <ArtistAvatarImage
                      artistId={a.id}
                      src={a.image}
                      alt={a.name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-widest mt-2 truncate">
                    {a.name}
                  </p>
                  <p className="text-[11px] text-paper-dim">
                    <ArtistMonthlyListenersLabel artist={a} /> listeners
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* NO PAY TO PLAY BANNER */}
      <section className="border-t border-ink-border bg-acid text-acid-ink">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-14 sm:py-16 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <p className="font-display text-2xl sm:text-3xl uppercase leading-tight">
              No pay-to-play. No application fees.
            </p>
            <p className="mt-2 max-w-[52ch] text-sm sm:text-base opacity-80">
              Artists keep their full agreed performance fee. Support Slot charges
              promoters a small booking fee — never the artist.
            </p>
          </div>
          <Button href="/trust" variant="secondary" size="md" className="shrink-0">
            Our trust &amp; safety policy
          </Button>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-20 sm:py-28 text-center">
        <p className="font-display uppercase text-[10vw] sm:text-6xl lg:text-7xl leading-[0.95] text-balance">
          Opening doors
          <br />
          for opening acts.
        </p>
        <div className="mt-9 flex flex-col sm:flex-row justify-center gap-3">
          <Button href="/onboarding?type=artist" size="lg">
            Join as an artist
          </Button>
          <Button href="/onboarding?type=promoter" variant="outline" size="lg">
            Join as a promoter
          </Button>
        </div>
      </section>
    </div>
  );
}
