"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/layout/Logo";
import Button from "@/components/ui/Button";
import PasswordStrengthMeter from "@/components/account/PasswordStrengthMeter";
import { createClient } from "@/lib/supabase/client";
import { isPasswordAcceptable } from "@/lib/password";

// Reached only after /auth/callback has already exchanged a real recovery
// code for a session — this page never handles the code itself (see that
// route for why it has to happen there, not here). middleware.ts still
// applies its normal gates on the way in, including mandatory 2FA if the
// account has it — recovering a forgotten password doesn't skip that.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isPasswordAcceptable(password)) {
      setError("Choose a stronger password before continuing.");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-[420px] flex-col justify-center px-4 sm:px-0 py-16">
      <div className="mb-10 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <h1 className="mt-6 font-display text-2xl">Choose a new password</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
            New password
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoFocus
            className="w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60"
          />
          <PasswordStrengthMeter password={password} />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={submitting || !isPasswordAcceptable(password)}
        >
          {submitting ? "Saving…" : "Save new password"}
        </Button>
      </form>
    </div>
  );
}
