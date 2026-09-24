"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import Navbar from "@/components/layout/Navbar";
import MobileNav from "@/components/layout/MobileNav";
import Footer from "@/components/layout/Footer";

const ONBOARDING_PATH = "/onboarding";
const LOGIN_PATH = "/login";
// Kept in sync with PUBLIC_PATHS in src/lib/supabase/middleware.ts — these
// must be reachable without an account (see that file for why).
const PUBLIC_PATHS = ["/privacy", "/terms", "/trust"];
// Same idea as onboarding below — these render bare, not because they're
// unauthenticated but because the normal nav's links would all just bounce
// straight back here (middleware.ts enforces the mandatory-2FA gate
// regardless of what the client renders); showing full site chrome the
// user can't actually use is confusing, not just redundant.
const MFA_PATHS = ["/mfa-setup", "/mfa-challenge"];

/**
 * Gates the whole app behind signup: until the signed-in account has
 * finished onboarding, every route bounces to /onboarding and none of the
 * normal site chrome (nav, footer) renders. The real enforcement is
 * middleware.ts (server-side, runs before this ever renders) — this is
 * defense-in-depth plus the client-side loading state while the session
 * hydrates, and it owns the "don't remount /onboarding mid-flow" guard
 * below, which middleware doesn't touch.
 */
export default function AppGate({ children }: { children: React.ReactNode }) {
  const { hydrated, hasOnboarded } = useStore();
  const pathname = usePathname();
  const router = useRouter();
  const onOnboardingRoute = pathname?.startsWith(ONBOARDING_PATH) ?? false;
  const onLoginRoute = pathname === LOGIN_PATH;
  const onPublicRoute = PUBLIC_PATHS.includes(pathname ?? "");
  const onMfaRoute = MFA_PATHS.includes(pathname ?? "");

  useEffect(() => {
    // /login and the public legal pages are exempt too — middleware.ts is
    // the real authority on whether a signed-out (or not-yet-onboarded)
    // visitor belongs there; this effect only needs to catch the
    // signed-in-but-not-onboarded case elsewhere.
    if (hydrated && !hasOnboarded && !onOnboardingRoute && !onLoginRoute && !onPublicRoute) {
      router.replace(ONBOARDING_PATH);
    }
  }, [hydrated, hasOnboarded, onOnboardingRoute, onLoginRoute, onPublicRoute, router]);

  // Before we know whether this (mock) account has already signed up, show
  // nothing but a bare mark rather than flashing the full app or the gate.
  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="font-display text-lg uppercase tracking-tight text-paper-dim select-none">
          Support<span className="text-acid">/</span>Slot
        </span>
      </div>
    );
  }

  // Always render onboarding bare (no nav/footer), whether or not it's
  // finished yet — completeOnboarding() flips `hasOnboarded` to true partway
  // through the flow (on the last step, before the "welcome" screen), and if
  // that flip changed which layout wraps this route, React would remount
  // the onboarding page's own subtree and wipe its in-progress step state.
  // Keeping this route's chrome constant sidesteps that entirely; the
  // gate still applies to every other route.
  if (onOnboardingRoute) {
    return <main className="min-h-screen">{children}</main>;
  }

  if (!hasOnboarded) {
    // Not onboarded and not already on /onboarding — the effect above is
    // about to redirect there; render the same bare shell meanwhile so
    // nothing else briefly flashes.
    return <main className="min-h-screen">{children}</main>;
  }

  // Mandatory-2FA setup/challenge — bare shell, same reasoning as
  // onboarding above. Each of these pages provides its own way to log out.
  if (onMfaRoute) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <>
      <Navbar />
      <main className="min-h-[70vh] pb-20 lg:pb-0">{children}</main>
      <Footer />
      <MobileNav />
    </>
  );
}
