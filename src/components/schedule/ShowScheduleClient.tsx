"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  addScheduleEntry,
  applyTemplateToSchedule,
  deleteScheduleEntry,
  getCancelledArtistIdsForSlot,
  getConfirmedArtistsForSlot,
  getOrCreateShowSchedule,
  getScheduleTemplates,
  getShowSchedule,
  reorderScheduleEntries,
  saveScheduleAsTemplate,
  setScheduleStatus,
  updateScheduleEntry,
} from "@/lib/queries";
import {
  DEFAULT_STAGE,
  SCHEDULE_ENTRY_KIND_LABELS,
  applyTemplateToEvent,
  captureTemplateEntries,
  combinedTimeline,
  detectAllConflicts,
  entriesForStage,
  formatNaiveDayLabel,
  formatNaiveTime,
  crossesIntoNextDay,
  nextSortOrder,
  reorderStageByDragDrop,
  reorderWithinStage,
  stagesOf,
} from "@/lib/schedule";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import SectionHeading from "@/components/ui/SectionHeading";
import EntryFormModal, { entryToDraft, type EntryDraft } from "@/components/schedule/EntryFormModal";
import { formatDate } from "@/lib/utils";
import type { Artist, ScheduleEntry, ScheduleTemplate, ShowSchedule, SupportSlot, Venue } from "@/lib/types";

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

export default function ShowScheduleClient({
  slot,
  venue,
  promoterId,
  isSupportPlus,
}: {
  slot: SupportSlot;
  venue: Venue;
  promoterId: string;
  isSupportPlus: boolean;
}) {
  if (!isSupportPlus) {
    return <UpsellState slot={slot} />;
  }
  return <ScheduleWorkspace slot={slot} venue={venue} promoterId={promoterId} />;
}

function UpsellState({ slot }: { slot: SupportSlot }) {
  return (
    <div className="mx-auto max-w-[700px] px-4 sm:px-6 lg:px-10 py-16 sm:py-24 text-center">
      <Link
        href={`/promoter/slot/${slot.id}/applicants`}
        className="font-mono text-[11px] uppercase tracking-widest text-paper-dim hover:text-paper"
      >
        ← Back to {slot.headliner}
      </Link>
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mt-8 mb-3">
        Show Schedule
      </p>
      <h1 className="font-display uppercase text-4xl sm:text-5xl leading-[0.95] tracking-tight">
        A Support+ planning tool
      </h1>
      <p className="mt-5 text-paper-dim">
        Show Schedule is a private running order for your event — arrival, load-in, soundcheck,
        doors, performances, changeovers and breaks, across one or more stages. It&rsquo;s only for
        organising your own night; nothing here is ever visible to artists, and nothing you do here
        sends a notification or changes a booking. Support+ also includes your Artist Roster and
        Availability Requests.
      </p>
      <Button href="/support-plus" size="lg" className="mt-8">
        See Support+
      </Button>
    </div>
  );
}

function ScheduleWorkspace({ slot, venue, promoterId }: { slot: SupportSlot; venue: Venue; promoterId: string }) {
  const [schedule, setSchedule] = useState<ShowSchedule | null>(null);
  const [confirmedArtists, setConfirmedArtists] = useState<Artist[]>([]);
  const [cancelledArtistIds, setCancelledArtistIds] = useState<Set<string>>(new Set());
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [activeView, setActiveView] = useState<string>("__combined__");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [entryModal, setEntryModal] = useState<{ mode: "add" | "edit"; entry?: ScheduleEntry } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleEntry | null>(null);
  const [templateModal, setTemplateModal] = useState<"save" | "apply" | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  // No synchronous setState before the first await here — the effect below
  // calls this directly (mirrors src/app/dashboard/promoter/roster/page.tsx's
  // `load`/`useEffect(load, [...])` convention), and setState only ever
  // happens inside the resolved-promise callback.
  const load = () => {
    const supabase = createClient();
    Promise.all([
      getOrCreateShowSchedule(supabase, slot.id, promoterId),
      getConfirmedArtistsForSlot(supabase, slot.id),
      getCancelledArtistIdsForSlot(supabase, slot.id),
      getScheduleTemplates(supabase, promoterId),
    ]).then(([sched, artists, cancelled, tmpls]) => {
      if (!sched) {
        setLoadError(true);
        setLoading(false);
        return;
      }
      setLoadError(false);
      setSchedule(sched);
      setConfirmedArtists(artists);
      setCancelledArtistIds(cancelled);
      setTemplates(tmpls);
      setLoading(false);
    });
  };

  useEffect(load, [slot.id, promoterId]);

  const retry = () => {
    setLoading(true);
    setLoadError(false);
    load();
  };

  const reload = async () => {
    const fresh = await getShowSchedule(createClient(), slot.id);
    if (fresh) setSchedule(fresh);
    setSaveState("idle");
    setSaveError(null);
  };

  const applyResult = async (result: { ok: true; version: number } | { ok: false; error: string }) => {
    if (!result.ok) {
      if (result.error === "stale") {
        setSaveState("conflict");
      } else {
        setSaveState("error");
        setSaveError(
          result.error === "support_plus_required"
            ? "Your Support+ subscription is no longer active."
            : result.error
        );
      }
      return false;
    }
    const fresh = await getShowSchedule(createClient(), slot.id);
    if (fresh) setSchedule(fresh);
    setSaveState("saved");
    window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 2000);
    return true;
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-14">
        <div className="h-6 w-48 bg-ink-raised animate-pulse" />
        <div className="mt-6 h-12 w-96 bg-ink-raised animate-pulse" />
        <div className="mt-10 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 border border-ink-border bg-ink-raised animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (loadError || !schedule) {
    return (
      <div className="mx-auto max-w-[700px] px-4 sm:px-6 lg:px-10 py-24 text-center">
        <p className="font-display text-2xl">Couldn&rsquo;t load this schedule</p>
        <p className="mt-3 text-paper-dim">
          Something went wrong loading Show Schedule for this event.
        </p>
        <Button onClick={retry} size="md" className="mt-6">
          Try again
        </Button>
      </div>
    );
  }

  const stages = stagesOf(schedule.entries);
  const conflicts = detectAllConflicts(schedule.entries);
  const scheduledArtistIds = new Set(schedule.entries.map((e) => e.artistId).filter(Boolean) as string[]);
  const unscheduledArtists = confirmedArtists.filter((a) => !scheduledArtistIds.has(a.id));
  const activeStage = activeView === "__combined__" ? null : activeView;
  const visibleEntries = activeStage
    ? entriesForStage(schedule.entries, activeStage)
    : combinedTimeline(schedule.entries);

  const anchorDefault = `${slot.date}T${slot.doorsTime}`;

  // --- mutations -----------------------------------------------------
  const openAddModal = (prefill?: Partial<EntryDraft>) => {
    const defaultStage = activeStage ?? DEFAULT_STAGE;
    setEntryModal({
      mode: "add",
      entry: {
        id: "",
        scheduleId: schedule.id,
        kind: "performance",
        title: "",
        stage: defaultStage,
        start: `${slot.date}T20:00`,
        end: `${slot.date}T20:25`,
        notes: "",
        sortOrder: nextSortOrder(schedule.entries, defaultStage),
        ...prefill,
      } as ScheduleEntry,
    });
  };

  const submitEntry = async (draft: EntryDraft) => {
    setSaveState("saving");
    setSaveError(null);
    if (entryModal?.mode === "edit" && entryModal.entry) {
      const result = await updateScheduleEntry(createClient(), schedule.id, schedule.version, entryModal.entry.id, {
        kind: draft.kind,
        title: draft.title,
        stage: draft.stage || DEFAULT_STAGE,
        start: draft.start,
        end: draft.end,
        artistId: draft.artistId || undefined,
        notes: draft.notes,
      });
      if (await applyResult(result)) setEntryModal(null);
    } else {
      const stage = draft.stage || DEFAULT_STAGE;
      const result = await addScheduleEntry(createClient(), schedule.id, schedule.version, {
        kind: draft.kind,
        title: draft.title,
        stage,
        start: draft.start,
        end: draft.end,
        artistId: draft.artistId || undefined,
        notes: draft.notes,
        sortOrder: nextSortOrder(schedule.entries, stage),
      });
      if (await applyResult(result)) setEntryModal(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaveState("saving");
    const result = await deleteScheduleEntry(createClient(), schedule.id, schedule.version, deleteTarget.id);
    if (await applyResult(result)) setDeleteTarget(null);
  };

  const duplicateEntry = (entry: ScheduleEntry) => {
    setEntryModal({
      mode: "add",
      entry: {
        ...entry,
        id: "",
        title: `${entry.title} (copy)`,
        sortOrder: nextSortOrder(schedule.entries, entry.stage),
      },
    });
  };

  const moveEntry = async (entryId: string, direction: "up" | "down") => {
    if (!activeStage) return;
    const pairs = reorderWithinStage(schedule.entries, activeStage, entryId, direction);
    if (!pairs) return;
    setSaveState("saving");
    const result = await reorderScheduleEntries(createClient(), schedule.id, schedule.version, pairs);
    await applyResult(result);
  };

  const dropEntry = async (targetId: string) => {
    if (!activeStage || !draggedId || draggedId === targetId) {
      setDraggedId(null);
      return;
    }
    const pairs = reorderStageByDragDrop(schedule.entries, activeStage, draggedId, targetId);
    setDraggedId(null);
    if (!pairs) return;
    setSaveState("saving");
    const result = await reorderScheduleEntries(createClient(), schedule.id, schedule.version, pairs);
    await applyResult(result);
  };

  const toggleStatus = async () => {
    setSaveState("saving");
    const next = schedule.status === "draft" ? "final" : "draft";
    const result = await setScheduleStatus(createClient(), schedule.id, schedule.version, next);
    await applyResult(result);
  };

  const saveAsTemplate = async (name: string) => {
    const captured = captureTemplateEntries(schedule.entries);
    const result = await saveScheduleAsTemplate(createClient(), promoterId, name, captured);
    if (result.ok) {
      setTemplateModal(null);
      getScheduleTemplates(createClient(), promoterId).then(setTemplates);
    } else {
      setSaveState("error");
      setSaveError(result.error);
    }
  };

  const applyTemplate = async (template: ScheduleTemplate, anchor: string) => {
    setSaveState("saving");
    const built = applyTemplateToEvent(template, anchor);
    const result = await applyTemplateToSchedule(createClient(), schedule.id, schedule.version, built);
    if (await applyResult(result)) setTemplateModal(null);
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      <Link
        href={`/promoter/slot/${slot.id}/applicants`}
        className="font-mono text-[11px] uppercase tracking-widest text-paper-dim hover:text-paper"
      >
        ← Back to {slot.headliner}
      </Link>

      <div className="mt-4 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-2">
            Show Schedule · Private
          </p>
          <h1 className="font-display uppercase text-3xl sm:text-5xl leading-none">{slot.headliner}</h1>
          <p className="mt-3 text-paper-dim">
            {venue.name}, {slot.city} · {formatDate(slot.date, { withYear: true })} · Doors{" "}
            {slot.doorsTime}
          </p>
        </div>
        <SaveStatusBadge state={saveState} error={saveError} onReload={reload} />
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border border-ink-border bg-ink-raised px-5 py-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
            Planning status
          </p>
          <p className="mt-1 text-sm">
            {schedule.status === "final" ? (
              <span className="text-acid">Final — internal only</span>
            ) : (
              <span className="text-paper-dim">Draft</span>
            )}
            {" · "}
            <span className="text-paper-dim">
              &ldquo;Final&rdquo; is an internal planning label — it never notifies artists or
              confirms a booking.
            </span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={toggleStatus}>
          Mark as {schedule.status === "draft" ? "Final" : "Draft"}
        </Button>
      </div>

      {conflicts.length > 0 && (
        <div className="mt-6 border border-signal/50 bg-signal/10 px-5 py-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-signal">
            {conflicts.length} thing{conflicts.length === 1 ? "" : "s"} to check
          </p>
          <ul className="mt-2 space-y-1.5">
            {conflicts.map((c, i) => (
              <li key={i} className="text-sm text-paper-dim">
                {c.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {unscheduledArtists.length > 0 && (
        <div className="mt-6 border border-ink-border px-5 py-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
            Unscheduled artists ({unscheduledArtists.length})
          </p>
          <p className="mt-1 text-[12px] text-paper-dim">
            Confirmed for this show, no performance time set yet — this reflects the real booking,
            not a guess.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {unscheduledArtists.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => openAddModal({ kind: "performance", title: `${a.name} set`, artistId: a.id })}
                className="font-mono text-[10px] uppercase tracking-widest border border-ink-border px-3 py-2 hover:border-acid hover:text-acid transition-colors"
              >
                + Schedule {a.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
        <SectionHeading eyebrow="Running order" title="Timeline" className="border-none pb-0 flex-1" />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setTemplateModal("apply")} disabled={templates.length === 0}>
            Apply template
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTemplateModal("save")} disabled={schedule.entries.length === 0}>
            Save as template
          </Button>
          <Button size="sm" onClick={() => openAddModal()}>
            + Add entry
          </Button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <ViewTab active={activeView === "__combined__"} onClick={() => setActiveView("__combined__")}>
          All stages
        </ViewTab>
        {stages.map((s) => (
          <ViewTab key={s} active={activeView === s} onClick={() => setActiveView(s)}>
            {s}
          </ViewTab>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {visibleEntries.length === 0 ? (
          <div className="border border-dashed border-ink-border p-10 text-center">
            <p className="font-display text-xl">Nothing scheduled yet</p>
            <p className="mt-2 text-sm text-paper-dim">
              Add your first entry, or apply a saved template to get started.
            </p>
            <Button size="md" className="mt-5" onClick={() => openAddModal()}>
              + Add entry
            </Button>
          </div>
        ) : (
          visibleEntries.map((entry, index) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              showStage={!activeStage}
              startOnDifferentDay={crossesIntoNextDay(entry.start, slot.date)}
              endOnDifferentDay={crossesIntoNextDay(entry.end, entry.start)}
              cancelled={!!entry.artistId && cancelledArtistIds.has(entry.artistId)}
              artistName={confirmedArtists.find((a) => a.id === entry.artistId)?.name}
              draggable={!!activeStage}
              isDragging={draggedId === entry.id}
              onDragStart={() => setDraggedId(entry.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropEntry(entry.id)}
              canMoveUp={!!activeStage && index > 0}
              canMoveDown={!!activeStage && index < visibleEntries.length - 1}
              onMoveUp={() => moveEntry(entry.id, "up")}
              onMoveDown={() => moveEntry(entry.id, "down")}
              onEdit={() => setEntryModal({ mode: "edit", entry })}
              onDuplicate={() => duplicateEntry(entry)}
              onDelete={() => setDeleteTarget(entry)}
            />
          ))
        )}
      </div>

      {entryModal && (
        <EntryFormModal
          key={entryModal.entry?.id || "new"}
          open={!!entryModal}
          onClose={() => setEntryModal(null)}
          onSubmit={submitEntry}
          mode={entryModal.mode}
          initial={entryToDraft(entryModal.entry as ScheduleEntry)}
          stages={stages}
          confirmedArtists={confirmedArtists}
          submitting={saveState === "saving"}
        />
      )}

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} labelledBy="delete-entry-title">
        <div className="p-6 sm:p-7">
          <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Remove entry</p>
          <h2 id="delete-entry-title" className="font-display text-2xl mt-1 mb-2">
            Remove &ldquo;{deleteTarget?.title}&rdquo;?
          </h2>
          <p className="text-sm text-paper-dim">
            This only affects your private running order — it doesn&rsquo;t touch the booking
            itself.
          </p>
          <div className="mt-6 flex gap-3">
            <Button variant="outline" size="md" onClick={() => setDeleteTarget(null)} className="flex-1">
              Cancel
            </Button>
            <Button variant="danger" size="md" onClick={confirmDelete} className="flex-1">
              Remove
            </Button>
          </div>
        </div>
      </Modal>

      {templateModal === "save" && (
        <SaveTemplateModal onClose={() => setTemplateModal(null)} onSave={saveAsTemplate} />
      )}
      {templateModal === "apply" && (
        <ApplyTemplateModal
          templates={templates}
          defaultAnchor={anchorDefault}
          onClose={() => setTemplateModal(null)}
          onApply={applyTemplate}
        />
      )}
    </div>
  );
}

function ViewTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-mono text-[11px] uppercase tracking-widest px-3.5 py-2.5 border transition-colors ${
        active ? "border-acid text-acid" : "border-ink-border text-paper-dim hover:border-paper"
      }`}
    >
      {children}
    </button>
  );
}

function SaveStatusBadge({
  state,
  error,
  onReload,
}: {
  state: SaveState;
  error: string | null;
  onReload: () => void;
}) {
  if (state === "conflict") {
    return (
      <div className="flex items-center gap-3 border border-signal/50 bg-signal/10 px-4 py-2.5">
        <p className="text-xs text-signal">Changed elsewhere — reload to see the latest.</p>
        <Button size="sm" variant="outline" onClick={onReload}>
          Reload
        </Button>
      </div>
    );
  }
  if (state === "error") {
    return <p className="text-xs text-signal">{error ?? "Something went wrong."}</p>;
  }
  if (state === "saving") {
    return <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">Saving…</p>;
  }
  if (state === "saved") {
    return <p className="font-mono text-[10px] uppercase tracking-widest text-ok">Saved ✓</p>;
  }
  return null;
}

function EntryRow({
  entry,
  showStage,
  startOnDifferentDay,
  endOnDifferentDay,
  cancelled,
  artistName,
  draggable,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  entry: ScheduleEntry;
  showStage: boolean;
  startOnDifferentDay: boolean;
  endOnDifferentDay: boolean;
  cancelled: boolean;
  artistName?: string;
  draggable: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`flex flex-col sm:flex-row sm:items-center gap-3 border p-4 transition-colors ${
        cancelled ? "border-signal/50 bg-signal/5" : "border-ink-border bg-ink-raised"
      } ${isDragging ? "opacity-40" : ""} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div className="shrink-0 w-36">
        <p className="font-mono text-sm">
          {startOnDifferentDay && (
            <span className="text-acid mr-1">{formatNaiveDayLabel(entry.start)}</span>
          )}
          {formatNaiveTime(entry.start)}
          {"–"}
          {endOnDifferentDay && (
            <span className="text-acid mr-1 ml-1">{formatNaiveDayLabel(entry.end)}</span>
          )}
          {formatNaiveTime(entry.end)}
        </p>
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
          {SCHEDULE_ENTRY_KIND_LABELS[entry.kind]}
          {showStage && ` · ${entry.stage}`}
        </p>
        <p className="text-sm mt-0.5">{entry.title}</p>
        {artistName && <p className="text-[12px] text-paper-dim mt-0.5">{artistName}</p>}
        {entry.notes && <p className="text-[12px] text-paper-dim mt-1 italic">{entry.notes}</p>}
        {cancelled && (
          <p className="text-[11px] text-signal mt-1">
            ⚠ This artist&rsquo;s booking was cancelled — review this entry.
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {draggable && (
          <div className="flex flex-col">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp}
              aria-label="Move up"
              className="px-1.5 text-paper-dim hover:text-paper disabled:opacity-20"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown}
              aria-label="Move down"
              className="px-1.5 text-paper-dim hover:text-paper disabled:opacity-20"
            >
              ▼
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="font-mono text-[10px] uppercase tracking-widest border border-ink-border px-2.5 py-2 hover:border-paper transition-colors"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          className="font-mono text-[10px] uppercase tracking-widest border border-ink-border px-2.5 py-2 hover:border-paper transition-colors"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="font-mono text-[10px] uppercase tracking-widest border border-ink-border px-2.5 py-2 hover:border-signal hover:text-signal transition-colors"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function SaveTemplateModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <Modal open onClose={onClose} labelledBy="save-template-title">
      <div className="p-6 sm:p-7">
        <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">Templates</p>
        <h2 id="save-template-title" className="font-display text-2xl mt-1 mb-2">
          Save as template
        </h2>
        <p className="text-sm text-paper-dim">
          Saves the structure and durations of this running order for reuse — never the artists
          assigned, private notes, or this event&rsquo;s real dates.
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Standard support night"
          className="mt-4 w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper"
        />
        <div className="mt-6 flex gap-3">
          <Button variant="outline" size="md" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button size="md" onClick={() => name.trim() && onSave(name.trim())} disabled={!name.trim()} className="flex-1">
            Save template
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ApplyTemplateModal({
  templates,
  defaultAnchor,
  onClose,
  onApply,
}: {
  templates: ScheduleTemplate[];
  defaultAnchor: string;
  onClose: () => void;
  onApply: (template: ScheduleTemplate, anchor: string) => void;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [anchor, setAnchor] = useState(defaultAnchor);
  const selected = templates.find((t) => t.id === templateId);

  return (
    <Modal open onClose={onClose} labelledBy="apply-template-title">
      <div className="p-6 sm:p-7">
        <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">Templates</p>
        <h2 id="apply-template-title" className="font-display text-2xl mt-1 mb-2">
          Apply template
        </h2>
        <p className="text-sm text-paper-dim">
          Adds this template&rsquo;s entries to the running order, anchored at the start time below.
          No artists or notes are added — assign those after.
        </p>

        <div className="mt-4">
          <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
            Template
          </label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper appearance-none"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id} className="bg-ink-card">
                {t.name} ({t.entries.length} entries)
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4">
          <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
            Starts at
          </label>
          <input
            type="datetime-local"
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
            className="w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper"
          />
        </div>

        <div className="mt-6 flex gap-3">
          <Button variant="outline" size="md" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button size="md" onClick={() => selected && onApply(selected, anchor)} disabled={!selected} className="flex-1">
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}
