"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import Navbar from "@/components/layout/Navbar";
import MobileNav from "@/components/layout/MobileNav";
import Footer from "@/components/layout/Footer";
import Button from "@/components/ui/Button";
import { isAuthScreen, isPublicPath, isUnder, SUSPENDED_ALLOWED } from "@/lib/routes";
import { loginUrlFor } from "@/lib/redirect";

const ONBOARDING_PATH = "/onboarding";
// Screens that render bare — no nav, no footer. Either the nav's links would
// only bounce straight back (2FA), or the person is mid-flow (onboarding,
// login, reset).
const BARE_PATHS = ["/reset-password"];

/**
 * The client shell. The real access control is src/proxy.ts (server-side,
 * runs before any of this renders, using the same rules from lib/routes.ts);
 * this adds the loading and failure states, the nav that matches who's
 * looking (a visitor, an artist, a promoter), and the "don't remount
 * /onboarding mid-flow" guard below.
 */
export default function AppGate({ children }: { children: React.ReactNode }) {
  const { hydrated, signedIn, hasOnboarded, suspended, loadError, reload } = useStore();
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const onOnboardingRoute = pathname.startsWith(ONBOARDING_PATH);
  const onAuthScreen = isAuthScreen(pathname) || BARE_PATHS.includes(pathname);

  useEffect(() => {
    if (!hydrated) return;
    if (!signedIn) {
      // The proxy has already redirected; this covers a session that expired
      // while the tab sat open.
      if (!isPublicPath(pathname) && !onAuthScreen) router.replace(loginUrlFor(pathname, window.location.search));
      return;
    }
    if (suspended && !isUnder(pathname, SUSPENDED_ALLOWED)) {
      router.replace("/suspended");
      return;
    }
    if (!hasOnboarded && !onOnboardingRoute && !isPublicPath(pathname)) router.replace(ONBOARDING_PATH);
  }, [hydrated, signedIn, suspended, hasOnboarded, onOnboardingRoute, onAuthScreen, pathname, router]);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="font-display text-lg uppercase tracking-tight text-paper-dim select-none">
          Support<span className="text-acid">/</span>Slot
        </span>
      </div>
    );
  }

  // Signed in, but their data couldn't be loaded. Never show an empty
  // dashboard as if nothing existed.
  if (signedIn && loadError) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center" role="alert">
        <p className="font-display text-2xl">We couldn&rsquo;t load your account</p>
        <p className="mt-2 text-sm text-paper-dim">{loadError}</p>
        <Button className="mt-6" onClick={() => void reload()}>
          Try again
        </Button>
      </div>
    );
  }

  // Onboarding always renders bare, finished or not: completeOnboarding()
  // flips `hasOnboarded` partway through (before the welcome screen), and if
  // that changed which layout wraps this route React would remount the page
  // and wipe the in-progress step.
  if (onOnboardingRoute) return <main className="min-h-screen">{children}</main>;
  if (onAuthScreen && pathname !== "/suspended") return <main className="min-h-screen">{children}</main>;
  if (signedIn && !hasOnboarded && !isPublicPath(pathname)) return <main className="min-h-screen">{children}</main>;
  if (signedIn && suspended) return <main className="min-h-screen">{children}</main>;

  return (
    <>
      <Navbar />
      <main className="min-h-[70vh] pb-20 lg:pb-0">{children}</main>
      <Footer />
      <MobileNav />
    </>
  );
}
