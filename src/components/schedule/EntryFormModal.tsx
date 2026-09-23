"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { SCHEDULE_ENTRY_KIND_LABELS, validateEntryTimes } from "@/lib/schedule";
import type { Artist, ScheduleEntry, ScheduleEntryKind } from "@/lib/types";

export interface EntryDraft {
  kind: ScheduleEntryKind;
  title: string;
  stage: string;
  start: string; // "YYYY-MM-DDTHH:mm"
  end: string;
  artistId: string;
  notes: string;
}

export default function EntryFormModal({
  open,
  onClose,
  onSubmit,
  mode,
  initial,
  stages,
  confirmedArtists,
  submitting,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (draft: EntryDraft) => void;
  mode: "add" | "edit";
  initial: EntryDraft;
  stages: string[];
  confirmedArtists: Artist[];
  submitting: boolean;
}) {
  // No effect needed to reset this on reopen — the parent passes a
  // changing `key` prop for a different target, which remounts this
  // component with fresh state (see CLAUDE.md on why an effect that calls
  // setState on mount/prop-change is deliberately avoided here).
  const [draft, setDraft] = useState<EntryDraft>(initial);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!draft.title.trim()) {
      setError("Give this entry a title.");
      return;
    }
    const timeCheck = validateEntryTimes(draft.start, draft.end);
    if (!timeCheck.ok) {
      setError(timeCheck.error);
      return;
    }
    setError(null);
    onSubmit(draft);
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="entry-modal-title" className="sm:max-w-xl">
      <div className="p-6 sm:p-7">
        <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
          {mode === "add" ? "Add entry" : "Edit entry"}
        </p>
        <h2 id="entry-modal-title" className="font-display text-2xl mt-1 mb-5">
          Running order item
        </h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
              Type
            </label>
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as ScheduleEntryKind })}
              className="w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper appearance-none"
            >
              {Object.entries(SCHEDULE_ENTRY_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value} className="bg-ink-card">
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
              Stage
            </label>
            <input
              list="schedule-stage-options"
              value={draft.stage}
              onChange={(e) => setDraft({ ...draft, stage: e.target.value })}
              placeholder="e.g. Main Stage"
              className="w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper"
            />
            <datalist id="schedule-stage-options">
              {stages.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="mt-4">
          <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
            Title
          </label>
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="e.g. Doors open / Support set / Changeover"
            className="w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper"
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
              Starts
            </label>
            <input
              type="datetime-local"
              value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
              className="w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
              Ends
            </label>
            <input
              type="datetime-local"
              value={draft.end}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
              className="w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper"
            />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-paper-dim">
          Pick a later calendar date here for anything after midnight — there&rsquo;s nothing
          special to do, it just works.
        </p>

        <div className="mt-4">
          <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
            Assigned artist (optional)
          </label>
          <select
            value={draft.artistId}
            onChange={(e) => setDraft({ ...draft, artistId: e.target.value })}
            className="w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper appearance-none"
          >
            <option value="" className="bg-ink-card">
              — None —
            </option>
            {confirmedArtists.map((a) => (
              <option key={a.id} value={a.id} className="bg-ink-card">
                {a.name}
              </option>
            ))}
          </select>
          {confirmedArtists.length === 0 && (
            <p className="mt-2 text-[11px] text-paper-dim">
              No confirmed bookings on this slot yet — only booked artists can be assigned to an
              entry.
            </p>
          )}
        </div>

        <div className="mt-4">
          <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
            Private notes
          </label>
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            rows={3}
            placeholder="Only you can see this — never shown to artists."
            className="w-full resize-none border border-ink-border bg-transparent p-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60"
          />
        </div>

        {error && <p className="mt-4 text-sm text-signal">{error}</p>}

        <div className="mt-6 flex gap-3">
          <Button variant="outline" size="md" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button size="md" onClick={submit} disabled={submitting} className="flex-1">
            {submitting ? "Saving…" : mode === "add" ? "Add entry" : "Save changes"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function entryToDraft(entry: ScheduleEntry): EntryDraft {
  return {
    kind: entry.kind,
    title: entry.title,
    stage: entry.stage,
    start: entry.start.slice(0, 16),
    end: entry.end.slice(0, 16),
    artistId: entry.artistId ?? "",
    notes: entry.notes,
  };
}
