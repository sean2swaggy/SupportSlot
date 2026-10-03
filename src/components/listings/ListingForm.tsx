"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { getVenues } from "@/lib/queries";
import { updateListing } from "@/lib/actions";
import { londonToday } from "@/lib/dates";
import { friendlyError } from "@/lib/errors";
import { MIN_BOOKING_FEE, parseRequirements, validateListing, type ListingDraft, type ListingErrors } from "@/lib/listing";
import Button from "@/components/ui/Button";
import ImageUploadField from "@/components/ui/ImageUploadField";
import SlotCard from "@/components/slots/SlotCard";
import { formatDate, formatGBP, cn } from "@/lib/utils";
import type { Genre, SupportSlot, Venue } from "@/lib/types";

const ALL_GENRES: Genre[] = ["Alternative", "Electronic", "Indie", "Experimental", "Hip-Hop", "Punk", "Folk", "Pop", "R&B", "Techno", "Drum & Bass", "Rock"];
const ARTIST_SIZES = ["emerging", "developing", "established"] as const;

const inputCls = (extra?: string) =>
  cn("w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60 disabled:opacity-50", extra);
const labelCls = "font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 text-xs text-signal" role="alert">
      {message}
    </p>
  );
}

function draftFromSlot(slot: SupportSlot): ListingDraft {
  return {
    headliner: slot.headliner,
    venueId: slot.venueId,
    date: slot.date,
    doorsTime: slot.doorsTime,
    setTime: slot.setTime,
    performanceLengthMins: slot.performanceLengthMins,
    expectedAttendance: slot.expectedAttendance,
    genres: slot.genres,
    artistSizeFit: slot.artistSizeFit,
    supportFee: slot.supportFee,
    travelContribution: slot.travelContribution,
    bookingFee: slot.bookingFee,
    applicationDeadline: slot.applicationDeadline,
    requirementsText: slot.requirements.join("\n"),
    description: slot.description,
    isUrgent: slot.isUrgent,
  };
}

const EMPTY: ListingDraft = {
  headliner: "",
  venueId: "",
  date: "",
  doorsTime: "19:00",
  setTime: "20:00",
  performanceLengthMins: 25,
  expectedAttendance: 250,
  genres: [],
  artistSizeFit: ["emerging"],
  supportFee: 150,
  travelContribution: 0,
  bookingFee: MIN_BOOKING_FEE,
  applicationDeadline: "",
  requirementsText: "",
  description: "",
  isUrgent: false,
};

/**
 * One form for creating and editing a listing: fill it in, review a preview
 * of exactly what artists will see, then publish (or save). Field errors
 * appear next to the field; anything the server still refuses is shown in
 * full above the button. Nothing is reported as saved until the server has
 * saved it.
 */
export default function ListingForm({
  mode,
  existing,
  materialLocked = false,
}: {
  mode: "create" | "edit";
  existing?: SupportSlot;
  /** An offer or confirmed booking exists: date, venue, times and money are frozen. */
  materialLocked?: boolean;
}) {
  const { addSlot } = useStore();
  const router = useRouter();
  const [today] = useState(() => londonToday());

  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [venuesError, setVenuesError] = useState(false);
  useEffect(() => {
    getVenues(createClient())
      .then(setVenues)
      .catch(() => setVenuesError(true));
  }, []);

  const [draft, setDraft] = useState<ListingDraft>(() => (existing ? draftFromSlot(existing) : EMPTY));
  const [image, setImage] = useState<string | null>(existing?.headlinerImage || null);
  const [artistPhoto, setArtistPhoto] = useState<string | null>(existing?.artistPhoto || null);
  const [step, setStep] = useState<"edit" | "preview">("edit");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string } | null>(null);

  const set = <K extends keyof ListingDraft>(key: K, value: ListingDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const num = (v: string) => (v === "" ? NaN : Number(v));

  const venueId = draft.venueId || venues?.[0]?.id || "";
  const effective = useMemo(() => ({ ...draft, venueId }), [draft, venueId]);
  const venue = venues?.find((v) => v.id === venueId);
  const errors: ListingErrors = useMemo(
    () => validateListing(effective, today, existing ? { date: existing.date, applicationDeadline: existing.applicationDeadline } : undefined),
    [effective, today, existing]
  );
  const hasErrors = Object.keys(errors).length > 0;
  const show = (k: keyof ListingDraft) => (touched ? errors[k] : undefined);

  const previewSlot: SupportSlot | null = venue
    ? {
        id: existing?.id ?? "preview",
        headliner: effective.headliner.trim() || "Your headliner",
        headlinerImage: image ?? "",
        artistPhoto: artistPhoto ?? undefined,
        promoterId: existing?.promoterId ?? "",
        venueId: venue.id,
        venue,
        city: venue.city,
        date: effective.date || today,
        doorsTime: effective.doorsTime,
        setTime: effective.setTime,
        performanceLengthMins: effective.performanceLengthMins,
        genres: effective.genres,
        expectedAttendance: effective.expectedAttendance,
        supportFee: effective.supportFee,
        travelContribution: effective.travelContribution,
        bookingFee: effective.bookingFee,
        requirements: parseRequirements(effective.requirementsText),
        applicationDeadline: effective.applicationDeadline || today,
        applicantCount: existing?.applicantCount ?? 0,
        isUrgent: effective.isUrgent,
        postedAt: existing?.postedAt ?? new Date(0).toISOString(),
        status: existing?.status ?? "open",
        artistSizeFit: effective.artistSizeFit,
        description: effective.description,
      }
    : null;

  const toPreview = () => {
    setTouched(true);
    if (hasErrors || !venue) {
      document.getElementById("listing-form-top")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    setStep("preview");
    window.scrollTo({ top: 0 });
  };

  const publish = async () => {
    if (!venue || submitting) return; // repeat clicks while saving
    setSubmitError(null);
    setSubmitting(true);
    try {
      const common = {
        headliner: effective.headliner.trim(),
        venueId: venue.id,
        city: venue.city,
        date: effective.date,
        doorsTime: effective.doorsTime,
        setTime: effective.setTime,
        performanceLengthMins: effective.performanceLengthMins,
        genres: effective.genres,
        expectedAttendance: effective.expectedAttendance,
        supportFee: effective.supportFee,
        travelContribution: effective.travelContribution,
        bookingFee: effective.bookingFee,
        requirements: parseRequirements(effective.requirementsText),
        applicationDeadline: effective.applicationDeadline,
        isUrgent: effective.isUrgent,
        artistSizeFit: effective.artistSizeFit.length > 0 ? effective.artistSizeFit : (["emerging"] as Array<"emerging">),
        description: effective.description.trim() || `${effective.headliner.trim()} are looking for a support act at ${venue.name}.`,
      };
      if (mode === "edit" && existing) {
        const result = await updateListing(createClient(), existing.id, {
          ...common,
          headlinerImage: image,
          artistPhoto,
        });
        if (!result.ok) {
          setSubmitError(result.error);
          return;
        }
        setDone({ id: existing.id });
      } else {
        // No stock photo is invented: without an upload the listing shows
        // the neutral placeholder.
        const slot = await addSlot({ ...common, headlinerImage: image ?? "", artistPhoto: artistPhoto ?? undefined });
        setDone({ id: slot.id });
      }
    } catch (err) {
      setSubmitError(friendlyError(err, "We couldn't save that listing. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-[600px] px-4 sm:px-6 lg:px-10 py-24 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center border border-acid text-acid">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M4 12.5 9.5 18 20 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="font-display text-3xl mt-6">{mode === "edit" ? "Changes saved" : "Listing published"}</p>
        <p className="mt-3 text-paper-dim">
          {mode === "edit"
            ? "Artists who've applied are notified if the date, venue, times or money changed."
            : `Your listing for ${effective.headliner.trim()} is live. Artists can apply straight away.`}
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={() => router.push(`/slot/${done.id}`)} size="md">View listing</Button>
          <Button onClick={() => router.push(`/promoter/slot/${done.id}/applicants`)} variant="outline" size="md">Manage applicants</Button>
        </div>
      </div>
    );
  }

  if (venuesError) {
    return (
      <div className="mx-auto max-w-[600px] px-4 py-24 text-center" role="alert">
        <p className="font-display text-2xl">Couldn&rsquo;t load venues</p>
        <p className="mt-2 text-paper-dim text-sm">Check your connection and try again.</p>
        <Button className="mt-5" onClick={() => router.refresh()}>Retry</Button>
      </div>
    );
  }

  if (step === "preview" && previewSlot) {
    return (
      <div className="mx-auto max-w-[760px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">Step 2 of 2</p>
        <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">Check your listing</h1>
        <p className="mt-4 max-w-[54ch] text-paper-dim">This is how artists will see it in search. Nothing is public until you publish.</p>
        <div className="mt-8 max-w-sm">
          <SlotCard slot={previewSlot} />
        </div>
        <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-ink-border py-6 text-sm">
          <div><dt className={labelCls}>Venue</dt><dd>{venue?.name}, {venue?.city}</dd></div>
          <div><dt className={labelCls}>Date</dt><dd>{formatDate(effective.date, { withYear: true })}</dd></div>
          <div><dt className={labelCls}>Doors / on stage</dt><dd>{effective.doorsTime} / {effective.setTime} ({effective.performanceLengthMins} min)</dd></div>
          <div><dt className={labelCls}>Applications close</dt><dd>{formatDate(effective.applicationDeadline, { withYear: true })}</dd></div>
          <div><dt className={labelCls}>Support fee</dt><dd>{formatGBP(effective.supportFee)} + {formatGBP(effective.travelContribution)} travel</dd></div>
          <div><dt className={labelCls}>You pay in total (if booked)</dt><dd>about {formatGBP(effective.supportFee + effective.travelContribution + effective.bookingFee)} plus card processing</dd></div>
        </dl>
        {effective.isUrgent && <p className="mt-4 text-sm text-signal">Marked last-minute: artists nearby with alerts on are notified.</p>}
        {submitError && <p className="mt-6 text-sm text-signal" role="alert">{submitError}</p>}
        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <Button variant="outline" size="lg" onClick={() => setStep("edit")} disabled={submitting}>← Back to edit</Button>
          <Button size="lg" className="flex-1" onClick={publish} disabled={submitting}>
            {submitting ? "Saving…" : mode === "edit" ? "Save changes" : "Publish listing"}
          </Button>
        </div>
      </div>
    );
  }

  const lockNote = materialLocked
    ? "This listing has an offer or a confirmed booking, so the date, venue, times and money are locked. Use “Change date or times” on the applicants page, or withdraw the offer first."
    : undefined;

  return (
    <div className="mx-auto max-w-[760px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      <p id="listing-form-top" className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">
        {mode === "edit" ? "Edit listing" : "Step 1 of 2"}
      </p>
      <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">
        {mode === "edit" ? "Edit your listing" : "Create a support slot"}
      </h1>
      <p className="mt-4 max-w-[54ch] text-paper-dim">Tell artists what you need — the clearer the brief, the better the applications.</p>
      {lockNote && <p className="mt-4 border border-acid/50 bg-acid/5 p-3 text-sm">{lockNote}</p>}
      {touched && hasErrors && (
        <p className="mt-4 border border-signal/50 p-3 text-sm text-signal" role="alert">
          Please fix the highlighted fields.
        </p>
      )}

      <div className="mt-10 space-y-8">
        <div>
          <label htmlFor="lf-headliner" className={labelCls}>Headliner / show name</label>
          <input id="lf-headliner" className={inputCls()} maxLength={120} value={draft.headliner} onChange={(e) => set("headliner", e.target.value)} placeholder="e.g. Field Mode" aria-invalid={!!show("headliner")} aria-describedby="lf-headliner-err" />
          <FieldError id="lf-headliner-err" message={show("headliner")} />
        </div>

        <ImageUploadField value={image} onChange={setImage} />
        <ImageUploadField
          value={artistPhoto}
          onChange={setArtistPhoto}
          label="Reference photo of the artist you're picturing (optional)"
          hint="Gives applicants a feel for the vibe you're after — a photo of a similar act, not the headliner."
          placeholderNote=""
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label htmlFor="lf-venue" className={labelCls}>Venue</label>
            <select id="lf-venue" className={inputCls("appearance-none")} value={venueId} disabled={materialLocked || !venues} onChange={(e) => set("venueId", e.target.value)}>
              {(venues ?? []).map((v) => (
                <option key={v.id} value={v.id} className="bg-ink-card">{v.name} — {v.city} ({v.capacity} cap)</option>
              ))}
            </select>
            <FieldError id="lf-venue-err" message={show("venueId")} />
          </div>
          <div>
            <label htmlFor="lf-date" className={labelCls}>Show date</label>
            <input id="lf-date" type="date" min={today} className={inputCls()} value={draft.date} disabled={materialLocked} onChange={(e) => set("date", e.target.value)} aria-invalid={!!show("date")} />
            <FieldError id="lf-date-err" message={show("date")} />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
          <div>
            <label htmlFor="lf-doors" className={labelCls}>Doors</label>
            <input id="lf-doors" type="time" className={inputCls()} value={draft.doorsTime} disabled={materialLocked} onChange={(e) => set("doorsTime", e.target.value)} />
            <FieldError id="lf-doors-err" message={show("doorsTime")} />
          </div>
          <div>
            <label htmlFor="lf-set" className={labelCls}>Set time</label>
            <input id="lf-set" type="time" className={inputCls()} value={draft.setTime} disabled={materialLocked} onChange={(e) => set("setTime", e.target.value)} />
            <FieldError id="lf-set-err" message={show("setTime")} />
          </div>
          <div>
            <label htmlFor="lf-len" className={labelCls}>Set length (min)</label>
            <input id="lf-len" type="number" min={5} max={240} className={inputCls()} value={Number.isNaN(draft.performanceLengthMins) ? "" : draft.performanceLengthMins} disabled={materialLocked} onChange={(e) => set("performanceLengthMins", num(e.target.value))} />
            <FieldError id="lf-len-err" message={show("performanceLengthMins")} />
          </div>
          <div>
            <label htmlFor="lf-att" className={labelCls}>Attendance</label>
            <input id="lf-att" type="number" min={1} className={inputCls()} value={Number.isNaN(draft.expectedAttendance) ? "" : draft.expectedAttendance} onChange={(e) => set("expectedAttendance", num(e.target.value))} />
            <FieldError id="lf-att-err" message={show("expectedAttendance")} />
          </div>
        </div>

        <div>
          <p className={labelCls}>Genres this slot suits</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Genres">
            {ALL_GENRES.map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={draft.genres.includes(g)}
                onClick={() => set("genres", draft.genres.includes(g) ? draft.genres.filter((x) => x !== g) : [...draft.genres, g])}
                className={cn("font-mono text-[10px] uppercase tracking-widest px-3 py-2 border transition-colors", draft.genres.includes(g) ? "border-acid text-acid" : "border-ink-border text-paper-dim hover:border-paper")}
              >
                {g}
              </button>
            ))}
          </div>
          <FieldError id="lf-genres-err" message={show("genres")} />
        </div>

        <div>
          <p className={labelCls}>Suits which artist size? (optional)</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Artist size">
            {ARTIST_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={draft.artistSizeFit.includes(s)}
                onClick={() => set("artistSizeFit", draft.artistSizeFit.includes(s) ? draft.artistSizeFit.filter((x) => x !== s) : [...draft.artistSizeFit, s])}
                className={cn("font-mono text-[10px] uppercase tracking-widest px-3 py-2 border capitalize transition-colors", draft.artistSizeFit.includes(s) ? "border-acid text-acid" : "border-ink-border text-paper-dim hover:border-paper")}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <label htmlFor="lf-fee" className={labelCls}>Support fee (£)</label>
            <input id="lf-fee" type="number" min={0} step={1} className={inputCls()} value={Number.isNaN(draft.supportFee) ? "" : draft.supportFee} disabled={materialLocked} onChange={(e) => set("supportFee", num(e.target.value))} />
            <FieldError id="lf-fee-err" message={show("supportFee")} />
          </div>
          <div>
            <label htmlFor="lf-travel" className={labelCls}>Travel contribution (£)</label>
            <input id="lf-travel" type="number" min={0} step={1} className={inputCls()} value={Number.isNaN(draft.travelContribution) ? "" : draft.travelContribution} disabled={materialLocked} onChange={(e) => set("travelContribution", num(e.target.value))} />
            <FieldError id="lf-travel-err" message={show("travelContribution")} />
            <p className="mt-2 text-[11px] text-paper-dim">For an artist travelling over an hour, this is raised to a £10 minimum automatically.</p>
          </div>
          <div>
            <label htmlFor="lf-book" className={labelCls}>Support Slot booking fee (£)</label>
            <input id="lf-book" type="number" min={MIN_BOOKING_FEE} step={1} className={inputCls()} value={Number.isNaN(draft.bookingFee) ? "" : draft.bookingFee} disabled={materialLocked} onChange={(e) => set("bookingFee", num(e.target.value))} />
            <FieldError id="lf-book-err" message={show("bookingFee")} />
            <p className="mt-2 text-[11px] text-paper-dim">Paid by you, on top of the artist&rsquo;s fee, only if you book someone — never taken from the artist. £{MIN_BOOKING_FEE} minimum.</p>
          </div>
          <div>
            <label htmlFor="lf-deadline" className={labelCls}>Applications close</label>
            <input id="lf-deadline" type="date" min={today} className={inputCls()} value={draft.applicationDeadline} onChange={(e) => set("applicationDeadline", e.target.value)} aria-invalid={!!show("applicationDeadline")} />
            <FieldError id="lf-deadline-err" message={show("applicationDeadline")} />
          </div>
        </div>

        <div>
          <label htmlFor="lf-req" className={labelCls}>Requirements (one per line, max 10)</label>
          <textarea id="lf-req" className={inputCls()} rows={3} value={draft.requirementsText} onChange={(e) => set("requirementsText", e.target.value)} placeholder={"Own backline preferred\nLoad in from 17:30"} />
          <FieldError id="lf-req-err" message={show("requirementsText")} />
        </div>

        <div>
          <label htmlFor="lf-desc" className={labelCls}>Description</label>
          <textarea id="lf-desc" className={inputCls()} rows={4} maxLength={2000} value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder="What are you looking for in a support act?" />
          <FieldError id="lf-desc-err" message={show("description")} />
        </div>

        <label className="flex items-center gap-3 border border-ink-border p-4 cursor-pointer">
          <input type="checkbox" checked={draft.isUrgent} onChange={(e) => set("isUrgent", e.target.checked)} className="accent-[var(--color-signal)]" />
          <span className="text-sm">
            This is last-minute — list it under <span className="text-signal">Needed tonight</span>. Artists who&rsquo;ve turned alerts on
            and live within their travel radius get an in-app notification when you publish.
          </span>
        </label>

        <Button size="lg" className="w-full" onClick={toPreview}>Review listing →</Button>
        <p className="text-center text-[11px] text-paper-dim">No listing fees. Nothing is public until you publish.</p>
      </div>
    </div>
  );
}
