"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/layout/Logo";
import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

export default function MfaChallengePage() {
  const router = useRouter();

  const logOut = async () => {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const [factorId, setFactorId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      const totp = data?.totp[0];
      if (error || !totp) {
        setLoadError("Couldn't find your authenticator — try logging in again.");
        return;
      }
      setFactorId(totp.id);
    });
  }, []);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    setVerifying(true);
    setVerifyError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setVerifying(false);
    if (error) {
      setVerifyError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-[420px] flex-col justify-center px-4 sm:px-0 py-16">
      <div className="mb-8 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <button
          type="button"
          onClick={logOut}
          className="mt-4 font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-signal transition-colors"
        >
          Log out
        </button>
        <h1 className="mt-6 font-display text-2xl">Enter your code</h1>
        <p className="mt-3 text-sm text-paper-dim">
          Open your authenticator app and enter the current 6-digit code.
        </p>
      </div>

      {loadError ? (
        <p className="text-center text-sm text-signal">{loadError}</p>
      ) : (
        <form onSubmit={verify} className="space-y-6">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            autoFocus
            className="w-full border border-ink-border bg-transparent px-3.5 py-3 text-center text-lg tracking-[0.3em] outline-none focus:border-paper"
          />
          {verifyError && <p className="text-xs text-signal text-center">{verifyError}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={verifying || code.length !== 6 || !factorId}>
            {verifying ? "Verifying…" : "Verify"}
          </Button>
        </form>
      )}
    </div>
  );
}
