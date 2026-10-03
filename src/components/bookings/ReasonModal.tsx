"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

const fieldCls =
  "w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60";

/**
 * A confirm dialog for a consequential action, optionally asking for a
 * reason. Disables its buttons while the action runs and shows the server's
 * error inside the dialog instead of closing as if it had worked.
 */
export default function ReasonModal({
  open,
  title,
  body,
  confirmLabel,
  requireReason,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  requireReason?: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const tooShort = requireReason && reason.trim().length < 3;
  return (
    <Modal open={open} onClose={onClose} labelledBy="reason-title">
      <div className="p-6 sm:p-7">
        <h2 id="reason-title" className="font-display text-2xl">{title}</h2>
        <p className="mt-2 text-sm text-paper-dim">{body}</p>
        {requireReason !== undefined && (
          <>
            <label htmlFor="reason" className="mt-4 block font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2">
              {requireReason ? "Reason (the other person will see this)" : "Reason (optional)"}
            </label>
            <textarea id="reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={fieldCls} />
          </>
        )}
        {error && <p className="mt-3 text-sm text-signal" role="alert">{error}</p>}
        <div className="flex gap-3 mt-6">
          <Button variant="outline" size="md" className="flex-1" onClick={onClose} disabled={busy}>Go back</Button>
          <Button variant="danger" size="md" className="flex-1" disabled={busy || tooShort} onClick={() => onConfirm(reason)}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
