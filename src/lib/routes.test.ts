import { describe, expect, it } from "vitest";
import { isPublicPath, roleAccess } from "./routes";

describe("public vs private routes", () => {
  it("browsing listings, profiles and the rules needs no account", () => {
    for (const p of ["/", "/discover", "/slot/123", "/artist/someone", "/last-minute", "/privacy", "/terms", "/trust", "/support", "/login", "/forgot-password", "/auth/callback"]) {
      expect(isPublicPath(p), p).toBe(true);
    }
  });

  it("everything that's personal or that changes things requires an account", () => {
    for (const p of [
      "/applications", "/messages", "/dashboard/artist", "/dashboard/promoter", "/create-slot", "/saved", "/settings",
      "/dashboard/promoter/requests", "/promoter/slot/1/applicants", "/admin", "/admin/reports", "/onboarding", "/mfa-setup", "/reset-password",
      "/slot", "/artistry", // not prefixes of the public ones
    ]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });
});

describe("role access", () => {
  it("promoter-only pages bounce artists to their own home, and vice versa", () => {
    expect(roleAccess("/create-slot", "artist", null)).toEqual({ allow: false, redirect: "/" });
    expect(roleAccess("/dashboard/promoter/roster", "artist", null)).toMatchObject({ allow: false });
    expect(roleAccess("/dashboard/promoter/requests", "artist", null)).toMatchObject({ allow: false });
    expect(roleAccess("/applications", "promoter", null)).toEqual({ allow: false, redirect: "/discover" });
    expect(roleAccess("/dashboard/artist", "promoter", null)).toMatchObject({ allow: false });
    expect(roleAccess("/saved", "promoter", null)).toMatchObject({ allow: false });
    expect(roleAccess("/create-slot", "promoter", null)).toEqual({ allow: true });
    expect(roleAccess("/applications", "artist", null)).toEqual({ allow: true });
  });

  it("shared pages work for both roles; a promoter's '/' goes to Discover Artists", () => {
    for (const role of ["artist", "promoter"] as const) {
      expect(roleAccess("/messages", role, null)).toEqual({ allow: true });
      expect(roleAccess("/slot/1", role, null)).toEqual({ allow: true });
    }
    expect(roleAccess("/", "promoter", null)).toEqual({ allow: false, redirect: "/discover" });
    expect(roleAccess("/", "artist", null)).toEqual({ allow: true });
  });

  it("/admin is for staff only — an ordinary account, whatever its role, is turned away", () => {
    expect(roleAccess("/admin", "artist", null)).toMatchObject({ allow: false });
    expect(roleAccess("/admin/reports", "promoter", null)).toMatchObject({ allow: false });
    expect(roleAccess("/admin/reports", "promoter", "moderator")).toEqual({ allow: true });
    expect(roleAccess("/administrator", "artist", null)).toEqual({ allow: true }); // not under /admin
  });
});

import { decideAccess, type AccessContext } from "./routes";

const base: AccessContext = {
  pathname: "/", search: "", signedIn: true, mfa: "ok",
  profile: { role: "artist", hasOnboarded: true, suspended: false, adminRole: null },
};
const ctx = (over: Partial<AccessContext>): AccessContext => ({ ...base, ...over });
const artist = base.profile!;
const promoter = { ...artist, role: "promoter" as const };

describe("decideAccess — signed out", () => {
  it("lets visitors browse public pages and sends everything else to login, remembering the destination", () => {
    expect(decideAccess(ctx({ signedIn: false, profile: null, pathname: "/discover", search: "?genre=Indie" }))).toBeNull();
    expect(decideAccess(ctx({ signedIn: false, profile: null, pathname: "/slot/123" }))).toBeNull();
    expect(decideAccess(ctx({ signedIn: false, profile: null, pathname: "/artist/x" }))).toBeNull();
    expect(decideAccess(ctx({ signedIn: false, profile: null, pathname: "/applications" }))).toBe("/login?next=%2Fapplications");
    expect(decideAccess(ctx({ signedIn: false, profile: null, pathname: "/dashboard/artist" }))).toBe("/login?next=%2Fdashboard%2Fartist");
    expect(decideAccess(ctx({ signedIn: false, profile: null, pathname: "/admin" }))).toBe("/login?next=%2Fadmin");
    expect(decideAccess(ctx({ signedIn: false, profile: null, pathname: "/messages", search: "?thread=abc" }))).toBe("/login?next=%2Fmessages%3Fthread%3Dabc");
  });
});

describe("decideAccess — account states, in order", () => {
  it("suspended accounts only reach support and the rules", () => {
    const s = { profile: { ...artist, suspended: true } };
    expect(decideAccess(ctx({ ...s, pathname: "/discover" }))).toBe("/suspended");
    expect(decideAccess(ctx({ ...s, pathname: "/applications" }))).toBe("/suspended");
    expect(decideAccess(ctx({ ...s, pathname: "/support" }))).toBeNull();
    expect(decideAccess(ctx({ ...s, pathname: "/suspended" }))).toBeNull();
    expect(decideAccess(ctx({ ...s, pathname: "/terms" }))).toBeNull();
  });

  it("not onboarded -> onboarding (keeping the destination); then 2FA setup; then 2FA challenge", () => {
    const fresh = { profile: { ...artist, hasOnboarded: false } };
    expect(decideAccess(ctx({ ...fresh, pathname: "/slot/9" }))).toBe("/onboarding?next=%2Fslot%2F9");
    expect(decideAccess(ctx({ ...fresh, pathname: "/onboarding" }))).toBeNull();
    expect(decideAccess(ctx({ ...fresh, pathname: "/privacy" }))).toBeNull();
    expect(decideAccess(ctx({ mfa: "needs_setup", pathname: "/slot/9" }))).toBe("/mfa-setup?next=%2Fslot%2F9");
    expect(decideAccess(ctx({ mfa: "needs_setup", pathname: "/mfa-setup" }))).toBeNull();
    expect(decideAccess(ctx({ mfa: "needs_challenge", pathname: "/applications" }))).toBe("/mfa-challenge?next=%2Fapplications");
    expect(decideAccess(ctx({ mfa: "needs_challenge", pathname: "/mfa-challenge" }))).toBeNull();
    // A signed-in user can't skip 2FA by browsing to a public page.
    expect(decideAccess(ctx({ mfa: "needs_challenge", pathname: "/discover" }))).toBe("/mfa-challenge?next=%2Fdiscover");
  });

  it("a fully signed-in user is sent past the auth screens, to where they were headed or home", () => {
    expect(decideAccess(ctx({ pathname: "/login", search: "?next=%2Fslot%2F5" }))).toBe("/slot/5");
    expect(decideAccess(ctx({ pathname: "/login" }))).toBe("/");
    expect(decideAccess(ctx({ pathname: "/login", profile: promoter }))).toBe("/discover");
    expect(decideAccess(ctx({ pathname: "/mfa-challenge", search: "?next=https%3A%2F%2Fevil.example" }))).toBe("/");
    expect(decideAccess(ctx({ pathname: "/onboarding", search: "?next=%2F%2Fevil.example" }))).toBe("/");
  });

  it("then role rules apply", () => {
    expect(decideAccess(ctx({ pathname: "/create-slot" }))).toBe("/");
    expect(decideAccess(ctx({ pathname: "/create-slot", profile: promoter }))).toBeNull();
    expect(decideAccess(ctx({ pathname: "/admin" }))).toBe("/");
    expect(decideAccess(ctx({ pathname: "/admin", profile: { ...promoter, adminRole: "admin" } }))).toBeNull();
    expect(decideAccess(ctx({ pathname: "/slot/1", profile: promoter }))).toBeNull();
  });
});
