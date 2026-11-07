import { describe, expect, it } from "vitest";
import { createLocalRepo } from "../src/data/localRepo";
import { addDays, daysUntil, todayLondon } from "../src/domain/dates";
import { pounds, toPence } from "../src/domain/money";

const TODAY = "2026-11-07";
const mk = () => createLocalRepo({ storage: null, latencyMs: 0, today: () => TODAY });
const listingInput = (over = {}) => ({ venue: "Test Hall", city: "Leeds", date: addDays(TODAY, 10), doors: "19:00", setTime: "19:45", setMinutes: 30, genres: ["Folk"], capacity: 100, feePence: 5000, notes: "", ...over });

describe("booking flow", () => {
  it("apply → accept books the slot, declines others, snapshots the fee", async () => {
    const r = mk();
    const l = await r.createListing("u-harbour", listingInput());
    await r.apply(l.id, "u-maya", "Solo folk set, thirty minutes.");
    await r.apply(l.id, "u-orchard", "Four-piece, acoustic version available.");
    const { applicants } = await r.applicants(l.id, "u-harbour");
    const bid = await r.accept(applicants[0].id, "u-harbour");
    const after = await r.applicants(l.id, "u-harbour");
    expect(after.listing.status).toBe("booked");
    expect(after.applicants.map((a) => a.status)).toEqual(["accepted", "declined"]);
    expect((await r.booking(bid, "u-maya")).feePence).toBe(5000);
    expect((await r.openSlots("u-maya", {})).some((s) => s.id === l.id)).toBe(false);
  });
  it("accept is idempotent and a second accept on the slot fails", async () => {
    const r = mk();
    const l = await r.createListing("u-harbour", listingInput());
    await r.apply(l.id, "u-maya", "Solo folk set, thirty minutes.");
    await r.apply(l.id, "u-orchard", "Four-piece, acoustic version available.");
    const { applicants } = await r.applicants(l.id, "u-harbour");
    const b1 = await r.accept(applicants[0].id, "u-harbour");
    expect(await r.accept(applicants[0].id, "u-harbour")).toBe(b1);
    await expect(r.accept(applicants[1].id, "u-harbour")).rejects.toMatchObject({ code: "conflict" });
  });
  it("artist cancelling reopens the slot; promoter cancelling cancels it", async () => {
    const r = mk();
    const l = await r.createListing("u-harbour", listingInput());
    await r.apply(l.id, "u-maya", "Solo folk set, thirty minutes.");
    const bid = await r.accept((await r.applicants(l.id, "u-harbour")).applicants[0].id, "u-harbour");
    await expect(r.cancelBooking(bid, "u-maya", "")).rejects.toMatchObject({ code: "invalid" });
    await r.cancelBooking(bid, "u-maya", "Van broke down.");
    expect((await r.slot(l.id, "u-maya")).status).toBe("open");
    // she can apply again
    await r.apply(l.id, "u-maya", "Back and available again!");
    const bid2 = await r.accept((await r.applicants(l.id, "u-harbour")).applicants.find((a) => a.status === "pending")!.id, "u-harbour");
    await r.cancelBooking(bid2, "u-harbour", "Venue closed for repairs.");
    expect((await r.slot(l.id, "u-maya")).status).toBe("cancelled");
  });
  it("is permission-checked", async () => {
    const r = mk();
    const l = await r.createListing("u-harbour", listingInput());
    await expect(r.createListing("u-maya", listingInput())).rejects.toMatchObject({ code: "forbidden" });
    await expect(r.apply(l.id, "u-north", "I am a promoter, hello.")).rejects.toMatchObject({ code: "forbidden" });
    await expect(r.applicants(l.id, "u-north")).rejects.toMatchObject({ code: "forbidden" });
    await expect(r.booking("b-1", "u-harbour")).rejects.toMatchObject({ code: "not_found" });
  });
  it("blocks past dates, past cancellations and a listing cancel with a booking", async () => {
    const r = mk();
    await expect(r.createListing("u-harbour", listingInput({ date: addDays(TODAY, -1) }))).rejects.toMatchObject({ code: "invalid" });
    await expect(r.cancelBooking("b-2", "u-maya", "Changed my mind")).rejects.toMatchObject({ code: "conflict" });
    await expect(r.cancelListing("l-2", "u-north")).rejects.toMatchObject({ code: "conflict" });
  });
  it("apply is idempotent and withdraw works", async () => {
    const r = mk();
    const l = await r.createListing("u-harbour", listingInput());
    await r.apply(l.id, "u-maya", "Solo folk set, thirty minutes.");
    await r.apply(l.id, "u-maya", "Solo folk set, thirty minutes.");
    const mine = await r.myApplications("u-maya");
    expect(mine.filter((a) => a.listingId === l.id)).toHaveLength(1);
    await r.withdraw(mine.find((a) => a.listingId === l.id)!.id, "u-maya");
    expect((await r.slot(l.id, "u-maya")).applied).toBe(false);
  });
});

describe("helpers", () => {
  it("money", () => { expect(pounds(8000)).toBe("£80"); expect(pounds(8050)).toBe("£80.50"); expect(pounds(0)).toBe("No fee"); expect(toPence("80.5")).toBe(8050); expect(toPence("abc")).toBeNull(); });
  it("dates are timezone-proof", () => { expect(addDays("2026-03-28", 2)).toBe("2026-03-30"); expect(daysUntil("2026-11-10", "2026-11-07")).toBe(3); expect(todayLondon(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01"); });
});
