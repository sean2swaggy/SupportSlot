"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { getUrgentSlots } from "@/lib/queries";
import UrgentSlotCard from "@/components/slots/UrgentSlotCard";
import UrgentPulse from "@/components/ui/UrgentPulse";
import SectionHeading from "@/components/ui/SectionHeading";
import { cn } from "@/lib/utils";
import type { SupportSlot } from "@/lib/types";

const GENRE_CHOICES = ["Alternative", "Electronic", "Punk", "Indie", "Hip-Hop", "Experimental"];
const DAY_CHOICES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function LastMinutePage() {
  const { lastMinuteAlertsEnabled, setLastMinuteAlertsEnabled } = useStore();
  const [urgent, setUrgent] = useState<SupportSlot[]>([]);
  useEffect(() => {
    getUrgentSlots(createClient()).then(setUrgent);
  }, []);

  const [maxDistance, setMaxDistance] = useState(60);
  const [genres, setGenres] = useState<string[]>(["Electronic", "Alternative"]);
  const [minFee, setMinFee] = useState(80);
  const [days, setDays] = useState<string[]>(["Fri", "Sat", "Sun"]);
  const [saved, setSaved] = useState(false);

  const toggleGenre = (g: string) =>
    setGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  const toggleDay = (d: string) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const savePreferences = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <section className="border-b border-ink-border bg-signal/5">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-14 sm:py-20">
          <UrgentPulse label="Live now" />
          <h1 className="font-display uppercase text-4xl sm:text-6xl leading-[0.95] tracking-tight mt-4">
            Needed tonight
          </h1>
          <p className="mt-4 max-w-[54ch] text-paper-dim">
            Support acts drop out. When they do, promoters post here — and nearby artists with
            last-minute alerts on get notified first.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-14 sm:py-20">
        <SectionHeading eyebrow={`${urgent.length} open right now`} title="Urgent opportunities" />
        {urgent.length === 0 ? (
          <div className="mt-8 border border-dashed border-ink-border p-10 text-center">
            <p className="font-display text-xl">Nothing urgent right now</p>
            <p className="mt-2 text-sm text-paper-dim">
              Turn on last-minute alerts below and we&rsquo;ll let you know the moment something
              comes up.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-5">
            {urgent.map((slot) => (
              <UrgentSlotCard key={slot.id} slot={slot} />
            ))}
          </div>
        )}

        <div className="mt-16 border-t border-ink-border pt-10">
          <SectionHeading eyebrow="Stay ready" title="Last-minute alerts" />

          <label className="mt-6 flex items-center justify-between border border-ink-border p-4 cursor-pointer">
            <span>
              <span className="block text-sm">Enable last-minute alerts</span>
              <span className="block text-xs text-paper-dim mt-0.5">
                Get notified the moment an urgent slot matches your preferences below. Free for
                every artist.
              </span>
            </span>
            <input
              type="checkbox"
              checked={lastMinuteAlertsEnabled}
              onChange={(e) => setLastMinuteAlertsEnabled(e.target.checked)}
              className="h-5 w-5 accent-[var(--color-acid)] shrink-0"
            />
          </label>

          <div
            className={cn(
              "mt-6 space-y-7 transition-opacity",
              !lastMinuteAlertsEnabled && "opacity-40 pointer-events-none"
            )}
          >
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-3">
                Maximum travel distance: {maxDistance} miles
              </p>
              <input
                type="range"
                min={5}
                max={200}
                step={5}
                value={maxDistance}
                onChange={(e) => setMaxDistance(Number(e.target.value))}
                className="w-full accent-[var(--color-acid)]"
              />
            </div>

            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-3">
                Genres
              </p>
              <div className="flex flex-wrap gap-2">
                {GENRE_CHOICES.map((g) => (
                  <button
                    key={g}
                    onClick={() => toggleGenre(g)}
                    className={cn(
                      "font-mono text-[10px] uppercase tracking-widest px-3 py-2 border transition-colors",
                      genres.includes(g)
                        ? "border-acid text-acid"
                        : "border-ink-border text-paper-dim hover:border-paper"
                    )}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-3">
                Minimum fee: £{minFee}
              </p>
              <input
                type="range"
                min={0}
                max={300}
                step={10}
                value={minFee}
                onChange={(e) => setMinFee(Number(e.target.value))}
                className="w-full accent-[var(--color-acid)]"
              />
            </div>

            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-3">
                Days you&rsquo;re usually available
              </p>
              <div className="flex flex-wrap gap-2">
                {DAY_CHOICES.map((d) => (
                  <button
                    key={d}
                    onClick={() => toggleDay(d)}
                    className={cn(
                      "font-mono text-[10px] uppercase tracking-widest px-3.5 py-2 border transition-colors",
                      days.includes(d)
                        ? "border-acid text-acid"
                        : "border-ink-border text-paper-dim hover:border-paper"
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={savePreferences}
              className="bg-acid text-acid-ink px-6 py-3 font-mono text-xs uppercase tracking-widest"
            >
              {saved ? "Preferences saved ✓" : "Save preferences"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
