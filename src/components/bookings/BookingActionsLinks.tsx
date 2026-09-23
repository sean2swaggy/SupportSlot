"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { formatDate } from "@/lib/utils";
import type { Application, SupportSlot } from "@/lib/types";

const fieldCls =
  "w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60";
const labelCls = "font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block";

/**
 * "Cancel" / "Reschedule" links for a booked show — shown to both the
 * artist and the promoter side of a booking. Rescheduling moves the show's
 * date/times (see lib/slot-schedule.ts); cancelling flips the application
 * back out of "booked" and frees the slot up again.
 */
export default function BookingActionsLinks({
  application,
  slot,
  className,
}: {
  application: Application;
  slot: SupportSlot;
  className?: string;
}) {
  const { rescheduleSlot, updateApplicationStatus } = useStore();
  const [modal, setModal] = useState<"reschedule" | "cancel" | null>(null);
  const [date, setDate] = useState(slot.date);
  const [doorsTime, setDoorsTime] = useState(slot.doorsTime);
  const [setTime, setSetTime] = useState(slot.setTime);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setModal(null);
    setTimeout(() => setSaved(false), 250);
  };

  const submitReschedule = async () => {
    if (!date) return;
    setError(null);
    setSaving(true);
    try {
      await rescheduleSlot(slot.id, { date, doorsTime, setTime });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reschedule — try again.");
    } finally {
      setSaving(false);
    }
  };

  const confirmCancel = () => {
    updateApplicationStatus(application.id, "cancelled");
    close();
  };

  return (
    <>
      <div className={className ?? "flex items-center gap-4"}>
        <button
          type="button"
          onClick={() => {
            setDate(slot.date);
            setDoorsTime(slot.doorsTime);
            setSetTime(slot.setTime);
            setSaved(false);
            setModal("reschedule");
          }}
          className="font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-acid hover:underline transition-colors"
        >
          Reschedule
        </button>
        <button
          type="button"
          onClick={() => setModal("cancel")}
          className="font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-signal hover:underline transition-colors"
        >
          Cancel booking
        </button>
      </div>

      <Modal open={modal === "reschedule"} onClose={close} labelledBy="reschedule-title">
        <div className="p-6 sm:p-7">
          {saved ? (
            <div className="text-center py-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center border border-acid text-acid">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M4 12.5 9.5 18 20 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="font-display text-xl mt-4">Show rescheduled</p>
              <p className="mt-2 text-sm text-paper-dim max-w-[34ch] mx-auto">
                Now set for {formatDate(date, { withYear: true })}. Both sides will see the
                updated date.
              </p>
              <Button size="md" className="mt-6" onClick={close}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
                Booked show
              </p>
              <h2 id="reschedule-title" className="font-display text-2xl mt-1 mb-1">
                Reschedule
              </h2>
              <p className="text-sm text-paper-dim mb-5">
                Currently {formatDate(slot.date, { withYear: true })} · {slot.doorsTime} doors
              </p>
              <div className="space-y-4">
                <div>
                  <label className={labelCls}>New date</label>
                  <input
                    type="date"
                    className={fieldCls}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Doors</label>
                    <input
                      type="time"
                      className={fieldCls}
                      value={doorsTime}
                      onChange={(e) => setDoorsTime(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Set time</label>
                    <input
                      type="time"
                      className={fieldCls}
                      value={setTime}
                      onChange={(e) => setSetTime(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <p className="mt-4 text-[11px] text-paper-dim">
                Prototype only — no calendar invites or notifications are actually sent.
              </p>
              {error && <p className="mt-3 text-sm text-signal">{error}</p>}
              <Button size="lg" className="w-full mt-5" disabled={!date || saving} onClick={submitReschedule}>
                {saving ? "Saving…" : "Save new date"}
              </Button>
            </>
          )}
        </div>
      </Modal>

      <Modal open={modal === "cancel"} onClose={close} labelledBy="cancel-title">
        <div className="p-6 sm:p-7">
          <p className="font-mono text-[10px] uppercase tracking-widest text-signal">
            Booked show
          </p>
          <h2 id="cancel-title" className="font-display text-2xl mt-1 mb-2">
            Cancel this booking?
          </h2>
          <p className="text-sm text-paper-dim">
            This frees up the slot for {slot.headliner} on{" "}
            {formatDate(slot.date, { withYear: true })} so other artists can be booked. This
            can&rsquo;t be undone in this prototype.
          </p>
          <div className="flex gap-3 mt-6">
            <Button variant="outline" size="lg" className="flex-1" onClick={close}>
              Keep booking
            </Button>
            <Button variant="danger" size="lg" className="flex-1" onClick={confirmCancel}>
              Cancel booking
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
