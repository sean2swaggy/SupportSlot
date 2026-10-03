"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { submitReport, type ReportContext } from "@/lib/actions";

/**
 * Sends a real report into the moderation queue (see reports table / admin
 * pages). The confirmation is shown only after the server accepted it, with
 * the reference we stored — not before.
 */
export default function ReportModal({
  open,
  onClose,
  contextType,
  contextId,
  reportedProfileId,
  subject,
}: {
  open: boolean;
  onClose: () => void;
  contextType: ReportContext;
  contextId?: string;
  reportedProfileId?: string;
  subject: string;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const close = () => {
    onClose();
    setTimeout(() => {
      setReason("");
      setError(null);
      setReference(null);
    }, 250);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await submitReport(createClient(), { contextType, contextId, reportedProfileId, reason: reason.trim() });
    setBusy(false);
    if (result.ok) setReference(String(result.data).slice(0, 8));
    else setError(result.error);
  };

  return (
    <Modal open={open} onClose={close} labelledBy="report-title">
      <div className="p-6 sm:p-7">
        {reference ? (
          <div className="text-center py-2">
            <p id="report-title" className="font-display text-2xl">Report received</p>
            <p className="mt-2 text-sm text-paper-dim max-w-[40ch] mx-auto">
              Our team will look at it. Reference <span className="font-mono">{reference}</span>. We may contact you for more detail.
            </p>
            <Button className="mt-6" onClick={close}>Done</Button>
          </div>
        ) : (
          <>
            <h2 id="report-title" className="font-display text-2xl">Report {subject}</h2>
            <p className="mt-2 text-sm text-paper-dim">
              Tell us what&rsquo;s wrong. Reports are read by a person; the other party isn&rsquo;t told who reported them.
            </p>
            <label htmlFor="report-reason" className="mt-4 block font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2">
              What happened?
            </label>
            <textarea
              id="report-reason"
              rows={4}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper"
            />
            {error && <p className="mt-3 text-sm text-signal" role="alert">{error}</p>}
            <div className="flex gap-3 mt-5">
              <Button variant="outline" className="flex-1" onClick={close} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={submit} disabled={busy || reason.trim().length < 10}>
                {busy ? "Sending…" : "Send report"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
