"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { formatPence } from "@/lib/utils";
import Button from "@/components/ui/Button";
import ReasonModal from "@/components/bookings/ReasonModal";
import { cn } from "@/lib/utils";

// Staff console. The proxy only lets staff reach /admin, and every function
// below re-checks the caller's role in SQL (moderators can't read the bookings list).
// Every action is written to the audit log by the database function itself.

type Tab = "reports" | "support" | "users" | "listings" | "bookings" | "audit";
type Row = Record<string, unknown>;

const when = (v: unknown) => (typeof v === "string" ? new Date(v).toLocaleString("en-GB", { timeZone: "Europe/London" }) : "");
const str = (v: unknown) => (v == null ? "" : String(v));

function useRpc(fn: string, args: Record<string, unknown>) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(args);
  useEffect(() => {
    let cancelled = false;
    createClient()
      .rpc(fn, JSON.parse(key))
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(friendlyError(err, "We couldn't load that."));
        else {
          setRows((data as Row[]) ?? []);
          setError(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fn, key, tick]);
  return { rows, error, reload: () => setTick((t) => t + 1) };
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="border border-ink-border p-4">{children}</div>;
}
function Err({ message }: { message: string | null }) {
  return message ? <p className="text-sm text-signal" role="alert">{message}</p> : null;
}

async function call(fn: string, args: Record<string, unknown>): Promise<string | null> {
  const { error } = await createClient().rpc(fn, args);
  return error ? friendlyError(error, "That didn't work.") : null;
}

function Reports() {
  const [status, setStatus] = useState("open");
  const { rows, error, reload } = useRpc("staff_open_reports", { p_status: status, p_limit: 50 });
  const [actionError, setActionError] = useState<string | null>(null);
  const resolve = async (id: string, next: string) => {
    const note = next === "reviewing" ? null : window.prompt("Note (optional, kept in the audit log):") ?? null;
    setActionError(await call("admin_update_report", { p_report_id: id, p_status: next, p_note: note }));
    reload();
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {["open", "reviewing", "actioned", "dismissed", "all"].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={cn("font-mono text-[10px] uppercase tracking-widest px-3 py-2 border", status === s ? "border-acid text-acid" : "border-ink-border text-paper-dim")}>{s}</button>
        ))}
      </div>
      <Err message={error ?? actionError} />
      {rows?.length === 0 && <p className="text-sm text-paper-dim">Nothing here.</p>}
      {rows?.map((r) => (
        <Box key={str(r.id)}>
          <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
            {str(r.context_type)} · {str(r.status)} · {when(r.created_at)}
          </p>
          <p className="mt-2 text-sm whitespace-pre-wrap">{str(r.reason)}</p>
          <p className="mt-2 text-xs text-paper-dim">
            Reported by {str(r.reporter_label)} → {str(r.reported_label) || "(no one)"} · context id <span className="font-mono">{str(r.context_id).slice(0, 8)}</span>
          </p>
          {str(r.resolution_note) && <p className="mt-1 text-xs">Note: {str(r.resolution_note)}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => resolve(str(r.id), "reviewing")}>Reviewing</Button>
            <Button size="sm" onClick={() => resolve(str(r.id), "actioned")}>Actioned</Button>
            <Button size="sm" variant="outline" onClick={() => resolve(str(r.id), "dismissed")}>Dismiss</Button>
          </div>
        </Box>
      ))}
    </div>
  );
}

function Support() {
  const [status, setStatus] = useState("open");
  const { rows, error, reload } = useRpc("staff_support_requests", { p_status: status, p_limit: 50 });
  const [actionError, setActionError] = useState<string | null>(null);
  const set = async (id: string, next: string) => {
    const note = window.prompt("Note (optional):") ?? null;
    setActionError(await call("admin_update_support_request", { p_id: id, p_status: next, p_note: note }));
    reload();
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {["open", "answered", "closed", "all"].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={cn("font-mono text-[10px] uppercase tracking-widest px-3 py-2 border", status === s ? "border-acid text-acid" : "border-ink-border text-paper-dim")}>{s}</button>
        ))}
      </div>
      <Err message={error ?? actionError} />
      {rows?.length === 0 && <p className="text-sm text-paper-dim">Nothing here.</p>}
      {rows?.map((r) => (
        <Box key={str(r.id)}>
          <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">{str(r.topic)} · {str(r.status)} · {when(r.created_at)}</p>
          <p className="mt-1 text-sm"><a className="underline" href={`mailto:${str(r.email)}`}>{str(r.email)}</a></p>
          <p className="mt-2 text-sm whitespace-pre-wrap">{str(r.message)}</p>
          {str(r.staff_note) && <p className="mt-1 text-xs">Note: {str(r.staff_note)}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => set(str(r.id), "answered")}>Mark answered</Button>
            <Button size="sm" variant="outline" onClick={() => set(str(r.id), "closed")}>Close</Button>
          </div>
        </Box>
      ))}
    </div>
  );
}

function Users({ isAdmin }: { isAdmin: boolean }) {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const { rows, error, reload } = useRpc("staff_find_users", { p_q: applied, p_limit: 25 });
  const [suspendTarget, setSuspendTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); }}>
        <input className="flex-1 border border-ink-border bg-transparent px-3.5 py-2.5 text-sm" placeholder="Email, username or id" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        <Button type="submit" size="md">Search</Button>
      </form>
      <Err message={error ?? actionError} />
      {rows?.map((u) => (
        <Box key={str(u.id)}>
          <p className="text-sm">{str(u.email)} <span className="text-paper-dim">· {str(u.role)}{u.admin_role ? ` · staff (${str(u.admin_role)})` : ""}</span></p>
          <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mt-1">{str(u.id)} · joined {when(u.created_at)}</p>
          {u.suspended_at ? <p className="mt-1 text-xs text-signal">Suspended {when(u.suspended_at)}: {str(u.suspension_reason)}</p> : null}
          <div className="mt-3 flex gap-2">
            {u.suspended_at ? (
              <Button size="sm" variant="outline" onClick={async () => { setActionError(await call("admin_unsuspend_user", { p_profile_id: u.id })); reload(); }}>Unsuspend</Button>
            ) : !u.admin_role ? (
              <Button size="sm" variant="danger" onClick={() => { setModalError(null); setSuspendTarget(str(u.id)); }}>Suspend…</Button>
            ) : null}
            {isAdmin && (
              <>
                <Button size="sm" variant="outline" onClick={async () => { setActionError(await call("admin_set_verification", { p_profile_id: u.id, p_verified: true })); }}>Mark verified</Button>
                <Button size="sm" variant="outline" onClick={async () => { setActionError(await call("admin_set_verification", { p_profile_id: u.id, p_verified: false })); }}>Remove verified</Button>
              </>
            )}
          </div>
        </Box>
      ))}
      <ReasonModal
        open={!!suspendTarget}
        title="Suspend this account?"
        body="They can't apply, post, message or pay until unsuspended. Existing bookings are left as they are. This is recorded in the audit log."
        confirmLabel="Suspend"
        requireReason
        busy={busy}
        error={modalError}
        onClose={() => setSuspendTarget(null)}
        onConfirm={async (reason) => {
          setBusy(true);
          const err = await call("admin_suspend_user", { p_profile_id: suspendTarget, p_reason: reason });
          setBusy(false);
          if (err) return setModalError(err);
          setSuspendTarget(null);
          reload();
        }}
      />
    </div>
  );
}

function Listings() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const { rows, error, reload } = useRpc("staff_recent_slots", { p_q: applied, p_limit: 50 });
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); }}>
        <input className="flex-1 border border-ink-border bg-transparent px-3.5 py-2.5 text-sm" placeholder="Headliner or listing id" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search listings" />
        <Button type="submit" size="md">Search</Button>
      </form>
      <Err message={error} />
      {rows?.map((s) => (
        <Box key={str(s.id)}>
          <p className="text-sm">{str(s.headliner)} <span className="text-paper-dim">· {str(s.city)} · {str(s.date)} · {str(s.status)} · {str(s.applicant_count)} applicants</span></p>
          <p className="text-xs text-paper-dim">{str(s.promoter_company)} · <a className="underline" href={`/slot/${str(s.id)}`}>view</a></p>
          {s.status !== "cancelled" && (
            <Button size="sm" variant="danger" className="mt-3" onClick={() => { setModalError(null); setTarget(str(s.id)); }}>Remove listing…</Button>
          )}
        </Box>
      ))}
      <ReasonModal
        open={!!target}
        title="Remove this listing?"
        body="Applicants are told it was cancelled and the promoter is told why. A confirmed booking is cancelled."
        confirmLabel="Remove listing"
        requireReason
        busy={busy}
        error={modalError}
        onClose={() => setTarget(null)}
        onConfirm={async (reason) => {
          setBusy(true);
          const err = await call("admin_remove_listing", { p_slot_id: target, p_reason: reason });
          setBusy(false);
          if (err) return setModalError(err);
          setTarget(null);
          reload();
        }}
      />
    </div>
  );
}

function Bookings() {
  const { rows, error } = useRpc("admin_recent_bookings", { p_limit: 100 });
  return (
    <div className="space-y-3">
      <p className="text-sm text-paper-dim max-w-[70ch]">
        Admin only. The agreed terms of recent bookings. Support Slot doesn&rsquo;t handle payment, so there is no payment status
        here.
      </p>
      <Err message={error} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
            <tr><th className="py-2 pr-4">Show</th><th className="pr-4">Artist</th><th className="pr-4">Status</th><th className="pr-4">Date</th><th className="pr-4">Fee</th><th>Travel</th></tr>
          </thead>
          <tbody>
            {rows?.map((b) => (
              <tr key={str(b.id)} className="border-t border-ink-border">
                <td className="py-2 pr-4">{str(b.headliner)}<span className="block text-xs text-paper-dim">{str(b.promoter_company)}</span></td>
                <td className="pr-4">{str(b.artist_name)}</td>
                <td className="pr-4">{str(b.status)}</td>
                <td className="pr-4">{str(b.event_date)}</td>
                <td className="pr-4">{formatPence(Number(b.fee_pence))}</td>
                <td>{formatPence(Number(b.travel_pence))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Audit() {
  const { rows, error } = useRpc("staff_audit_log", { p_limit: 150 });
  return (
    <div className="space-y-2">
      <Err message={error} />
      {rows?.map((a) => (
        <p key={str(a.id)} className="border-t border-ink-border py-2 text-sm">
          <span className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">{when(a.created_at)} · {str(a.actor_role)}</span>
          <br />
          {str(a.action)} on {str(a.target_type)} <span className="font-mono text-xs">{str(a.target_id).slice(0, 8)}</span>
          {a.details && Object.keys(a.details as object).length > 0 ? <span className="text-xs text-paper-dim"> · {JSON.stringify(a.details)}</span> : null}
        </p>
      ))}
    </div>
  );
}

export default function AdminPage() {
  const { adminRole } = useStore();
  const [tab, setTab] = useState<Tab>("reports");
  const isAdmin = adminRole === "admin";
  const tabs: Array<[Tab, string]> = [["reports", "Reports"], ["support", "Support"], ["users", "Users"], ["listings", "Listings"], ...(isAdmin ? ([["bookings", "Bookings"]] as Array<[Tab, string]>) : []), ["audit", "Audit log"]];
  const select = useCallback((t: Tab) => setTab(t), []);
  if (!adminRole) return null;
  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">Staff · {adminRole}</p>
      <h1 className="font-display uppercase text-4xl leading-none tracking-tight">Admin</h1>
      <div className="mt-6 flex flex-wrap gap-2" role="tablist">
        {tabs.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => select(t)} className={cn("font-mono text-[11px] uppercase tracking-widest px-3.5 py-2.5 border transition-colors", tab === t ? "border-acid text-acid" : "border-ink-border text-paper-dim hover:border-paper")}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-8">
        {tab === "reports" && <Reports />}
        {tab === "support" && <Support />}
        {tab === "users" && <Users isAdmin={isAdmin} />}
        {tab === "listings" && <Listings />}
        {tab === "bookings" && isAdmin && <Bookings />}
        {tab === "audit" && <Audit />}
      </div>
    </div>
  );
}
