// One table of who can reach what, used by BOTH the server-side proxy
// (src/lib/supabase/middleware.ts — the real enforcement) and the client-side
// shell (AppGate.tsx — chrome and loading states). Keeping this in one place
// stops the two lists drifting apart, which is exactly the bug that bounced
// /forgot-password to /login during the security audit.

import { loginUrlFor, safeNextPath } from "./redirect";

export type Role = "artist" | "promoter";

/** Reachable with no account (and by every signed-in user). */
const PUBLIC_EXACT = [
  "/", "/discover", "/last-minute", "/privacy", "/terms", "/trust", "/support",
  "/login", "/forgot-password",
];
// /auth/ is the email-link callback: it has to run signed-out to turn the
// one-time code into a session (it validates its own `next`).
const PUBLIC_PREFIXES = ["/slot/", "/artist/", "/auth/"];

/** Auth-flow screens: reachable signed-out (login) or mid-flow (the rest). */
export const AUTH_SCREENS = ["/login", "/forgot-password", "/onboarding", "/mfa-setup", "/mfa-challenge", "/suspended"];

export const PROMOTER_ONLY_PREFIXES = ["/create-slot", "/dashboard/promoter", "/promoter"];
export const ARTIST_ONLY_PREFIXES = ["/dashboard/artist", "/applications", "/requests", "/saved"];
export const ADMIN_PREFIX = "/admin";

// A suspended account can read the rules and contact support, nothing else.
export const SUSPENDED_ALLOWED = ["/suspended", "/support", "/privacy", "/terms", "/trust"];

export function isUnder(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : p + "/"));
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function isAuthScreen(pathname: string): boolean {
  return AUTH_SCREENS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Each role's own home. "/" is the artist-facing home; promoters land on Discover Artists. */
export function landingPathFor(role: Role): string {
  return role === "artist" ? "/" : "/discover";
}

export type Access =
  | { allow: true }
  | { allow: false; redirect: string };

/**
 * The access decision for an already-authenticated, onboarded, 2FA-verified
 * account hitting a path. (Signed-out, onboarding, 2FA and suspension are
 * handled before this, in the proxy.)
 */
export function roleAccess(pathname: string, role: Role, adminRole: string | null): Access {
  if (isUnder(pathname, [ADMIN_PREFIX])) {
    return adminRole ? { allow: true } : { allow: false, redirect: landingPathFor(role) };
  }
  const wrongRole =
    (isUnder(pathname, PROMOTER_ONLY_PREFIXES) && role !== "promoter") ||
    (isUnder(pathname, ARTIST_ONLY_PREFIXES) && role !== "artist");
  if (wrongRole) return { allow: false, redirect: landingPathFor(role) };
  if (pathname === "/" && role === "promoter") return { allow: false, redirect: landingPathFor(role) };
  return { allow: true };
}

// ---------------------------------------------------------------------------
// The full access decision. Pure, so every branch is unit-tested
// (routes.test.ts); the proxy just gathers the facts and applies the result.
// ---------------------------------------------------------------------------
export interface AccessContext {
  pathname: string;
  search: string; // including the leading "?", or ""
  signedIn: boolean;
  profile: { role: Role; hasOnboarded: boolean; suspended: boolean; adminRole: string | null } | null;
  mfa: "ok" | "needs_setup" | "needs_challenge";
}

const ALWAYS_READABLE = ["/privacy", "/terms", "/trust", "/support"];

/** Where to send the request instead, or null to let it through. */
export function decideAccess(ctx: AccessContext): string | null {
  const { pathname, search } = ctx;
  const here = safeNextPath(pathname + search);
  const withNext = (to: string) => (here ? `${to}?next=${encodeURIComponent(here)}` : to);

  if (!ctx.signedIn) {
    return isPublicPath(pathname) ? null : loginUrlFor(pathname, search);
  }

  // Legal/policy pages are always readable, in any account state.
  if (ALWAYS_READABLE.includes(pathname)) return null;

  const profile = ctx.profile ?? { role: "artist" as Role, hasOnboarded: false, suspended: false, adminRole: null };

  if (profile.suspended) {
    return isUnder(pathname, SUSPENDED_ALLOWED) ? null : "/suspended";
  }
  if (!profile.hasOnboarded) {
    return pathname === "/onboarding" || pathname.startsWith("/onboarding/") ? null : withNext("/onboarding");
  }
  if (ctx.mfa === "needs_setup") return pathname === "/mfa-setup" ? null : withNext("/mfa-setup");
  if (ctx.mfa === "needs_challenge") return pathname === "/mfa-challenge" ? null : withNext("/mfa-challenge");

  // Fully signed in: the auth screens have nothing left to do — send them on,
  // to where they were going if we know, else their home.
  if (isAuthScreen(pathname)) {
    const next = safeNextPath(new URLSearchParams(search).get("next"));
    return next ?? landingPathFor(profile.role);
  }

  const access = roleAccess(pathname, profile.role, profile.adminRole);
  return access.allow ? null : access.redirect;
}
