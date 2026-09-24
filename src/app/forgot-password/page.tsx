"use client";

import { useState } from "react";
import Link from "next/link";
import Logo from "@/components/layout/Logo";
import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

// The one account-recovery path this app was missing entirely — someone
// who forgets their password previously had no way back in at all. Reuses
// Supabase's own hosted email-link flow (real, not the mock 6-digit code
// EmailVerifyPanel uses for signup) through /auth/callback, which then
// lands them on /reset-password to actually choose a new one.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const supabase = createClient();
    // Supabase's own resetPasswordForEmail already doesn't error for an
    // email with no account (it just doesn't send anything) — exactly to
    // prevent enumerating real accounts by trying addresses here, so any
    // error that does come back is a genuine failure (network, rate limit),
    // safe to surface as-is.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setSubmitting(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <div className="mx-auto flex min-h-[80vh] max-w-[420px] flex-col justify-center px-4 sm:px-0 py-16 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <h1 className="mt-6 font-display text-2xl">Check your inbox</h1>
        <p className="mt-3 text-sm text-paper-dim">
          If there&rsquo;s an account for <span className="text-paper">{email}</span>, we&rsquo;ve
          sent a link to reset your password.
        </p>
        <Link
          href="/login"
          className="mt-8 font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-signal transition-colors"
        >
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-[420px] flex-col justify-center px-4 sm:px-0 py-16">
      <div className="mb-10 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <h1 className="mt-6 font-display text-2xl">Reset your password</h1>
        <p className="mt-3 text-sm text-paper-dim">
          Enter your account email and we&rsquo;ll send you a reset link.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            className="w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60"
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      <p className="mt-8 text-center text-xs text-paper-dim">
        <Link href="/login" className="underline">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
