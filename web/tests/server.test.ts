import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "../server/server";
import { addDays, todayLondon } from "../src/domain/dates";

let url = ""; let close = async () => {}; let dir = "";
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ss-"));
  const s = await startServer({ port: 0, dataFile: join(dir, "db.json") });
  url = s.url; close = s.close;
});
afterAll(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

async function rpc(method: string, args: unknown[], token?: string) {
  const res = await fetch(`${url}/api/rpc`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ method, args }) });
  return { status: res.status, body: await res.json() as { result?: any; error?: { code: string; message: string } } };
}
const login = async (email: string) => (await rpc("signIn", [email, "demo1234"])).body.result.token as string;
const listing = { venue: "Server Hall", city: "Leeds", date: addDays(todayLondon(), 10), doors: "19:00", setTime: "19:45", setMinutes: 30, genres: ["Folk"], capacity: 100, feePence: 5000, notes: "" };

describe("server", () => {
  it("serves health and rejects unknown actions and unauthenticated calls", async () => {
    expect((await (await fetch(`${url}/api/health`)).json()).ok).toBe(true);
    expect((await rpc("dropEverything", [])).status).toBe(404);
    expect((await rpc("myBookings", ["u-maya"])).status).toBe(401);
    expect((await rpc("myBookings", ["u-maya"], "not-a-token")).status).toBe(401);
  });

  it("signs up on one connection and is visible to another (shared data)", async () => {
    const su = await rpc("signUp", [{ email: "shared@example.test", password: "long enough pw", role: "promoter", name: "Shared Promoter", city: "Leeds", genres: ["Folk"], blurb: "" }]);
    expect(su.status).toBe(200);
    const token = su.body.result.token as string;
    const created = await rpc("createListing", ["ignored", listing], token);
    expect(created.status).toBe(200);
    const maya = await login("maya@example.test");
    const open = await rpc("openSlots", ["ignored", {}], maya);
    expect(open.body.result.some((s: any) => s.id === created.body.result.id)).toBe(true);
    expect((await rpc("signUp", [{ email: "SHARED@example.test", password: "long enough pw", role: "artist", name: "Dup", city: "Leeds", genres: [], blurb: "" }])).status).toBe(409);
  });

  it("ignores who the client claims to be: the session decides", async () => {
    const maya = await login("maya@example.test");
    // Maya asks for Harbour Lights' listings by passing their id; the server substitutes her own id
    const mine = await rpc("myListings", ["u-harbour"], maya);
    expect(mine.status).toBe(200);
    expect(mine.body.result).toEqual([]); // Maya's own (empty) list, not Harbour Lights' listings
    const harbour = await login("harbour@example.test");
    // Maya cannot accept an application on Harbour's listing by claiming to be the promoter
    const { body } = await rpc("applicants", ["l-1", "u-harbour"], harbour);
    const app = body.result.applicants[0];
    expect((await rpc("accept", [app.id, "u-harbour"], maya)).status).toBe(403);
    // and cannot read someone else's booking
    expect((await rpc("booking", ["b-1", "u-north"], maya)).status).toBe(200); // her own booking
    const orchard = await login("orchard@example.test");
    expect((await rpc("booking", ["b-1", "u-maya"], orchard)).status).toBe(404); // not Orchard's, despite the claim
  });

  it("books end to end over HTTP and sign-out kills the token", async () => {
    const north = await login("north@example.test");
    const created = (await rpc("createListing", ["x", { ...listing, venue: "E2E Hall" }], north)).body.result;
    const maya = await login("maya@example.test");
    expect((await rpc("apply", [created.id, "x", "Solo guitar and voice, thirty minutes."], maya)).status).toBe(200);
    const app = (await rpc("applicants", [created.id, "x"], north)).body.result.applicants[0];
    const bid = (await rpc("accept", [app.id, "x"], north)).body.result;
    expect((await rpc("booking", [bid, "x"], maya)).body.result.status).toBe("confirmed");
    expect((await rpc("notifications", ["x"], maya)).body.result[0].text).toContain("You're booked");
    await rpc("signOut", [], maya);
    expect((await rpc("myBookings", ["x"], maya)).status).toBe(401);
  });

  it("throttles repeated bad sign-ins and gives one message for unknown email or wrong password", async () => {
    const a = await rpc("signIn", ["orchard@example.test", "nope"]);
    const b = await rpc("signIn", ["ghost@example.test", "nope"]);
    expect(a.body.error!.message).toBe(b.body.error!.message);
    for (let i = 0; i < 12; i++) await rpc("signIn", ["throttle@example.test", "bad"]);
    expect((await rpc("signIn", ["throttle@example.test", "bad"])).body.error!.message).toContain("Too many attempts");
  });

  it("handles concurrent sign-ups without losing any", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      rpc("signUp", [{ email: `race${i}@example.test`, password: "long enough pw", role: "artist", name: `Race ${i}`, city: "Leeds", genres: ["Folk"], blurb: "" }])));
    expect(results.every((r) => r.status === 200)).toBe(true);
    for (let i = 0; i < 8; i++) expect((await rpc("signIn", [`race${i}@example.test`, "long enough pw"])).status).toBe(200);
  });
});
