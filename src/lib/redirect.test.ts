import { describe, expect, it } from "vitest";
import { loginUrlFor, safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("accepts ordinary in-app paths, with query strings", () => {
    expect(safeNextPath("/slot/abc-123")).toBe("/slot/abc-123");
    expect(safeNextPath("/slot/abc?apply=1")).toBe("/slot/abc?apply=1");
    expect(safeNextPath(encodeURIComponent("/discover?genre=Indie&page=2"))).toBe("/discover?genre=Indie&page=2");
  });

  it("refuses anything that could leave the site or loop", () => {
    for (const bad of [
      "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil.example/x",
      "/%2F%2Fevil.example".replace("%2F%2F", "/\\"), "/login", "/login?next=/x", "/mfa-setup", "/auth/callback?code=1",
      "/onboarding/step", "/suspended", "", null, undefined, "/" + "a".repeat(600),
    ]) {
      expect(safeNextPath(bad as string | null)).toBeNull();
    }
  });

  it("refuses control characters and bad encodings", () => {
    expect(safeNextPath("/ok\u0000evil")).toBeNull();
    expect(safeNextPath("/ok\r\nLocation: x")).toBeNull();
    expect(safeNextPath("%E0%A4%A")).toBeNull();
  });
});

describe("loginUrlFor", () => {
  it("remembers where a signed-out visitor was heading", () => {
    expect(loginUrlFor("/slot/123", "?apply=1")).toBe("/login?next=%2Fslot%2F123%3Fapply%3D1");
    expect(loginUrlFor("/", "")).toBe("/login?next=%2F");
  });
  it("doesn't wrap auth pages in themselves", () => {
    expect(loginUrlFor("/login", "")).toBe("/login");
  });
});
