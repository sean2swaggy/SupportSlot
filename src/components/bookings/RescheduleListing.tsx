"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { rescheduleSlot } from "@/lib/actions";
import { londonToday } from "@/lib/dates";
import { formatDate } from "@/lib/utils";
import type { SupportSlot } from "@/lib/types";

const fieldCls =
  "w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60";
const labelCls = "font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block";

/**
 * Promoter-only: move the date and times of a listing. If an artist is
 * already confirmed the server updates their stored booking too and notifies
 * them, and they can cancel if the new date doesn't work. (An artist can't
 * move a show — only the promoter owns the date.)
 */
export default function RescheduleListing({ slot, onChanged }: { slot: SupportSlot; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(slot.date);
  const [doors, setDoors] = useState(slot.doorsTime.slice(0, 5));
  const [set, setSet] = useState(slot.setTime.slice(0, 5));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today] = useState(() => londonToday());

  if (slot.status !== "open" && slot.status !== "filled") return null;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await rescheduleSlot(createClient(), slot.id, date, doors, set);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    onChanged();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDate(slot.date);
          setDoors(slot.doorsTime.slice(0, 5));
          setSet(slot.setTime.slice(0, 5));
          setError(null);
          setOpen(true);
        }}
        className="font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-acid hover:underline transition-colors"
      >
        Change date or times
      </button>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy="resched-title">
        <div className="p-6 sm:p-7">
          <h2 id="resched-title" className="font-display text-2xl">Change date or times</h2>
          <p className="mt-1 text-sm text-paper-dim mb-5">
            Currently {formatDate(slot.date, { withYear: true })} · doors {slot.doorsTime.slice(0, 5)}
          </p>
          <div className="space-y-4">
            <div>
              <label htmlFor="rs-date" className={labelCls}>New date</label>
              <input id="rs-date" type="date" min={today} className={fieldCls} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="rs-doors" className={labelCls}>Doors</label>
                <input id="rs-doors" type="time" className={fieldCls} value={doors} onChange={(e) => setDoors(e.target.value)} />
              </div>
              <div>
                <label htmlFor="rs-set" className={labelCls}>Set time</label>
                <input id="rs-set" type="time" className={fieldCls} value={set} onChange={(e) => setSet(e.target.value)} />
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs text-paper-dim">
            {slot.status === "filled"
              ? "The confirmed artist is notified in the app straight away and can cancel if the new date doesn't work for them."
              : "Anyone who has applied will see the new date. A change like this is best explained in a message to applicants."}
          </p>
          {error && <p className="mt-3 text-sm text-signal" role="alert">{error}</p>}
          <div className="flex gap-3 mt-5">
            <Button variant="outline" className="flex-1" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button className="flex-1" disabled={!date || !doors || !set || busy} onClick={save}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
