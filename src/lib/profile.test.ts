import { describe, expect, it } from "vitest";
import { isValidDuration, profileChecklist, profileCompletion, trackUrlError } from "./profile";

const empty = { image: "", bio: "", genres: [], tracks: [], liveVideoUrl: undefined, spotifyUrl: "", instagramUrl: "", tiktokUrl: "" } as never;

describe("profileChecklist", () => {
  it("starts with nothing done for an empty profile", () => {
    const items = profileChecklist(empty);
    expect(profileCompletion(items)).toEqual({ done: 0, total: 6, percent: 0 });
  });

  it("counts each real thing a promoter can see", () => {
    const items = profileChecklist({
      image: "https://x/y.jpg",
      bio: "x".repeat(40),
      genres: ["Indie"],
      tracks: [{ id: "t", title: "Song", duration: "3:00", coverImage: "" }],
      liveVideoUrl: "https://youtube.com/watch?v=1",
      spotifyUrl: "https://open.spotify.com/artist/1",
      instagramUrl: "",
      tiktokUrl: "",
    } as never);
    expect(profileCompletion(items).percent).toBe(100);
  });

  it("doesn't count an unsafe video or listen link", () => {
    const items = profileChecklist({ ...(empty as object), liveVideoUrl: "javascript:alert(1)", spotifyUrl: "javascript:alert(1)" } as never);
    expect(items.find((i) => i.key === "video")?.done).toBe(false);
    expect(items.find((i) => i.key === "listen")?.done).toBe(false);
  });

  it("an Instagram link alone isn't 'a place to listen'", () => {
    const items = profileChecklist({ ...(empty as object), instagramUrl: "https://instagram.com/x" } as never);
    expect(items.find((i) => i.key === "listen")?.done).toBe(false);
  });
});

describe("track field checks", () => {
  it("accepts empty or https links and rejects anything else", () => {
    expect(trackUrlError("")).toBeNull();
    expect(trackUrlError("https://bandcamp.com/track")).toBeNull();
    expect(trackUrlError("javascript:alert(1)")).not.toBeNull();
    expect(trackUrlError("bandcamp.com/track")).not.toBeNull();
  });
  it("validates m:ss durations", () => {
    expect(isValidDuration("3:24")).toBe(true);
    expect(isValidDuration("12:05")).toBe(true);
    expect(isValidDuration("3:75")).toBe(false);
    expect(isValidDuration("324")).toBe(false);
  });
});
