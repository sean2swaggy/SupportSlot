"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import Button from "@/components/ui/Button";

const TOPICS = [
  { value: "account", label: "My account or login" },
  { value: "payment", label: "A payment or payout" },
  { value: "booking", label: "A booking" },
  { value: "bug", label: "Something isn't working" },
  { value: "other", label: "Something else" },
];
const fieldCls = "w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60";
const labelCls = "font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block";

export default function SupportPage() {
  const { signedIn, accountEmail } = useStore();
  const [topic, setTopic] = useState("account");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, message, email: signedIn ? undefined : email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "We couldn't send that. Please try again.");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't send that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[640px] px-4 sm:px-6 py-12 sm:py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">Help</p>
      <h1 className="font-display uppercase text-4xl leading-none tracking-tight">Contact support</h1>
      <p className="mt-4 text-paper-dim">
        Tell us what&rsquo;s wrong and we&rsquo;ll reply by email. For a problem with a specific listing or person, use the
        Report button on that page so it reaches the right team. See also our <Link href="/trust" className="underline">Trust &amp; Safety</Link> page.
      </p>

      {sent ? (
        <div className="mt-8 border border-ok/50 bg-ok/5 p-6" role="status">
          <p className="font-display text-xl">Request received</p>
          <p className="mt-2 text-sm text-paper-dim">
            It&rsquo;s in our queue. We reply to {signedIn ? "the email on your account" : email}. We don&rsquo;t promise an exact time,
            but a person reads every request.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-5">
          <div>
            <label htmlFor="sp-topic" className={labelCls}>What is this about?</label>
            <select id="sp-topic" className={`${fieldCls} appearance-none`} value={topic} onChange={(e) => setTopic(e.target.value)}>
              {TOPICS.map((t) => (
                <option key={t.value} value={t.value} className="bg-ink-card">{t.label}</option>
              ))}
            </select>
          </div>
          {!signedIn && (
            <div>
              <label htmlFor="sp-email" className={labelCls}>Your email</label>
              <input id="sp-email" type="email" autoComplete="email" className={fieldCls} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          )}
          {signedIn && accountEmail && <p className="text-xs text-paper-dim">We&rsquo;ll reply to {accountEmail}.</p>}
          <div>
            <label htmlFor="sp-msg" className={labelCls}>What happened?</label>
            <textarea id="sp-msg" rows={6} maxLength={4000} className={fieldCls} value={message} onChange={(e) => setMessage(e.target.value)} />
            <p className="mt-1 text-right font-mono text-[10px] text-paper-dim">{message.length}/4000</p>
          </div>
          {error && <p className="text-sm text-signal" role="alert">{error}</p>}
          <Button size="lg" className="w-full" disabled={busy || message.trim().length < 10} onClick={submit}>
            {busy ? "Sending…" : "Send request"}
          </Button>
          <p className="text-[11px] text-paper-dim">Never include passwords or full card numbers. Support will never ask for them.</p>
        </div>
      )}
    </div>
  );
}
