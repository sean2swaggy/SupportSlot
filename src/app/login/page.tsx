"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/layout/Logo";
import Button from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup">(
    params.get("mode") === "signup" ? "signup" : "login"
  );
  const [type, setType] = useState<"artist" | "promoter">(
    (params.get("type") as "artist" | "promoter") ?? "artist"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Required, unticked by default — GDPR needs an affirmative opt-in for
  // agreeing to the Terms/Privacy Policy, not just clicking a submit button
  // next to some passive text.
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set once signUp succeeds but no session came back yet — the project
  // requires email confirmation before a session exists, so there's nothing
  // more to do here until the user clicks the link in their inbox.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "signup" && !agreed) {
      setError("You need to agree to the Terms and Privacy Policy to continue.");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();

    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { role: type },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        if (data.session) {
          router.push("/onboarding");
        } else {
          // No session yet — this project requires confirming the email
          // first. The confirmation link routes through /auth/callback,
          // which establishes the session and sends them to /onboarding.
          setAwaitingConfirmation(true);
        }
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      // middleware.ts sends them to /onboarding or the right dashboard
      // depending on profile state — no need to duplicate that logic here.
      router.push("/");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  if (awaitingConfirmation) {
    return (
      <div className="mx-auto flex min-h-[80vh] max-w-[420px] flex-col justify-center px-4 sm:px-0 py-16 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <h1 className="mt-6 font-display text-2xl">Check your inbox</h1>
        <p className="mt-3 text-sm text-paper-dim">
          We sent a confirmation link to <span className="text-paper">{email}</span>. Click it
          to finish setting up your account.
        </p>
        <Button
          variant="outline"
          size="lg"
          className="mt-8 w-full"
          disabled={submitting}
          onClick={async () => {
            setSubmitting(true);
            const supabase = createClient();
            await supabase.auth.resend({ type: "signup", email });
            setSubmitting(false);
          }}
        >
          Resend email
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-[420px] flex-col justify-center px-4 sm:px-0 py-16">
      <div className="mb-10 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <p className="mt-3 text-sm text-paper-dim">
          {mode === "login" ? "Welcome back." : "Find your next stage."}
        </p>
      </div>

      <div className="flex border border-ink-border mb-8">
        <button
          onClick={() => setMode("login")}
          className={cn(
            "flex-1 py-3 font-mono text-xs uppercase tracking-widest transition-colors",
            mode === "login" ? "bg-paper text-ink" : "text-paper-dim hover:text-paper"
          )}
        >
          Log in
        </button>
        <button
          onClick={() => setMode("signup")}
          className={cn(
            "flex-1 py-3 font-mono text-xs uppercase tracking-widest transition-colors border-l border-ink-border",
            mode === "signup" ? "bg-paper text-ink" : "text-paper-dim hover:text-paper"
          )}
        >
          Sign up
        </button>
      </div>

      {mode === "signup" && (
        <div className="flex gap-2 mb-6">
          <button
            type="button"
            onClick={() => setType("artist")}
            className={cn(
              "flex-1 border px-3 py-3 font-mono text-[11px] uppercase tracking-widest transition-colors",
              type === "artist" ? "border-acid text-acid" : "border-ink-border text-paper-dim"
            )}
          >
            I&rsquo;m an artist
          </button>
          <button
            type="button"
            onClick={() => setType("promoter")}
            className={cn(
              "flex-1 border px-3 py-3 font-mono text-[11px] uppercase tracking-widest transition-colors",
              type === "promoter" ? "border-acid text-acid" : "border-ink-border text-paper-dim"
            )}
          >
            I&rsquo;m a promoter
          </button>
        </div>
      )}

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
        <div>
          <label className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block">
            Password
          </label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60"
          />
        </div>
        {mode === "signup" && (
          <label className="flex items-start gap-2.5 text-xs text-paper-dim cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-acid"
            />
            <span>
              I agree to the{" "}
              <Link href="/terms" className="underline hover:text-paper">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="underline hover:text-paper">
                Privacy Policy
              </Link>
              , and understand there&rsquo;s{" "}
              <Link href="/trust" className="underline hover:text-paper">
                no pay-to-play
              </Link>{" "}
              on Support Slot.
            </span>
          </label>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={submitting || (mode === "signup" && !agreed)}
        >
          {submitting ? "Please wait…" : mode === "login" ? "Log in" : "Continue"}
        </Button>
      </form>

      {mode === "signup" && type === "artist" && (
        <>
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-ink-border" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">or</span>
            <span className="h-px flex-1 bg-ink-border" />
          </div>
          <Button variant="outline" size="lg" className="w-full" disabled>
            Continue with Spotify (coming soon)
          </Button>
        </>
      )}

      {mode === "login" && (
        <p className="mt-8 text-center text-xs text-paper-dim">
          <Link href="/terms" className="underline">
            Terms
          </Link>{" "}
          ·{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>{" "}
          ·{" "}
          <Link href="/trust" className="underline">
            No pay-to-play
          </Link>
        </p>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
