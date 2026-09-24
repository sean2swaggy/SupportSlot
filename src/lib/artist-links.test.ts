import { describe, expect, it } from "vitest";
import { isSafeExternalUrl, listPlatformLinks, primaryListenLink } from "./artist-links";

// Regression coverage for the stored-XSS fix found during the pre-launch
// security audit: a javascript: URL saved as e.g. an artist's spotifyUrl
// used to render straight into a clickable <a href> on their public
// profile (ArtistLinksDisplay.tsx) with no scheme check at all.
describe("isSafeExternalUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isSafeExternalUrl("https://open.spotify.com/artist/x")).toBe(true);
    expect(isSafeExternalUrl("http://example.com")).toBe(true);
  });

  it("rejects javascript: URLs", () => {
    expect(isSafeExternalUrl("javascript:alert(document.cookie)")).toBe(false);
    expect(isSafeExternalUrl("JaVaScRiPt:alert(1)")).toBe(false);
  });

  it("rejects other dangerous or non-navigable schemes", () => {
    expect(isSafeExternalUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeExternalUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects empty, missing, or unparseable values", () => {
    expect(isSafeExternalUrl("")).toBe(false);
    expect(isSafeExternalUrl(undefined)).toBe(false);
    expect(isSafeExternalUrl(null)).toBe(false);
    expect(isSafeExternalUrl("not a url")).toBe(false);
  });
});

describe("listPlatformLinks", () => {
  it("drops a malicious link but keeps safe ones", () => {
    const links = listPlatformLinks({
      spotifyUrl: "javascript:alert(document.cookie)",
      instagramUrl: "https://instagram.com/realaccount",
    });
    expect(links.map((l) => l.key)).toEqual(["instagramUrl"]);
    expect(links[0].url).toBe("https://instagram.com/realaccount");
  });
});

describe("primaryListenLink", () => {
  it("skips a malicious spotifyUrl and falls through to the next safe link", () => {
    expect(
      primaryListenLink({
        spotifyUrl: "javascript:alert(1)",
        soundcloudUrl: "https://soundcloud.com/realaccount",
      })
    ).toBe("https://soundcloud.com/realaccount");
  });

  it("returns undefined when every candidate is unsafe or missing", () => {
    expect(primaryListenLink({ spotifyUrl: "javascript:alert(1)" })).toBeUndefined();
    expect(primaryListenLink({})).toBeUndefined();
  });
});
