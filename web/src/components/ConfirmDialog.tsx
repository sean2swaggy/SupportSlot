import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  dismissLabel?: string;
  reasonLabel?: string; // when set, a required reason is collected
  onConfirm(reason: string): Promise<void>;
  onClose(): void;
}

export function ConfirmDialog({ title, children, confirmLabel, danger, dismissLabel = "Not now", reasonLabel, onConfirm, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { ref.current?.showModal(); }, []);

  const submit = async () => {
    setBusy(true); setError(null);
    try { await onConfirm(reason); onClose(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={(e) => busy && e.preventDefault()} aria-labelledby="dlg-title">
      <h2 id="dlg-title">{title}</h2>
      <div className="dialog-body">{children}</div>
      {reasonLabel && (
        <div className="field">
          <label htmlFor="dlg-reason">{reasonLabel}</label>
          <textarea id="dlg-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={400} />
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="btn btn-quiet" onClick={() => ref.current?.close()} disabled={busy}>{dismissLabel}</button>
        <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={submit} disabled={busy}>{busy ? "Working…" : confirmLabel}</button>
      </div>
    </dialog>
  );
}
