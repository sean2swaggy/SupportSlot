"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

const labelCls = "font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block";

/**
 * Real email verification via Supabase Auth's built-in confirmation email —
 * no mock code. The account's email is fixed (it's whatever was used to
 * sign up); this panel can resend the confirmation link and re-check
 * whether it's been clicked yet.
 */
export default function EmailVerifyPanel({
  initialEmail = "",
  onVerified,
}: {
  initialEmail?: string;
  onVerified: (email: string) => void;
}) {
  const [resent, setResent] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resend = async () => {
    if (!initialEmail) return;
    setError(null);
    const supabase = createClient();
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: initialEmail,
    });
    if (resendError) {
      setError(resendError.message);
      return;
    }
    setResent(true);
  };

  const checkVerified = async () => {
    setChecking(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.email_confirmed_at) {
        onVerified(user.email ?? initialEmail);
      } else {
        setError("Not verified yet — click the link in the email first, then try again.");
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Email address</label>
        <p className="text-sm text-paper">{initialEmail}</p>
      </div>

      <div className="border border-dashed border-ink-border p-4 space-y-3">
        <p className="text-sm text-paper-dim">
          We sent a confirmation link to <span className="text-paper">{initialEmail}</span>.
          Click it, then come back and hit &ldquo;I&rsquo;ve verified&rdquo; below.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button type="button" variant="outline" size="md" onClick={resend} className="shrink-0">
            {resent ? "Email resent" : "Resend email"}
          </Button>
          <Button type="button" size="md" onClick={checkVerified} disabled={checking} className="shrink-0">
            {checking ? "Checking…" : "I've verified"}
          </Button>
        </div>
      </div>

      {error && <p className="text-xs text-signal">{error}</p>}
    </div>
  );
}
