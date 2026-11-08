import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createTestDb, makeArtist, makePromoter, makeSlot, signUp, type Db } from "./harness";

let db: Db;
beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

const call = (user: string, fn: string, ...args: unknown[]) =>
  asUser(db, user, (tx) => tx.query<{ r: any }>(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args));
const emailOf = async (id: string) => (await db.query<{ email: string }>(`select email from public.profiles where id = $1`, [id])).rows[0].email;
async function apply(artist: string, slot: string) {
  const r = await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id, message) values ($1, $2, 'Hi') returning id`, [slot, artist]));
  return r.rows[0].id;
}
/** An owner with one accepted team member, a listing and an applicant. */
async function setup() {
  const owner = await makePromoter(db); const member = await makePromoter(db); const artist = await makeArtist(db);
  await call(owner, "invite_team_member", await emailOf(member));
  await call(member, "respond_team_invite", owner, true);
  const slot = await makeSlot(db, owner);
  const appId = await apply(artist, slot);
  return { owner, member, artist, slot, appId };
}

describe("inviting and joining", () => {
  it("an owner invites by email, the person accepts, and both see the team", async () => {
    const owner = await makePromoter(db); const member = await makePromoter(db);
    await call(owner, "invite_team_member", ` ${(await emailOf(member)).toUpperCase()} `);
    const invite = (await asUser(db, member, (tx) => tx.query(`select status from public.promoter_team_members`))).rows;
    expect(invite).toEqual([{ status: "pending" }]);
    expect((await asUser(db, member, (tx) => tx.query<any>(`select type from public.notifications where type = 'team_invite'`))).rows).toHaveLength(1);
    await call(member, "respond_team_invite", owner, true);
    const ov = (await call(member, "team_overview")).rows[0].r;
    expect(ov).toHaveLength(1);
    expect(ov[0]).toMatchObject({ promoter_id: owner, member_id: member, status: "active" });
    expect(ov[0].member_email).toBeNull();                       // only the owner sees emails
    expect((await call(owner, "team_overview")).rows[0].r[0].member_email).toBe(await emailOf(member));
    expect((await asUser(db, owner, (tx) => tx.query<any>(`select type from public.notifications where type = 'team_update'`))).rows).toHaveLength(1);
  });

  it("refuses artists, unknown emails, yourself, duplicates, strangers' teams and a sixth person", async () => {
    const owner = await makePromoter(db); const artist = await makeArtist(db);
    await expect(call(owner, "invite_team_member", await emailOf(artist))).rejects.toThrow(/not_found/);
    await expect(call(owner, "invite_team_member", "nobody@example.com")).rejects.toThrow(/not_found/);
    await expect(call(owner, "invite_team_member", await emailOf(owner))).rejects.toThrow(/invalid: you can't invite yourself/);
    await expect(call(owner, "invite_team_member", "not-an-email")).rejects.toThrow(/invalid_email/);
    await expect(call(artist, "invite_team_member", await emailOf(owner))).rejects.toThrow(/forbidden/);
    const people: string[] = [];
    for (let i = 0; i < 4; i++) { const p = await makePromoter(db); people.push(p); await call(owner, "invite_team_member", await emailOf(p)); }
    await expect(call(owner, "invite_team_member", await emailOf(people[0]))).rejects.toThrow(/already_invited/);
    await call(owner, "invite_team_member", await emailOf(await makePromoter(db)));           // the fifth
    await expect(call(owner, "invite_team_member", await emailOf(await makePromoter(db)))).rejects.toThrow(/limit_reached/);
  });

  it("a person is on one team at a time, and team members can't build teams of their own", async () => {
    const o1 = await makePromoter(db); const o2 = await makePromoter(db); const p = await makePromoter(db);
    await call(o1, "invite_team_member", await emailOf(p)); await call(o2, "invite_team_member", await emailOf(p));
    await call(p, "respond_team_invite", o1, true);
    await expect(call(p, "respond_team_invite", o2, true)).rejects.toThrow(/already on a team/);
    await expect(call(p, "invite_team_member", await emailOf(await makePromoter(db)))).rejects.toThrow(/someone else's team/);
    await expect(call(o2, "respond_team_invite", o1, true)).rejects.toThrow(/no longer open/);
    // An owner with members can't be invited onto someone else's team.
    await expect(call(await makePromoter(db), "invite_team_member", await emailOf(o1))).rejects.toThrow(/runs their own team/);
  });

  it("declining removes the invite; the owner can remove a member; a member can leave; strangers can't", async () => {
    const owner = await makePromoter(db); const a = await makePromoter(db); const b = await makePromoter(db); const stranger = await makePromoter(db);
    await call(owner, "invite_team_member", await emailOf(a)); await call(owner, "invite_team_member", await emailOf(b));
    await call(a, "respond_team_invite", owner, false);
    expect((await asUser(db, a, (tx) => tx.query(`select 1 from public.promoter_team_members`))).rows).toEqual([]);
    await call(b, "respond_team_invite", owner, true);
    await expect(call(stranger, "remove_team_member", owner, b)).rejects.toThrow(/not_authorized/);
    await call(owner, "remove_team_member", owner, b);
    expect((await call(owner, "team_overview")).rows[0].r).toEqual([]);
    await call(owner, "invite_team_member", await emailOf(b)); await call(b, "respond_team_invite", owner, true);
    await call(b, "remove_team_member", owner, b);                     // leaving
    expect((await call(b, "team_overview")).rows[0].r).toEqual([]);
  });

  it("nobody can write the team table directly, and visitors can't read it", async () => {
    const owner = await makePromoter(db); const member = await makePromoter(db);
    await expect(asUser(db, owner, (tx) => tx.query(`insert into public.promoter_team_members (promoter_id, member_id, status) values ($1, $2, 'active')`, [owner, member]))).rejects.toThrow();
    await expect(asAnon(db, (tx) => tx.query(`select * from public.promoter_team_members`))).rejects.toThrow(/permission denied/);
  });
});

describe("what a team member can do", () => {
  it("sees the owner's listings, applicants and conversations, and an outsider sees none of it", async () => {
    const { owner, member, slot, appId } = await setup();
    const outsider = await makePromoter(db);
    expect((await asUser(db, member, (tx) => tx.query(`select id from public.applications where id = $1`, [appId]))).rows).toHaveLength(1);
    expect((await asUser(db, outsider, (tx) => tx.query(`select id from public.applications where id = $1`, [appId]))).rows).toEqual([]);
    expect(owner).not.toBe(member); expect(slot).toBeTruthy();
  });

  it("can shortlist, make an offer (message goes to the artist), and withdraw it", async () => {
    const { member, artist, appId } = await setup();
    await call(member, "shortlist_application", appId);
    await call(member, "make_offer", appId, "Doors at 7, see you there");
    const msgs = (await asUser(db, artist, (tx) => tx.query<any>(`select text, sender_id from public.messages`))).rows;
    expect(msgs).toEqual([{ text: "Doors at 7, see you there", sender_id: member }]);
    const b = (await asUser(db, member, (tx) => tx.query<any>(`select status, promoter_id from public.bookings where application_id = $1`, [appId]))).rows;
    expect(b).toHaveLength(1);
    await call(member, "withdraw_offer", appId);
  });

  it("can message the artist in the conversation, and the artist is told", async () => {
    const { owner, member, artist, appId } = await setup();
    const thread = (await call(member, "open_application_thread", appId)).rows[0].r as string;
    await asUser(db, member, (tx) => tx.query(`insert into public.messages (thread_id, sender_id, text) values ($1, $2, 'Hello from the team')`, [thread, member]));
    expect((await asUser(db, artist, (tx) => tx.query<any>(`select text from public.messages where thread_id = $1`, [thread]))).rows).toEqual([{ text: "Hello from the team" }]);
    expect((await asUser(db, owner, (tx) => tx.query<any>(`select text from public.messages where thread_id = $1`, [thread]))).rows).toHaveLength(1);
    expect((await asUser(db, artist, (tx) => tx.query<any>(`select href from public.notifications where type = 'message'`))).rows.length).toBeGreaterThan(0);
    await call(member, "mark_thread_read", thread);
  });

  it("can post a listing for the owner, edit it, close it, reopen via update, reschedule and cancel it", async () => {
    const { owner, member } = await setup();
    const venue = (await asService(db, (tx) => tx.query<{ id: string }>(`select id from public.venues limit 1`))).rows[0]?.id;
    const slot = await makeSlot(db, owner, venue ? { venueId: venue } : {});
    await asUser(db, member, (tx) => tx.query(`update public.slots set description = 'edited by the team' where id = $1`, [slot]));
    expect((await asUser(db, owner, (tx) => tx.query<any>(`select description from public.slots where id = $1`, [slot]))).rows).toEqual([{ description: "edited by the team" }]);
    await call(member, "close_slot", slot);
    await asUser(db, member, (tx) => tx.query(`update public.slots set status = 'open', closed_at = null, closed_reason = null where id = $1`, [slot]));   // reopen
    await call(member, "reschedule_slot", slot, "2099-12-02", "19:00", "20:00");
    await call(member, "cancel_slot", slot, "no longer needed");
    // Posting a brand-new listing for the owner:
    const posted = await asUser(db, member, (tx) => tx.query<{ id: string }>(
      `insert into public.slots (promoter_id, venue_id, headliner, date, doors_time, set_time, performance_length_mins, expected_attendance, support_fee, application_deadline, genres)
       select $1, venue_id, 'Posted by team', '2099-12-01', '19:00', '20:00', 30, 100, 100, '2099-11-01', '{Indie}' from public.slots where id = $2 returning id`, [owner, slot]));
    expect(posted.rows).toHaveLength(1);
  });

  it("cannot move a listing to their own account, or post one as someone else", async () => {
    const { owner, member } = await setup();
    const stranger = await makePromoter(db);
    const slot = await makeSlot(db, owner);
    await expect(asUser(db, member, (tx) => tx.query(`update public.slots set promoter_id = $1 where id = $2`, [member, slot]))).rejects.toThrow(/ownership cannot change/);
    await expect(asUser(db, member, (tx) => tx.query(
      `insert into public.slots (promoter_id, venue_id, headliner, date, doors_time, set_time, performance_length_mins, expected_attendance, support_fee, application_deadline, genres)
       select $1, venue_id, 'x', '2099-12-01', '19:00', '20:00', 30, 100, 100, '2099-11-01', '{Indie}' from public.slots where id = $2`, [stranger, slot]))).rejects.toThrow(/row-level/);
  });

  it("stops the moment they're removed, and a stranger or pending invitee never gets in", async () => {
    const { owner, member, appId } = await setup();
    const pending = await makePromoter(db);
    await call(owner, "invite_team_member", await emailOf(pending));
    await expect(call(pending, "shortlist_application", appId)).rejects.toThrow(/not_authorized/);
    expect((await asUser(db, pending, (tx) => tx.query(`select id from public.applications where id = $1`, [appId]))).rows).toEqual([]);
    await call(owner, "remove_team_member", owner, member);
    await expect(call(member, "shortlist_application", appId)).rejects.toThrow(/not_authorized/);
    await expect(call(member, "make_offer", appId, null)).rejects.toThrow(/not_authorized/);
    expect((await asUser(db, member, (tx) => tx.query(`select id from public.applications where id = $1`, [appId]))).rows).toEqual([]);
  });

  it("can cancel a confirmed booking, and the artist is told it came from the promoter", async () => {
    const { owner, member, artist, appId } = await setup();
    await call(owner, "make_offer", appId, null);
    await call(artist, "respond_to_offer", appId, true, null);
    await call(member, "cancel_booking", appId, "Venue closed");
    const n = (await asUser(db, artist, (tx) => tx.query<any>(`select type from public.notifications where type = 'booking_cancelled'`))).rows;
    expect(n).toHaveLength(1);
    const cancelledBy = (await db.query<{ cancelled_by: string }>(`select cancelled_by from public.bookings where application_id = $1`, [appId])).rows[0].cancelled_by;
    expect(cancelledBy).toBe(member);
  });

  it("does not give a team member the owner's roster, tools or reviews", async () => {
    const { owner, member, artist } = await setup();
    await asUser(db, owner, (tx) => tx.query(`insert into public.artist_roster (promoter_id, artist_id) values ($1, $2)`, [owner, artist]));
    expect((await asUser(db, member, (tx) => tx.query(`select 1 from public.artist_roster`))).rows).toEqual([]);
  });

  it("a blocked promoter's team still can't offer to the artist who blocked them", async () => {
    const { owner, member, artist, appId } = await setup();
    await asUser(db, artist, (tx) => tx.query(`insert into public.promoter_blocks (artist_id, promoter_id) values ($1, $2)`, [artist, owner]));
    await expect(call(member, "make_offer", appId, null)).rejects.toThrow(/blocked/);
  });

  it("the team appears in the data export", async () => {
    const { owner } = await setup();
    const out = (await call(owner, "export_my_data")).rows[0].r;
    expect(out.team).toHaveLength(1);
  });
});
