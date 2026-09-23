"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { createAvailabilityRequest, createEventTemplate, getEventTemplates } from "@/lib/queries";
import type { Currency, EventTemplate, RosterEntry } from "@/lib/types";

const fieldCls =
  "w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60";
const labelCls = "font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block";

const TIMEZONES = ["Europe/London", "Europe/Dublin", "Europe/Paris", "America/New_York"];
const CURRENCIES: Currency[] = ["GBP", "EUR", "USD"];

export default function RequestComposerModal({
  open,
  onClose,
  promoterId,
  roster,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  promoterId: string;
  roster: RosterEntry[];
  onSent: () => void;
}) {
  const [step, setStep] = useState<"compose" | "preview" | "sent">("compose");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("20:00");
  const [timezone, setTimezone] = useState("Europe/London");
  const [venueName, setVenueName] = useState("");
  const [venueLocation, setVenueLocation] = useState("");
  const [proposedFee, setProposedFee] = useState("150");
  const [currency, setCurrency] = useState<Currency>("GBP");
  const [setLengthMins, setSetLengthMins] = useState("30");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("18:00");
  const [message, setMessage] = useState("");
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    getEventTemplates(createClient(), promoterId).then(setTemplates);
  }, [open, promoterId]);

  const close = () => {
    onClose();
    setTimeout(() => {
      setStep("compose");
      setSelected(new Set());
      submittedRef.current = false;
    }, 250);
  };

  const toggleArtist = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setEventName(t.eventName);
    setVenueName(t.venueName);
    setVenueLocation(t.venueLocation);
    if (t.proposedFee) setProposedFee(String(t.proposedFee));
    setCurrency(t.currency);
    if (t.setLengthMins) setSetLengthMins(String(t.setLengthMins));
    setMessage(t.message ?? "");
  };

  const canPreview =
    selected.size > 0 &&
    eventName.trim() &&
    eventDate &&
    venueName.trim() &&
    venueLocation.trim() &&
    Number(proposedFee) >= 0 &&
    Number(setLengthMins) > 0 &&
    deadlineDate;

  const send = async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setError(null);
    const supabase = createClient();

    if (saveAsTemplate && templateName.trim()) {
      await createEventTemplate(supabase, promoterId, {
        name: templateName.trim(),
        eventName,
        venueName,
        venueLocation,
        proposedFee: Number(proposedFee),
        currency,
        setLengthMins: Number(setLengthMins),
        message: message || undefined,
      });
    }

    const result = await createAvailabilityRequest(supabase, promoterId, {
      eventName: eventName.trim(),
      eventDate,
      eventTime,
      timezone,
      venueName: venueName.trim(),
      venueLocation: venueLocation.trim(),
      proposedFee: Number(proposedFee),
      currency,
      setLengthMins: Number(setLengthMins),
      responseDeadline: new Date(`${deadlineDate}T${deadlineTime}:00`).toISOString(),
      message: message.trim() || undefined,
      artistIds: Array.from(selected),
    });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      submittedRef.current = false;
      return;
    }
    setStep("sent");
    onSent();
  };

  const selectedArtists = roster.filter((r) => selected.has(r.artist.id));

  return (
    <Modal open={open} onClose={close} labelledBy="request-composer-title" className="sm:max-w-2xl">
      <div className="p-6 sm:p-7">
        {step === "sent" ? (
          <div className="py-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center border border-acid text-acid">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M4 12.5 9.5 18 20 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="font-display text-2xl mt-5">Request sent</p>
            <p className="mt-2 text-sm text-paper-dim max-w-[42ch] mx-auto">
              {selectedArtists.length} artist{selectedArtists.length === 1 ? "" : "s"} will see this
              in their account and can reply available, unavailable, or ask a question. This
              isn&rsquo;t a booking yet — you&rsquo;ll still book through the usual flow once
              someone says they&rsquo;re free.
            </p>
            <Button size="md" className="mt-7" onClick={close}>
              Done
            </Button>
          </div>
        ) : step === "preview" ? (
          <>
            <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
              Review before sending
            </p>
            <h2 id="request-composer-title" className="font-display text-2xl mt-1 mb-5">
              {eventName}
            </h2>
            <div className="border border-ink-border divide-y divide-ink-border text-sm">
              <Row label="Date & time" value={`${eventDate} · ${eventTime} (${timezone})`} />
              <Row label="Venue" value={`${venueName}, ${venueLocation}`} />
              <Row label="Proposed fee" value={`${currency} ${proposedFee}`} />
              <Row label="Set length" value={`${setLengthMins} min`} />
              <Row label="Response deadline" value={`${deadlineDate} ${deadlineTime}`} />
              {message && <Row label="Message" value={message} />}
            </div>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-paper-dim">
              Sending to {selectedArtists.length} artist{selectedArtists.length === 1 ? "" : "s"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {selectedArtists.map((r) => (
                <span key={r.id} className="font-mono text-[11px] border border-ink-border px-2.5 py-1.5">
                  {r.artist.name}
                </span>
              ))}
            </div>
            <p className="mt-4 text-[11px] text-paper-dim">
              This is an availability enquiry, not a booking or a guaranteed offer — no payment is
              taken and nothing is reserved until you complete a real booking afterwards.
            </p>
            {error && <p className="mt-3 text-sm text-signal">{error}</p>}
            <div className="mt-5 flex gap-3">
              <Button variant="outline" size="lg" onClick={() => setStep("compose")} disabled={submitting}>
                Back
              </Button>
              <Button size="lg" className="flex-1" onClick={send} disabled={submitting}>
                {submitting ? "Sending…" : "Send request"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
              New availability request
            </p>
            <h2 id="request-composer-title" className="font-display text-2xl mt-1 mb-5">
              Ask your roster who&rsquo;s free
            </h2>

            {templates.length > 0 && (
              <div className="mb-5">
                <label className={labelCls}>Start from a template</label>
                <select
                  onChange={(e) => e.target.value && applyTemplate(e.target.value)}
                  defaultValue=""
                  className={fieldCls}
                >
                  <option value="">— None —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-5">
              <label className={labelCls}>
                Roster artists ({selected.size} selected)
              </label>
              {roster.length === 0 ? (
                <p className="text-sm text-paper-dim">
                  Save artists to your roster first — from their profile or from an applicant list.
                </p>
              ) : (
                <div className="max-h-40 overflow-y-auto border border-ink-border divide-y divide-ink-border">
                  {roster.map((r) => (
                    <label
                      key={r.id}
                      className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-ink-raised"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(r.artist.id)}
                        onChange={() => toggleArtist(r.artist.id)}
                        className="accent-[var(--color-acid)]"
                      />
                      <span className="text-sm">{r.artist.name}</span>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
                        {r.artist.location}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className={labelCls}>Event / show name</label>
                <input value={eventName} onChange={(e) => setEventName(e.target.value)} className={fieldCls} placeholder="e.g. Field Mode" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Date</label>
                  <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className={fieldCls} />
                </div>
                <div>
                  <label className={labelCls}>Time</label>
                  <input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} className={fieldCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Timezone</label>
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={fieldCls}>
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Venue name</label>
                  <input value={venueName} onChange={(e) => setVenueName(e.target.value)} className={fieldCls} placeholder="Strange Brew" />
                </div>
                <div>
                  <label className={labelCls}>Location</label>
                  <input value={venueLocation} onChange={(e) => setVenueLocation(e.target.value)} className={fieldCls} placeholder="Bristol" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Proposed fee</label>
                  <input type="number" min={0} value={proposedFee} onChange={(e) => setProposedFee(e.target.value)} className={fieldCls} />
                </div>
                <div>
                  <label className={labelCls}>Currency</label>
                  <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className={fieldCls}>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Set length (min)</label>
                  <input type="number" min={1} value={setLengthMins} onChange={(e) => setSetLengthMins(e.target.value)} className={fieldCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Response deadline — date</label>
                  <input type="date" value={deadlineDate} onChange={(e) => setDeadlineDate(e.target.value)} className={fieldCls} />
                </div>
                <div>
                  <label className={labelCls}>Response deadline — time</label>
                  <input type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} className={fieldCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Optional message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className="w-full resize-none border border-ink-border bg-transparent p-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60"
                  placeholder="Any extra context for the artists..."
                />
              </div>
              <label className="flex items-center gap-2.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveAsTemplate}
                  onChange={(e) => setSaveAsTemplate(e.target.checked)}
                  className="accent-[var(--color-acid)]"
                />
                Save these details as a reusable template
              </label>
              {saveAsTemplate && (
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name, e.g. Friday supports"
                  className={fieldCls}
                />
              )}
            </div>

            <p className="mt-5 text-[11px] text-paper-dim">
              This sends an availability check, never a payment or a reservation — artists never
              pay to be asked, and answering doesn&rsquo;t cost them anything either way.
            </p>
            <Button
              size="lg"
              className="w-full mt-4"
              disabled={!canPreview}
              onClick={() => setStep("preview")}
            >
              Preview & send
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-paper-dim">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
