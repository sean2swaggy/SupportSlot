"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { getBlockedPromoters, unblockPromoter } from "@/lib/queries";
import { isPasswordAcceptable } from "@/lib/password";
import { friendlyError } from "@/lib/errors";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

const fieldCls = "w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60";
const labelCls = "font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-ink-border p-5 sm:p-6">
      <h2 className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-4">{title}</h2>
      {children}
    </section>
  );
}

function EmailPreference() {
  const { emailNotifications, setEmailNotificationsPref } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Section title="Email notifications">
      <label className="flex items-start justify-between gap-4 cursor-pointer">
        <span className="text-sm">
          Email me when something needs my attention (an offer, a booking change, a message).
          <span className="block text-xs text-paper-dim mt-1">
            In-app notifications always work. Emails are only sent when our email provider is set up for this site, and only
            counted as sent once the provider confirms it.
          </span>
        </span>
        <input
          type="checkbox"
          checked={emailNotifications}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            setError(null);
            const result = await setEmailNotificationsPref(e.target.checked);
            if (!result.ok) setError(result.error);
            setBusy(false);
          }}
          className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-acid)]"
        />
      </label>
      {error && <p className="mt-3 text-sm text-signal" role="alert">{error}</p>}
    </Section>
  );
}

function ChangePassword() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async () => {
    setError(null);
    setDone(false);
    if (!isPasswordAcceptable(password)) return setError("Choose a stronger password: at least 8 characters, not a common one.");
    setBusy(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (updateError) return setError(friendlyError(updateError, "We couldn't change your password. Please try again."));
    setPassword("");
    setDone(true);
  };
  return (
    <Section title="Password">
      <label htmlFor="st-pw" className={labelCls}>New password</label>
      <input id="st-pw" type="password" autoComplete="new-password" className={fieldCls} value={password} onChange={(e) => setPassword(e.target.value)} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={submit} disabled={busy || password.length === 0}>{busy ? "Saving…" : "Change password"}</Button>
        {done && <span className="font-mono text-[10px] uppercase tracking-widest text-ok">Password changed ✓</span>}
      </div>
      {error && <p className="mt-3 text-sm text-signal" role="alert">{error}</p>}
    </Section>
  );
}

function BlockedList() {
  const { role, userId } = useStore();
  const [items, setItems] = useState<Array<{ promoterId: string; company: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (role !== "artist" || !userId) return;
    let cancelled = false;
    getBlockedPromoters(createClient(), userId)
      .then((rows) => !cancelled && setItems(rows))
      .catch(() => !cancelled && setError("We couldn't load your blocked list."));
    return () => {
      cancelled = true;
    };
  }, [role, userId]);
  if (role !== "artist") return null;
  return (
    <Section title="Blocked promoters">
      {error ? (
        <p className="text-sm text-signal" role="alert">{error}</p>
      ) : items === null ? (
        <p className="text-sm text-paper-dim">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-paper-dim">You haven&rsquo;t blocked anyone. You can block a promoter from a conversation.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((b) => (
            <li key={b.promoterId} className="flex items-center justify-between gap-3 text-sm">
              {b.company}
              <button
                type="button"
                className="font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-paper underline"
                onClick={async () => {
                  const ok = userId ? await unblockPromoter(createClient(), userId, b.promoterId) : false;
                  if (ok) setItems((prev) => (prev ?? []).filter((x) => x.promoterId !== b.promoterId));
                  else setError("We couldn't unblock them. Please try again.");
                }}
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setDetail(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "We couldn't delete your account.");
        setDetail(body.detail ?? null);
        setBusy(false);
        return;
      }
      await createClient().auth.signOut().catch(() => undefined);
      router.push("/");
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Nothing was deleted — please try again.");
      setBusy(false);
    }
  };

  return (
    <Section title="Delete account">
      <p className="text-sm text-paper-dim max-w-[60ch]">
        Permanently deletes your profile, messages and saved gigs, and withdraws anything still open. Past booking records are
        kept, but are no longer linked to you. You can&rsquo;t delete while you have an upcoming confirmed booking &mdash; cancel it
        first.
      </p>
      <Button variant="danger" size="sm" className="mt-4" onClick={() => { setOpen(true); setConfirm(""); setError(null); setDetail(null); }}>
        Delete my account…
      </Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} labelledBy="del-title">
        <div className="p-6 sm:p-7">
          <h2 id="del-title" className="font-display text-2xl">Delete your account?</h2>
          <p className="mt-2 text-sm text-paper-dim">This can&rsquo;t be undone. Type DELETE to confirm.</p>
          <input aria-label="Type DELETE to confirm" className={`${fieldCls} mt-4`} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          {error && <p className="mt-3 text-sm text-signal" role="alert">{error}</p>}
          {detail && <p className="mt-1 text-xs text-paper-dim">{detail}</p>}
          <div className="mt-5 flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setOpen(false)} disabled={busy}>Keep my account</Button>
            <Button variant="danger" className="flex-1" onClick={submit} disabled={busy || confirm !== "DELETE"}>{busy ? "Deleting…" : "Delete forever"}</Button>
          </div>
        </div>
      </Modal>
    </Section>
  );
}

export default function SettingsPage() {
  const { accountEmail, role } = useStore();
  return (
    <div className="mx-auto max-w-[720px] px-4 sm:px-6 py-10 sm:py-14">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">Account</p>
      <h1 className="font-display uppercase text-4xl leading-none tracking-tight">Settings</h1>
      <p className="mt-3 text-paper-dim text-sm">
        Signed in as {accountEmail ?? "your account"} ({role}). <Link href="/support" className="underline">Need help?</Link>
      </p>
      <div className="mt-8 space-y-6">
        <EmailPreference />
        <ChangePassword />
        <BlockedList />
        <Section title="Your data">
          <p className="text-sm text-paper-dim max-w-[60ch]">
            Download a copy of the personal data we hold about you — profile, applications, bookings, messages and more — as a JSON file.
          </p>
          <a href="/api/account/export" download className="mt-4 inline-block border border-ink-border px-4 py-2.5 font-mono text-xs uppercase tracking-wide hover:border-paper transition-colors">
            Download my data
          </a>
        </Section>
        <DeleteAccount />
      </div>
    </div>
  );
}
