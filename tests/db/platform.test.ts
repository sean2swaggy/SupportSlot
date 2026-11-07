import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asService,
  asUser,
  createTestDb,
  makeArtist,
  makePromoter,
  makeSlot,
  makeVenue,
  PLACES,
  type Db,
} from "./harness";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => db.close());

const search = (args: Record<string, unknown> = {}, who: "anon" | string = "anon") => {
  const defaults = { q: null, country: null, genre: null, from: null, to: null, minFee: null, venueSize: null, artistSize: null, nearLat: null, nearLon: null, maxMiles: null, urgent: false, sort: "date", limit: 12, offset: 0 };
  const a = { ...defaults, ...args };
  const q = (tx: { query: Db["query"] }) =>
    tx.query<{ id: string; total_count: string; distance_miles: number | null }>(
      `select * from public.search_slots($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [a.q, a.country, a.genre, a.from, a.to, a.minFee, a.venueSize, a.artistSize, a.nearLat, a.nearLon, a.maxMiles, a.urgent, a.sort, a.limit, a.offset]
    );
  return who === "anon" ? asAnon(db, q) : asUser(db, who, q);
};

describe("public discovery", () => {
  it("works signed-out, returns only active listings, and reports a total for pagination", async () => {
    const promoter = await makePromoter(db);
    const open = await makeSlot(db, promoter, { headliner: "Searchable Alpha", place: PLACES.leeds, genres: ["Punk"], supportFee: 300 });
    const closed = await makeSlot(db, promoter, { headliner: "Searchable Closed" });
    await asUser(db, promoter, (tx) => tx.query(`select public.close_slot($1)`, [closed]));
    const pastDeadline = await makeSlot(db, promoter, { headliner: "Searchable Late" });
    await asService(db, (tx) => tx.query(`update public.slots set application_deadline = '2000-01-01' where id = $1`, [pastDeadline]));
    const pastShow = await makeSlot(db, promoter, { headliner: "Searchable Past" });
    await asService(db, (tx) => tx.query(`update public.slots set date = '2000-02-01', application_deadline = '2000-01-01' where id = $1`, [pastShow]));
    const cancelled = await makeSlot(db, promoter, { headliner: "Searchable Cancelled" });
    await asUser(db, promoter, (tx) => tx.query(`select public.cancel_slot($1, 'x')`, [cancelled]));

    const r = await search({ q: "searchable" });
    expect(r.rows.map((x) => x.id)).toEqual([open]);
    expect(Number(r.rows[0].total_count)).toBe(1);
  });

  it("filters by place, genre, pay, venue size, date range and text; sorts; paginates", async () => {
    const promoter = await makePromoter(db);
    const mk = (over: Record<string, unknown>) => makeSlot(db, promoter, { headliner: "Page Show " + Math.random().toString(36).slice(2, 6), ...over });
    const ids = [
      await mk({ place: PLACES.bristol, genres: ["Folk"], supportFee: 90, date: "2099-03-01" }),
      await mk({ place: PLACES.bristol, genres: ["Folk"], supportFee: 180, date: "2099-04-01" }),
      await mk({ place: PLACES.brighton, genres: ["Techno"], supportFee: 250, date: "2099-05-01" }),
    ];
    const bristol = await search({ q: "page show", nearLat: 51.4545, nearLon: -2.5879, maxMiles: 10 });
    expect(bristol.rows.map((x) => x.id)).toEqual([ids[0], ids[1]]); // soonest first
    const pay = await search({ q: "page show", minFee: 200 });
    expect(pay.rows.map((x) => x.id)).toEqual([ids[2]]);
    const genre = await search({ q: "page show", genre: "Techno" });
    expect(genre.rows.map((x) => x.id)).toEqual([ids[2]]);
    const range = await search({ q: "page show", from: "2099-03-15", to: "2099-04-15" });
    expect(range.rows.map((x) => x.id)).toEqual([ids[1]]);
    const byFee = await search({ q: "page show", sort: "fee" });
    expect(byFee.rows.map((x) => x.id)).toEqual([ids[2], ids[1], ids[0]]);
    const p1 = await search({ q: "page show", limit: 2, offset: 0 });
    const p2 = await search({ q: "page show", limit: 2, offset: 2 });
    expect(p1.rows).toHaveLength(2);
    expect(p2.rows).toHaveLength(1);
    expect(Number(p1.rows[0].total_count)).toBe(3);
    const none = await search({ q: "zzz-no-such-show" });
    expect(none.rows).toHaveLength(0);
  });

  it("radius search uses straight-line distance from real coordinates; text is matched literally", async () => {
    const promoter = await makePromoter(db);
    const far = await makeSlot(db, promoter, { headliner: "Dist Far", place: PLACES.leeds });
    const near = await makeSlot(db, promoter, { headliner: "Dist Near", place: PLACES.brighton });
    const noCoords = await makeSlot(db, promoter, { headliner: "Dist Typed", place: { label: "Typedville, England", country: "England" } });
    const r = await search({ q: "dist ", nearLat: PLACES.london.lat, nearLon: PLACES.london.lon, maxMiles: 60 });
    expect(r.rows.map((x) => x.id)).toEqual([near]); // Brighton ≈ 47 mi from London; Leeds ≈ 168 mi
    expect(r.rows[0].distance_miles).toBeGreaterThan(45);
    expect(r.rows[0].distance_miles).toBeLessThan(50);
    // A listing with no coordinates is left out of a radius search, never guessed at,
    // but is still found without one.
    expect(r.rows.map((x) => x.id)).not.toContain(noCoords);
    const all = await search({ q: "dist " });
    expect(all.rows.map((x) => x.id).sort()).toEqual([far, near, noCoords].sort());
    expect((await search({ q: "%" })).rows).toHaveLength(0);
  });

  it("saved gigs persist per account and are private", async () => {
    const artist = await makeArtist(db);
    const other = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    await asUser(db, artist, (tx) => tx.query(`insert into public.saved_slots (profile_id, slot_id) values ($1, $2)`, [artist, slot]));
    await expect(
      asUser(db, artist, (tx) => tx.query(`insert into public.saved_slots (profile_id, slot_id) values ($1, $2)`, [artist, slot]))
    ).rejects.toThrow(/duplicate|unique/i);
    await expect(
      asUser(db, other, (tx) => tx.query(`insert into public.saved_slots (profile_id, slot_id) values ($1, $2)`, [artist, slot]))
    ).rejects.toThrow(/row-level security/);
    expect((await asUser(db, artist, (tx) => tx.query(`select 1 from public.saved_slots`))).rows).toHaveLength(1);
    expect((await asUser(db, other, (tx) => tx.query(`select 1 from public.saved_slots`))).rows).toHaveLength(0);
    await asUser(db, artist, (tx) => tx.query(`delete from public.saved_slots where slot_id = $1`, [slot]));
    expect((await asUser(db, artist, (tx) => tx.query(`select 1 from public.saved_slots`))).rows).toHaveLength(0);
  });
});

describe("messaging", () => {
  async function pair() {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1,$2) returning id`, [slot, artist]))).rows[0].id;
    return { artist, promoter, app };
  }
  const openThread = async (who: string, app: string) =>
    (await asUser(db, who, (tx) => tx.query<{ t: string }>(`select public.open_application_thread($1) as t`, [app]))).rows[0].t;
  const send = (who: string, thread: string, text: string) =>
    asUser(db, who, (tx) => tx.query(`insert into public.messages (thread_id, sender_id, text) values ($1, $2, $3)`, [thread, who, text]));

  it("either participant can open the same thread; unrelated users cannot, nor read or post in it", async () => {
    const { artist, promoter, app } = await pair();
    const stranger = await makeArtist(db);
    const t1 = await openThread(artist, app);
    const t2 = await openThread(promoter, app);
    expect(t1).toBe(t2);
    await expect(openThread(stranger, app)).rejects.toThrow(/not_authorized/);

    await send(artist, t1, "hi there");
    await send(promoter, t1, "hello!");
    const seen = await asUser(db, promoter, (tx) => tx.query<{ text: string }>(`select text from public.messages order by created_at`));
    expect(seen.rows.map((r) => r.text)).toEqual(["hi there", "hello!"]);
    expect((await asUser(db, stranger, (tx) => tx.query(`select 1 from public.messages`))).rows).toHaveLength(0);
    expect((await asUser(db, stranger, (tx) => tx.query(`select 1 from public.message_threads`))).rows).toHaveLength(0);
    await expect(send(stranger, t1, "let me in")).rejects.toThrow(/row-level security|not_authorized/);
    // can't spoof the sender either
    await expect(
      asUser(db, stranger, (tx) => tx.query(`insert into public.messages (thread_id, sender_id, text) values ($1, $2, 'x')`, [t1, artist]))
    ).rejects.toThrow(/row-level security/);
    const direct = await asUser(db, stranger, (tx) => tx.query(`insert into public.message_threads (artist_id, promoter_id) values ($1, $2) returning id`, [stranger, promoter]).catch((e) => e));
    expect(String((direct as Error).message ?? "")).toMatch(/row-level security/);
  });

  it("validates length, trims, and rate-limits", async () => {
    const { artist, app } = await pair();
    const t = await openThread(artist, app);
    await expect(send(artist, t, "   ")).rejects.toThrow(/empty/);
    await expect(send(artist, t, "x".repeat(2001))).rejects.toThrow(/too long/);
    for (let i = 0; i < 20; i++) await send(artist, t, `m${i}`);
    await expect(send(artist, t, "one too many")).rejects.toThrow(/rate_limited/);
  });

  it("a promoter blocked by the artist can't open or post in the thread", async () => {
    const { artist, promoter, app } = await pair();
    const t = await openThread(artist, app);
    await asUser(db, artist, (tx) => tx.query(`insert into public.promoter_blocks (artist_id, promoter_id) values ($1, $2)`, [artist, promoter]));
    await expect(send(promoter, t, "please reply")).rejects.toThrow(/blocked/);
    await expect(openThread(promoter, app)).rejects.toThrow(/blocked/);
    await send(artist, t, "the artist can still write");
  });

  it("one unread notification per thread (not per message); reading clears it and unread state", async () => {
    const { artist, promoter, app } = await pair();
    const t = await openThread(artist, app);
    await send(artist, t, "one");
    await send(artist, t, "two");
    await send(artist, t, "three");
    const unread = await db.query(`select 1 from public.notifications where profile_id = $1 and type = 'message' and read = false`, [promoter]);
    expect(unread.rows).toHaveLength(1);
    await asUser(db, promoter, (tx) => tx.query(`select public.mark_thread_read($1)`, [t]));
    const after = await db.query(`select 1 from public.notifications where profile_id = $1 and type = 'message' and read = false`, [promoter]);
    expect(after.rows).toHaveLength(0);
    const th = await db.query<{ promoter_last_read_at: string | null }>(`select promoter_last_read_at from public.message_threads where id = $1`, [t]);
    expect(th.rows[0].promoter_last_read_at).not.toBeNull();
    await send(artist, t, "four"); // a fresh unread after reading
    expect((await db.query(`select 1 from public.notifications where profile_id = $1 and type = 'message' and read = false`, [promoter])).rows).toHaveLength(1);
  });
});

describe("notifications", () => {
  const notify = (profile: string, key: string | null) =>
    asService(db, (tx) => tx.query(`select public.notify($1, 'system', 'hello there', '/x', $2, false)`, [profile, key]));

  it("the same event key can't create two notifications", async () => {
    const p = await makePromoter(db);
    await notify(p, "k1");
    await notify(p, "k1");
    expect((await db.query(`select 1 from public.notifications where profile_id = $1`, [p])).rows).toHaveLength(1);
  });

  it("there is no email machinery: no outbox, no email preference", async () => {
    const t = await db.query(`select 1 from information_schema.tables where table_schema = 'public' and table_name = 'email_outbox'`);
    expect(t.rows).toHaveLength(0);
    const c = await db.query(`select 1 from information_schema.columns where table_schema = 'public' and column_name = 'email_notifications'`);
    expect(c.rows).toHaveLength(0);
    // a caller that still asks for an email just gets the in-app notification
    const p = await makePromoter(db);
    await asService(db, (tx) => tx.query(`select public.notify($1, 'system', 'hi', '/x', 'k9', true)`, [p]));
    expect((await db.query(`select 1 from public.notifications where profile_id = $1`, [p])).rows).toHaveLength(1);
  });

  it("users can read and mark only their own notifications; clients can't create them", async () => {
    const a = await makePromoter(db);
    const b = await makePromoter(db);
    await notify(a, "k4");
    expect((await asUser(db, b, (tx) => tx.query(`select 1 from public.notifications`))).rows).toHaveLength(0);
    await expect(
      asUser(db, b, (tx) => tx.query(`insert into public.notifications (profile_id, type, text) values ($1, 'system', 'forged')`, [a]))
    ).rejects.toThrow(/row-level security/);
    await expect(asUser(db, b, (tx) => tx.query(`select public.notify($1, 'system', 'x', null, null, false)`, [a]))).rejects.toThrow(/permission denied/);
  });
});

describe("moderation, support and staff access", () => {
  async function staff(role: "moderator" | "admin") {
    const p = await makePromoter(db);
    await asService(db, (tx) => tx.query(`update public.profiles set admin_role = $2 where id = $1`, [p, role]));
    return p;
  }

  it("nobody can make themselves staff, unsuspend themselves, or edit their stored email", async () => {
    const p = await makePromoter(db);
    for (const sql of [
      `update public.profiles set admin_role = 'admin' where id = $1`,
      `update public.profiles set suspended_at = now() where id = $1`,
      `update public.profiles set email = 'someone-else@example.com' where id = $1`,
    ]) {
      await expect(asUser(db, p, (tx) => tx.query(sql, [p]))).rejects.toThrow(/only be changed by the platform/);
    }
    // A suspended account can't even reach its own row to try (session security).
    await asService(db, (tx) => tx.query(`update public.profiles set suspended_at = now(), suspension_reason = 'test' where id = $1`, [p]));
    const res = await asUser(db, p, (tx) => tx.query(`update public.profiles set suspended_at = null where id = $1`, [p]));
    expect(res.affectedRows).toBe(0);
    const row = await db.query<{ suspended_at: string | null }>(`select suspended_at from public.profiles where id = $1`, [p]);
    expect(row.rows[0].suspended_at).not.toBeNull();
  });

  it("non-staff are refused every staff function", async () => {
    const p = await makePromoter(db);
    for (const sql of [
      `select * from public.staff_open_reports()`,
      `select * from public.staff_find_users('a')`,
      `select * from public.admin_recent_bookings()`,
      `select public.admin_suspend_user(gen_random_uuid(), 'because')`,
      `select * from public.staff_audit_log()`,
    ]) {
      await expect(asUser(db, p, (tx) => tx.query(sql))).rejects.toThrow(/not_authorized/);
    }
    await expect(asAnon(db, (tx) => tx.query(`select * from public.staff_open_reports()`))).rejects.toThrow(/permission denied/);
  });

  it("reports: any user can file; duplicates collapse; staff review them with an audit trail; the reporter is told", async () => {
    const reporter = await makeArtist(db);
    const offender = await makePromoter(db);
    const mod = await staff("moderator");
    const file = (reason = "They asked me to pay to perform, which breaks the rules") =>
      asUser(db, reporter, (tx) => tx.query<{ id: string }>(`select public.submit_report('profile', null, $1, $2) as id`, [offender, reason]));
    const r1 = await file();
    const r2 = await file();
    expect(r1.rows[0].id).toBe(r2.rows[0].id);
    await expect(file("short")).rejects.toThrow(/at least 10/);
    await expect(asUser(db, reporter, (tx) => tx.query(`select public.submit_report('profile', null, $1, 'on myself, ten chars')`, [reporter]))).rejects.toThrow(/yourself/);

    const queue = await asUser(db, mod, (tx) => tx.query<{ id: string; status: string }>(`select * from public.staff_open_reports('open')`));
    expect(queue.rows.map((r) => r.id)).toContain(r1.rows[0].id);
    await asUser(db, mod, (tx) => tx.query(`select public.admin_update_report($1, 'actioned', 'warned the promoter')`, [r1.rows[0].id]));
    const audit = await asUser(db, mod, (tx) => tx.query<{ action: string; actor_role: string }>(`select action, actor_role from public.staff_audit_log()`));
    expect(audit.rows.some((a) => a.action === "report.actioned" && a.actor_role === "moderator")).toBe(true);
    expect((await db.query(`select 1 from public.notifications where profile_id = $1 and type = 'report_update'`, [reporter])).rows).toHaveLength(1);
    // reporters can only see their own reports; the offender sees none
    expect((await asUser(db, reporter, (tx) => tx.query(`select 1 from public.reports`))).rows).toHaveLength(1);
    expect((await asUser(db, offender, (tx) => tx.query(`select 1 from public.reports`))).rows).toHaveLength(0);
  });

  it("suspension: moderators can suspend (not staff); a suspended account can't apply, post, or message", async () => {
    const mod = await staff("moderator");
    const admin = await staff("admin");
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    await expect(asUser(db, mod, (tx) => tx.query(`select public.admin_suspend_user($1, 'x')`, [artist]))).rejects.toThrow(/reason_required/);
    await expect(asUser(db, mod, (tx) => tx.query(`select public.admin_suspend_user($1, 'repeated scam offers')`, [admin]))).rejects.toThrow(/cannot_suspend_staff/);
    await asUser(db, mod, (tx) => tx.query(`select public.admin_suspend_user($1, 'repeated scam offers')`, [artist]));
    await expect(
      asUser(db, artist, (tx) => tx.query(`insert into public.applications (slot_id, artist_id) values ($1,$2)`, [slot, artist]))
    ).rejects.toThrow(/account_suspended/);
    await expect(asUser(db, artist, (tx) => tx.query(`select public.withdraw_application(gen_random_uuid())`))).rejects.toThrow(/account_suspended/);
    await asUser(db, mod, (tx) => tx.query(`select public.admin_unsuspend_user($1)`, [artist]));
    await asUser(db, artist, (tx) => tx.query(`insert into public.applications (slot_id, artist_id) values ($1,$2)`, [slot, artist]));
  });

  it("moderators can remove a listing (applicants told, audited) but can't see the bookings list; admins can; only admins verify", async () => {
    const mod = await staff("moderator");
    const admin = await staff("admin");
    const promoter = await makePromoter(db);
    const artist = await makeArtist(db);
    const slot = await makeSlot(db, promoter);
    const app = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1,$2) returning id`, [slot, artist]))).rows[0].id;
    await asUser(db, mod, (tx) => tx.query(`select public.admin_remove_listing($1, 'misleading listing')`, [slot]));
    expect((await db.query<{ status: string }>(`select status from public.applications where id = $1`, [app])).rows[0].status).toBe("declined");
    expect((await db.query<{ status: string }>(`select status from public.slots where id = $1`, [slot])).rows[0].status).toBe("cancelled");

    await expect(asUser(db, mod, (tx) => tx.query(`select * from public.admin_recent_bookings()`))).rejects.toThrow(/not_authorized/);
    await asUser(db, admin, (tx) => tx.query(`select * from public.admin_recent_bookings()`));
    await expect(asUser(db, mod, (tx) => tx.query(`select public.admin_set_verification($1, true)`, [artist]))).rejects.toThrow(/not_authorized/);
    await asUser(db, admin, (tx) => tx.query(`select public.admin_set_verification($1, true)`, [artist]));
    expect((await db.query<{ verification: string }>(`select verification from public.artists where id = $1`, [artist])).rows[0].verification).toBe("verified");
  });

  it("support requests are readable only by their author and by staff", async () => {
    const user = await makeArtist(db);
    const other = await makeArtist(db);
    const mod = await staff("moderator");
    await asService(db, (tx) =>
      tx.query(`insert into public.support_requests (profile_id, email, topic, message) values ($1, 'a@example.test', 'bug', 'The thing does not work at all')`, [user])
    );
    expect((await asUser(db, user, (tx) => tx.query(`select 1 from public.support_requests`))).rows).toHaveLength(1);
    expect((await asUser(db, other, (tx) => tx.query(`select 1 from public.support_requests`))).rows).toHaveLength(0);
    const list = await asUser(db, mod, (tx) => tx.query<{ id: string }>(`select * from public.staff_support_requests('open')`));
    expect(list.rows.length).toBeGreaterThanOrEqual(1);
    await asUser(db, mod, (tx) => tx.query(`select public.admin_update_support_request($1, 'answered', 'replied by email')`, [list.rows[0].id]));
  });
});

describe("profile and account safety", () => {
  it("profile fields are validated server-side; the handle is permanent; media must be safe", async () => {
    const artist = await makeArtist(db);
    const upd = (sql: string, ...p: unknown[]) => asUser(db, artist, (tx) => tx.query(sql, [artist, ...p]));
    await expect(upd(`update public.artists set name = '' where id = $1`)).rejects.toThrow(/name must be/);
    await expect(upd(`update public.artists set bio = $2 where id = $1`, "x".repeat(1001))).rejects.toThrow(/bio is too long/);
    await expect(upd(`update public.artists set handle = 'new-handle' where id = $1`)).rejects.toThrow(/handle can't be changed/);
    await expect(upd(`update public.artists set spotify_url = 'javascript:alert(1)' where id = $1`)).rejects.toThrow(/artists_spotify_url_scheme/);
    await expect(upd(`update public.artists set image_url = 'javascript:alert(1)' where id = $1`)).rejects.toThrow(/artists_image_scheme/);
    await upd(`update public.artists set bio = 'Short and valid', image_url = 'data:image/jpeg;base64,/9j/4AAQ' where id = $1`);
    await expect(
      asUser(db, artist, (tx) => tx.query(`insert into public.artist_tracks (artist_id, title, duration, url) values ($1, 'T', '3:00', 'javascript:x')`, [artist]))
    ).rejects.toThrow(/check/i);
    await asUser(db, artist, (tx) => tx.query(`insert into public.artist_tracks (artist_id, title, duration, url) values ($1, 'T', '3:00', 'https://open.spotify.com/track/x')`, [artist]));
  });

  it("account deletion is blocked by upcoming confirmed bookings and keeps the financial record afterwards", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1,$2) returning id`, [slot, artist]))).rows[0].id;
    await asUser(db, promoter, (tx) => tx.query(`select public.make_offer($1)`, [app]));
    await asUser(db, artist, (tx) => tx.query(`select public.respond_to_offer($1, true, null)`, [app]));
    const blockers = await asService(db, (tx) => tx.query<{ b: string[] }>(`select public.account_deletion_blockers($1) as b`, [artist]));
    expect(blockers.rows[0].b).toContain("upcoming_confirmed_booking");
    await expect(asService(db, (tx) => tx.query(`select public.prepare_account_deletion($1)`, [artist]))).rejects.toThrow(/deletion_blocked/);
    await expect(asUser(db, artist, (tx) => tx.query(`select public.account_deletion_blockers($1)`, [artist]))).rejects.toThrow(/permission denied/);

    // After the booking is cancelled the account can go; the booking row survives with its snapshot.
    await asUser(db, artist, (tx) => tx.query(`select public.cancel_booking($1, 'leaving the platform')`, [app]));
    await asService(db, (tx) => tx.query(`select public.prepare_account_deletion($1)`, [artist]));
    await db.query(`delete from auth.users where id = $1`, [artist]); // the real route does this through the Auth admin API
    const kept = await db.query<{ artist_id: string | null; artist_name: string; status: string }>(`select artist_id, artist_name, status from public.bookings where slot_id = $1`, [slot]);
    expect(kept.rows).toHaveLength(1);
    expect(kept.rows[0].artist_id).toBeNull();
    expect(kept.rows[0].artist_name).toBe("Test Artist");
    expect((await db.query(`select 1 from public.profiles where id = $1`, [artist])).rows).toHaveLength(0);
  });

  it("deleting a promoter ends their open listings and withdraws applicants first", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1,$2) returning id`, [slot, artist]))).rows[0].id;
    await asService(db, (tx) => tx.query(`select public.prepare_account_deletion($1)`, [promoter]));
    expect((await db.query<{ status: string }>(`select status from public.applications where id = $1`, [app])).rows[0].status).toBe("declined");
    await db.query(`delete from auth.users where id = $1`, [promoter]);
    expect((await db.query(`select 1 from public.slots where id = $1`, [slot])).rows).toHaveLength(0);
  });
});

describe("abuse limiter", () => {
  it("allows up to the limit in a window, then refuses; keys are independent; clients can't call it", async () => {
    const hit = (key: string) => asService(db, (tx) => tx.query<{ ok: boolean }>(`select public.rate_limit_hit($1, 3, 60) as ok`, [key]));
    const results = [];
    for (let i = 0; i < 5; i++) results.push((await hit("user:a")).rows[0].ok);
    expect(results).toEqual([true, true, true, false, false]);
    expect((await hit("user:b")).rows[0].ok).toBe(true);
    const p = await makePromoter(db);
    await expect(asUser(db, p, (tx) => tx.query(`select public.rate_limit_hit('x', 1, 60)`))).rejects.toThrow(/permission denied/);
  });
});

describe("needed-tonight alerts", () => {
  const urgentSlot = async (promoter: string, place: (typeof PLACES)[keyof typeof PLACES]) => {
    const venue = await makeVenue(db, place);
    return asService(db, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `insert into public.slots
           (promoter_id, venue_id, headliner, date, doors_time, set_time, performance_length_mins,
            expected_attendance, support_fee, application_deadline, genres, is_urgent)
         values ($1, $2, 'Tonight Show', '2099-12-01', '19:00', '20:00', 30, 200, 100, '2099-11-30', '{Indie}', true)
         returning id`,
        [promoter, venue]
      );
      return r.rows[0].id;
    });
  };
  const urgentCount = async (artist: string) =>
    Number((await db.query<{ n: string }>(`select count(*) n from public.notifications where profile_id = $1 and type = 'urgent'`, [artist])).rows[0].n);

  it("notifies only opted-in artists whose travel radius covers the venue, never artists without coordinates or who blocked the promoter", async () => {
    const promoter = await makePromoter(db);
    const near = await makeArtist(db, { place: PLACES.london });
    const far = await makeArtist(db, { place: PLACES.leeds });
    const optedOut = await makeArtist(db, { place: PLACES.london });
    const blocker = await makeArtist(db, { place: PLACES.london });
    const typedIn = await makeArtist(db, { place: { label: "Somewhere, England", country: "England" } });
    await asService(db, async (tx) => {
      await tx.query(`update public.artists set last_minute_alerts = true, travel_radius_miles = 50 where id = any($1)`, [[near, far, blocker, typedIn]]);
      await tx.query(`insert into public.promoter_blocks (artist_id, promoter_id) values ($1, $2)`, [blocker, promoter]);
    });
    await urgentSlot(promoter, PLACES.london);
    expect(await urgentCount(near)).toBe(1);
    expect(await urgentCount(far)).toBe(0); // Leeds is outside a 50-mile radius of London
    expect(await urgentCount(optedOut)).toBe(0);
    expect(await urgentCount(blocker)).toBe(0);
    expect(await urgentCount(typedIn)).toBe(0); // no coordinates: we can't tell, so we don't alert
  });

  it("a non-urgent listing sends nothing", async () => {
    const promoter = await makePromoter(db);
    const artist = await makeArtist(db, { place: PLACES.london });
    await asService(db, (tx) => tx.query(`update public.artists set last_minute_alerts = true where id = $1`, [artist]));
    await makeSlot(db, promoter, { place: PLACES.london });
    expect(await urgentCount(artist)).toBe(0);
  });
});
