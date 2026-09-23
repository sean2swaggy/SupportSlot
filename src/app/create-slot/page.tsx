"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { getVenues } from "@/lib/queries";
import Button from "@/components/ui/Button";
import ImageUploadField from "@/components/ui/ImageUploadField";
import { cn } from "@/lib/utils";
import type { Genre, Venue } from "@/lib/types";

const ALL_GENRES: Genre[] = [
  "Alternative",
  "Electronic",
  "Indie",
  "Experimental",
  "Hip-Hop",
  "Punk",
  "Folk",
  "Pop",
  "R&B",
  "Techno",
  "Drum & Bass",
  "Rock",
];

const ARTIST_SIZES: Array<"emerging" | "developing" | "established"> = [
  "emerging",
  "developing",
  "established",
];

function inputCls(extra?: string) {
  return cn(
    "w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60",
    extra
  );
}

function labelCls() {
  return "font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block";
}

export default function CreateSlotPage() {
  const { addSlot } = useStore();
  const router = useRouter();

  const [venues, setVenues] = useState<Venue[]>([]);
  useEffect(() => {
    getVenues(createClient()).then(setVenues);
  }, []);

  const [headliner, setHeadliner] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [artistPhotoDataUrl, setArtistPhotoDataUrl] = useState<string | null>(null);
  const [venueId, setVenueId] = useState("");
  const [date, setDate] = useState("");
  const [doorsTime, setDoorsTime] = useState("19:00");
  const [setTime, setSetTime] = useState("20:00");
  const [performanceLengthMins, setPerformanceLengthMins] = useState(25);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [expectedAttendance, setExpectedAttendance] = useState(250);
  const [supportFee, setSupportFee] = useState(150);
  const [travelContribution, setTravelContribution] = useState(0);
  const MIN_BOOKING_FEE = 10;
  const [bookingFee, setBookingFee] = useState(MIN_BOOKING_FEE);
  const [requirements, setRequirements] = useState("");
  const [applicationDeadline, setApplicationDeadline] = useState("");
  const [artistSizeFit, setArtistSizeFit] = useState<Array<"emerging" | "developing" | "established">>([
    "emerging",
  ]);
  const [description, setDescription] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const effectiveVenueId = venueId || venues[0]?.id || "";
  const venue = venues.find((v) => v.id === effectiveVenueId);
  const canSubmit =
    !!venue && headliner.trim().length > 1 && date && genres.length > 0 && applicationDeadline;

  const toggleGenre = (g: Genre) =>
    setGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  const toggleSize = (s: "emerging" | "developing" | "established") =>
    setArtistSizeFit((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const handleSubmit = async () => {
    if (!canSubmit || !venue) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const seed = headliner.toLowerCase().replace(/[^a-z0-9]/g, "-") || "headliner";
      const slot = await addSlot({
        headliner,
        headlinerImage: imageDataUrl || `https://picsum.photos/seed/ss-created-${seed}/1200/675`,
        venueId: venue.id,
        city: venue.city,
        date,
        doorsTime,
        setTime,
        performanceLengthMins,
        genres,
        expectedAttendance,
        supportFee,
        travelContribution,
        bookingFee: Math.max(MIN_BOOKING_FEE, bookingFee),
        artistPhoto: artistPhotoDataUrl || undefined,
        requirements: requirements
          .split("\n")
          .map((r) => r.trim())
          .filter(Boolean),
        applicationDeadline,
        isUrgent,
        artistSizeFit: artistSizeFit.length > 0 ? artistSizeFit : ["emerging"],
        description: description || `${headliner} are looking for a support act at ${venue.name}.`,
      });
      setCreated(slot.id);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Couldn't post that slot — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    return (
      <div className="mx-auto max-w-[600px] px-4 sm:px-6 lg:px-10 py-24 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center border border-acid text-acid">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M4 12.5 9.5 18 20 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="font-display text-3xl mt-6">Slot posted</p>
        <p className="mt-3 text-paper-dim">
          Your support slot for {headliner} is live. Artists can start applying immediately.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={() => router.push(`/slot/${created}`)} size="md">
            View live listing
          </Button>
          <Button
            onClick={() => router.push(`/promoter/slot/${created}/applicants`)}
            variant="outline"
            size="md"
          >
            Manage applicants
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[760px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">
        Post a slot
      </p>
      <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">
        Create a support slot
      </h1>
      <p className="mt-4 max-w-[54ch] text-paper-dim">
        Tell artists what you need — the clearer the brief, the better the matches.
      </p>

      <div className="mt-10 space-y-8">
        <div>
          <label className={labelCls()}>Headliner / show name</label>
          <input
            className={inputCls()}
            value={headliner}
            onChange={(e) => setHeadliner(e.target.value)}
            placeholder="e.g. Field Mode"
          />
        </div>

        <ImageUploadField value={imageDataUrl} onChange={setImageDataUrl} />

        <ImageUploadField
          value={artistPhotoDataUrl}
          onChange={setArtistPhotoDataUrl}
          label="Reference photo of the artist you're picturing (optional)"
          hint="Gives applicants a feel for the vibe you're after — a photo of a similar act, not the headliner. Totally optional."
          placeholderNote=""
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label className={labelCls()}>Venue</label>
            <select
              className={inputCls("appearance-none")}
              value={effectiveVenueId}
              onChange={(e) => setVenueId(e.target.value)}
            >
              {venues.map((v) => (
                <option key={v.id} value={v.id} className="bg-ink-card">
                  {v.name} — {v.city} ({v.capacity} cap)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls()}>Show date</label>
            <input
              type="date"
              className={inputCls()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
          <div>
            <label className={labelCls()}>Doors</label>
            <input type="time" className={inputCls()} value={doorsTime} onChange={(e) => setDoorsTime(e.target.value)} />
          </div>
          <div>
            <label className={labelCls()}>Set time</label>
            <input type="time" className={inputCls()} value={setTime} onChange={(e) => setSetTime(e.target.value)} />
          </div>
          <div>
            <label className={labelCls()}>Set length (min)</label>
            <input
              type="number"
              min={10}
              max={60}
              className={inputCls()}
              value={performanceLengthMins}
              onChange={(e) => setPerformanceLengthMins(Number(e.target.value))}
            />
          </div>
          <div>
            <label className={labelCls()}>Attendance</label>
            <input
              type="number"
              min={20}
              className={inputCls()}
              value={expectedAttendance}
              onChange={(e) => setExpectedAttendance(Number(e.target.value))}
            />
          </div>
        </div>

        <div>
          <label className={labelCls()}>Genres this slot suits</label>
          <div className="flex flex-wrap gap-2">
            {ALL_GENRES.map((g) => (
              <button
                key={g}
                type="button"
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
          <label className={labelCls()}>Suits which artist size?</label>
          <div className="flex flex-wrap gap-2">
            {ARTIST_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleSize(s)}
                className={cn(
                  "font-mono text-[10px] uppercase tracking-widest px-3 py-2 border capitalize transition-colors",
                  artistSizeFit.includes(s)
                    ? "border-acid text-acid"
                    : "border-ink-border text-paper-dim hover:border-paper"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <label className={labelCls()}>Support fee (£)</label>
            <input
              type="number"
              min={0}
              className={inputCls()}
              value={supportFee}
              onChange={(e) => setSupportFee(Number(e.target.value))}
            />
          </div>
          <div>
            <label className={labelCls()}>Travel contribution (£)</label>
            <input
              type="number"
              min={0}
              className={inputCls()}
              value={travelContribution}
              onChange={(e) => setTravelContribution(Number(e.target.value))}
            />
            <p className="mt-2 text-[11px] text-paper-dim">
              If an artist is travelling over an hour to reach {venue?.city ?? "the venue"}, Support
              Slot automatically tops this up to a £10 minimum on their behalf.
            </p>
          </div>
          <div>
            <label className={labelCls()}>Support Slot booking fee (£)</label>
            <input
              type="number"
              min={MIN_BOOKING_FEE}
              className={inputCls()}
              value={bookingFee}
              onChange={(e) => setBookingFee(Number(e.target.value))}
              onBlur={() => setBookingFee((f) => Math.max(MIN_BOOKING_FEE, f || 0))}
            />
            <p className="mt-2 text-[11px] text-paper-dim">
              What Support Slot charges you for this booking, on top of the artist&rsquo;s fee — never
              deducted from the artist. £{MIN_BOOKING_FEE} minimum.
            </p>
          </div>
          <div>
            <label className={labelCls()}>Applications close</label>
            <input
              type="date"
              className={inputCls()}
              value={applicationDeadline}
              onChange={(e) => setApplicationDeadline(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className={labelCls()}>Requirements (one per line)</label>
          <textarea
            className={inputCls()}
            rows={3}
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
            placeholder={"Own backline preferred\n25 min set\nLoad in from 17:30"}
          />
        </div>

        <div>
          <label className={labelCls()}>Description</label>
          <textarea
            className={inputCls()}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What are you looking for in a support act?"
          />
        </div>

        <label className="flex items-center gap-3 border border-ink-border p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={isUrgent}
            onChange={(e) => setIsUrgent(e.target.checked)}
            className="accent-[var(--color-signal)]"
          />
          <span className="text-sm">
            🚨 This is last-minute — post to{" "}
            <span className="text-signal">Needed Tonight</span> so nearby artists get an urgent alert
          </span>
        </label>

        {submitError && <p className="text-sm text-signal">{submitError}</p>}
        <Button size="lg" className="w-full" disabled={!canSubmit || submitting} onClick={handleSubmit}>
          {submitting ? "Posting…" : "Post support slot"}
        </Button>
        <p className="text-center text-[11px] text-paper-dim">
          No listing fees. No pay-to-play. Ever.
        </p>
      </div>
    </div>
  );
}
