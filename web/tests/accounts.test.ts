import { describe, expect, it } from "vitest";
import { createLocalRepo } from "../src/data/localRepo";
import { addDays } from "../src/domain/dates";

const TODAY = "2026-11-07";
const mk = () => createLocalRepo({ storage: null, latencyMs: 0, today: () => TODAY });
const acct = (over = {}) => ({ email: "New@Example.test", password: "correct horse", role: "artist" as const, name: "Newcomer", city: "Leeds", genres: ["Folk"], blurb: "", ...over });
const listing = { venue: "Test Hall", city: "Leeds", date: addDays(TODAY, 10), doors: "19:00", setTime: "19:45", setMinutes: 30, genres: ["Folk"], capacity: 100, feePence: 5000, notes: "" };

describe("accounts", () => {
  it("signs up, then signs in case-insensitively; rejects wrong password with one message", async () => {
    const r = mk();
    const u = await r.signUp(acct());
    expect((await r.signIn("new@example.test", "correct horse")).id).toBe(u.id);
    const bad1 = await r.signIn("new@example.test", "wrong").catch((e) => e);
    const bad2 = await r.signIn("nobody@example.test", "wrong").catch((e) => e);
    expect(bad1.code).toBe("auth");
    expect(bad2.message).toBe(bad1.message);
  });
  it("validates sign-up and rejects duplicate emails", async () => {
    const r = mk();
    await r.signUp(acct());
    await expect(r.signUp(acct({ email: "new@example.test" }))).rejects.toMatchObject({ code: "conflict" });
    await expect(r.signUp(acct({ email: "nope" }))).rejects.toMatchObject({ code: "invalid" });
    await expect(r.signUp(acct({ email: "a@b.test", password: "short" }))).rejects.toMatchObject({ code: "invalid" });
    await expect(r.signUp(acct({ email: "a@b.test", name: " " }))).rejects.toMatchObject({ code: "invalid" });
  });
  it("seeded demo accounts can sign in", async () => {
    const r = mk();
    expect((await r.signIn("maya@example.test", "demo1234")).name).toBe("Maya Okafor");
  });
  it("updates a profile", async () => {
    const r = mk();
    const u = await r.signUp(acct());
    const v = await r.updateProfile(u.id, { name: "Renamed", city: "Cardiff", genres: ["Jazz"], blurb: "Hi" });
    expect(v.name).toBe("Renamed");
    await expect(r.updateProfile(u.id, { name: " ", city: "", genres: [], blurb: "" })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("notifications and messages", () => {
  it("notifies the right people through the booking lifecycle", async () => {
    const r = mk();
    const l = await r.createListing("u-harbour", listing);
    await r.apply(l.id, "u-maya", "Solo folk set, thirty minutes.");
    await r.apply(l.id, "u-orchard", "Four-piece, acoustic version available.");
    expect((await r.notifications("u-harbour")).filter((n) => n.text.includes("requested"))).toHaveLength(2);
    const { applicants } = await r.applicants(l.id, "u-harbour");
    const bid = await r.accept(applicants[0].id, "u-harbour");
    expect((await r.notifications("u-maya"))[0].text).toContain("You're booked");
    expect((await r.notifications("u-orchard"))[0].text).toContain("another act");
    await r.cancelBooking(bid, "u-maya", "Van broke down.");
    expect((await r.notifications("u-harbour"))[0].text).toContain("Van broke down");
    await r.markAllRead("u-harbour");
    expect((await r.notifications("u-harbour")).every((n) => n.read)).toBe(true);
    expect((await r.notifications("u-north")).length).toBe(0); // uninvolved
  });
  it("only the artist and the listing's promoter can read or write a thread", async () => {
    const r = mk();
    const l = await r.createListing("u-harbour", listing);
    await expect(r.sendMessage(l.id, "u-maya", "u-maya", "hello")).rejects.toMatchObject({ code: "conflict" }); // no request yet
    await r.apply(l.id, "u-maya", "Solo folk set, thirty minutes.");
    await r.sendMessage(l.id, "u-maya", "u-harbour", "Can you do 40 minutes?");
    await r.sendMessage(l.id, "u-maya", "u-maya", "Yes, easily.");
    await expect(r.sendMessage(l.id, "u-maya", "u-north", "hi")).rejects.toMatchObject({ code: "forbidden" });
    await expect(r.thread(l.id, "u-maya", "u-orchard")).rejects.toMatchObject({ code: "forbidden" });
    await expect(r.sendMessage(l.id, "u-maya", "u-maya", "  ")).rejects.toMatchObject({ code: "invalid" });
    const t = await r.thread(l.id, "u-maya", "u-maya");
    expect(t.messages.map((m) => m.text)).toEqual(["Can you do 40 minutes?", "Yes, easily."]);
    expect((await r.notifications("u-maya"))[0].text).toContain("Harbour Lights");
    expect((await r.threads("u-harbour"))[0].other.name).toBe("Maya Okafor");
  });
});
