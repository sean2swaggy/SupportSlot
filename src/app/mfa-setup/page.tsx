"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/layout/Logo";
import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

export default function MfaSetupPage() {
  const router = useRouter();
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      // Clean up any unverified factor left over from an abandoned earlier
      // attempt (e.g. they refreshed mid-setup) before enrolling a fresh
      // one — enroll() is the only call that returns a QR code, so a stale
      // unverified factor can't just be resumed.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const stale = factors?.all.find((f) => f.factor_type === "totp" && f.status === "unverified");
      if (stale) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id });
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator app",
      });
      if (error || !data || data.type !== "totp") {
        setLoadError(error?.message ?? "Couldn't start two-factor setup — try reloading.");
        return;
      }
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
    })();
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
    // Session is now aal2 — middleware will let normal routes through.
    router.push("/");
    router.refresh();
  };

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-[440px] flex-col justify-center px-4 sm:px-0 py-16">
      <div className="mb-8 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <h1 className="mt-6 font-display text-2xl">Set up two-factor authentication</h1>
        <p className="mt-3 text-sm text-paper-dim">
          Every Support Slot account requires this — it protects your account even if your
          password is ever compromised. You&rsquo;ll need an authenticator app (Google
          Authenticator, Authy, 1Password, etc.).
        </p>
      </div>

      {loadError && (
        <div className="border border-signal/50 bg-signal/10 p-4 text-center">
          <p className="text-sm text-signal">{loadError}</p>
          <Button size="md" className="mt-4" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      )}

      {!loadError && !qrCode && (
        <p className="text-center text-sm text-paper-dim">Setting up…</p>
      )}

      {qrCode && (
        <form onSubmit={verify} className="space-y-6">
          <div className="flex justify-center border border-ink-border bg-paper p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrCode} alt="Scan this QR code with your authenticator app" className="h-48 w-48" />
          </div>

          {secret && (
            <p className="text-center text-[11px] text-paper-dim">
              Can&rsquo;t scan it? Enter this code manually:{" "}
              <span className="font-mono text-paper break-all">{secret}</span>
            </p>
          )}

          <div>
            <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
              6-digit code from your app
            </label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              className="w-full border border-ink-border bg-transparent px-3.5 py-3 text-center text-lg tracking-[0.3em] outline-none focus:border-paper"
            />
          </div>

          {verifyError && <p className="text-xs text-signal text-center">{verifyError}</p>}

          <Button type="submit" size="lg" className="w-full" disabled={verifying || code.length !== 6}>
            {verifying ? "Verifying…" : "Confirm and finish"}
          </Button>
        </form>
      )}
    </div>
  );
}
