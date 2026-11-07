import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createTestDb, makeArtist, makePromoter, makeSlot, PLACES, type Db } from "./harness";

// Invitations, availability requests, blocking, notifications, conversations,
// message retries, data export and account deletion — each from the point of
// view of who may do what, including the people who may not.

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => db.close());

const count = async (sql: string, args: unknown[] = []) => Number((await db.query<{ n: string }>(`select count(*) n from (${sql}) t`, args)).rows[0].n);

describe("gig invitations", () => {
  async function setup() {
    const promoter = await makePromoter(db);
    const artist = await makeArtist(db);
    const slot = await makeSlot(db, promoter);
    return { promoter, artist, slot };
  }
  const invite = (promoter: string, slot: string, artist: string) =>
    asUser(db, promoter, (tx) =>
      tx.query<{ id: string }>(`insert into public.gig_invitations (slot_id, promoter_id, artist_id, message) values ($1,$2,$3,'come play') returning id`, [slot, promoter, artist]));

  it("a promoter can invite an artist to their own listing, and the artist is told (regression: this used to fail on a notification type)", async () => {
    const { promoter, artist, slot } = await setup();
    await invite(promoter, slot, artist);
    const n = await db.query<{ type: string; text: string }>(`select type, text from public.notifications where profile_id = $1`, [artist]);
    expect(n.rows).toHaveLength(1);
    expect(n.rows[0].type).toBe("invitation");
    expect(n.rows[0].text).toContain("invited you");
  });

  it("refuses duplicates, other people's listings, spoofed promoters, blocked artists and suspended artists", async () => {
    const { promoter, artist, slot } = await setup();
    await invite(promoter, slot, artist);
    await expect(invite(promoter, slot, artist)).rejects.toThrow(/duplicate|unique/i);
    const other = await makePromoter(db);
    await expect(invite(other, slot, artist)).rejects.toThrow(/row-level security|not_authorized/);
    await expect(
      asUser(db, other, (tx) => tx.query(`insert into public.gig_invitations (slot_id, promoter_id, artist_id) values ($1,$2,$3)`, [slot, promoter, artist]))
    ).rejects.toThrow(/row-level security/);
    const blocker = await makeArtist(db);
    await asService(db, (tx) => tx.query(`insert into public.promoter_blocks (artist_id, promoter_id) values ($1,$2)`, [blocker, promoter]));
    await expect(invite(promoter, slot, blocker)).rejects.toThrow(/blocked/);
    const suspended = await makeArtist(db);
    await asService(db, (tx) => tx.query(`update public.profiles set suspended_at = now() where id = $1`, [suspended]));
    await expect(invite(promoter, slot, suspended)).rejects.toThrow(/can't be invited/);
    const closed = await makeSlot(db, promoter);
    await asUser(db, promoter, (tx) => tx.query(`select public.close_slot($1)`, [closed]));
    await expect(invite(promoter, closed, await makeArtist(db))).rejects.toThrow(/listing_not_open/);
  });

  it("only the artist can answer, only once; the promoter can only withdraw a pending invitation; nobody edits the rest", async () => {
    const { promoter, artist, slot } = await setup();
    const id = (await invite(promoter, slot, artist)).rows[0].id;
    await expect(asUser(db, promoter, (tx) => tx.query(`update public.gig_invitations set status = 'accepted' where id = $1`, [id]))).rejects.toThrow(/invalid_transition/);
    const another = await makeSlot(db, promoter);
    await expect(asUser(db, artist, (tx) => tx.query(`update public.gig_invitations set slot_id = $2 where id = $1`, [id, another]))).rejects.toThrow(/only the response can change/);
    await expect(asUser(db, artist, (tx) => tx.query(`update public.gig_invitations set artist_id = $2 where id = $1`, [id, promoter]))).rejects.toThrow();
    await expect(asUser(db, artist, (tx) => tx.query(`update public.gig_invitations set message = 'rewritten' where id = $1`, [id]))).rejects.toThrow(/only the response can change/);
    const stranger = await makeArtist(db);
    expect((await asUser(db, stranger, (tx) => tx.query(`update public.gig_invitations set status = 'declined' where id = $1`, [id]))).affectedRows).toBe(0);
    await asUser(db, artist, (tx) => tx.query(`update public.gig_invitations set status = 'declined', responded_at = now() where id = $1`, [id]));
    await expect(asUser(db, artist, (tx) => tx.query(`update public.gig_invitations set status = 'accepted' where id = $1`, [id]))).rejects.toThrow(/already answered/);
    await expect(asUser(db, promoter, (tx) => tx.query(`update public.gig_invitations set status = 'withdrawn' where id = $1`, [id]))).rejects.toThrow(/already answered/);
    const second = await setup();
    const id2 = (await invite(second.promoter, second.slot, second.artist)).rows[0].id;
    await asUser(db, second.promoter, (tx) => tx.query(`update public.gig_invitations set status = 'withdrawn' where id = $1`, [id2]));
    expect(await count(`select 1 from public.gig_invitations where id = '${id2}' and status = 'withdrawn'`)).toBe(1);
  });

  it("accepting links an application that really belongs to this artist and listing", async () => {
    const { promoter, artist, slot } = await setup();
    const id = (await invite(promoter, slot, artist)).rows[0].id;
    const app = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1,$2) returning id`, [slot, artist]))).rows[0].id;
    const otherSlot = await makeSlot(db, promoter);
    const otherApp = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1,$2) returning id`, [otherSlot, artist]))).rows[0].id;
    await expect(asUser(db, artist, (tx) => tx.query(`update public.gig_invitations set status='accepted', linked_application_id=$2 where id=$1`, [id, otherApp]))).rejects.toThrow(/doesn't belong/);
    await asUser(db, artist, (tx) => tx.query(`update public.gig_invitations set status='accepted', linked_application_id=$2, responded_at=now() where id=$1`, [id, app]));
    expect(await count(`select 1 from public.notifications where profile_id = '${promoter}' and text like '%accepted your invitation%'`)).toBe(1);
  });
});

describe("availability requests", () => {
  async function setup() {
    const promoter = await makePromoter(db);
    const artist = await makeArtist(db);
    const req = (await asUser(db, promoter, (tx) =>
      tx.query<{ id: string }>(
        `insert into public.availability_requests (promoter_id, event_name, event_date, event_time, venue_name, venue_location, proposed_fee, set_length_mins, response_deadline)
         values ($1,'Support night','2099-12-01','20:00','Hall','Leeds',100,30, now() + interval '3 days') returning id`, [promoter]))).rows[0].id;
    const rec = (await asUser(db, promoter, (tx) =>
      tx.query<{ id: string }>(`insert into public.availability_request_recipients (request_id, artist_id) values ($1,$2) returning id`, [req, artist]))).rows[0].id;
    return { promoter, artist, req, rec };
  }

  it("only the artist answers; the promoter cannot answer for them or rewrite the recipient", async () => {
    const { promoter, artist, rec } = await setup();
    await expect(asUser(db, promoter, (tx) => tx.query(`update public.availability_request_recipients set response='available' where id=$1`, [rec]))).rejects.toThrow(/only the artist can reply/);
    await expect(asUser(db, artist, (tx) => tx.query(`update public.availability_request_recipients set artist_id=$2 where id=$1`, [rec, promoter]))).rejects.toThrow();
    await asUser(db, artist, (tx) => tx.query(`update public.availability_request_recipients set response='available', responded_at=now() where id=$1`, [rec]));
    expect(await count(`select 1 from public.notifications where profile_id = '${promoter}' and type = 'availability_response'`)).toBe(1);
  });

  it("is private to the promoter and the recipients", async () => {
    const { artist, req } = await setup();
    const outsider = await makeArtist(db);
    expect(await count(`select 1 from public.availability_requests where id = '${req}'`)).toBe(1); // as service
    expect((await asUser(db, outsider, (tx) => tx.query(`select 1 from public.availability_requests where id = $1`, [req]))).rows).toHaveLength(0);
    expect((await asUser(db, artist, (tx) => tx.query(`select 1 from public.availability_requests where id = $1`, [req]))).rows).toHaveLength(1);
  });

  it("cannot add an artist who blocked the promoter, a suspended artist, or pre-filled replies", async () => {
    const promoter = await makePromoter(db);
    const blocker = await makeArtist(db);
    await asService(db, (tx) => tx.query(`insert into public.promoter_blocks (artist_id, promoter_id) values ($1,$2)`, [blocker, promoter]));
    const req = (await asUser(db, promoter, (tx) =>
      tx.query<{ id: string }>(
        `insert into public.availability_requests (promoter_id, event_name, event_date, event_time, venue_name, venue_location, proposed_fee, set_length_mins, response_deadline)
         values ($1,'Night','2099-12-01','20:00','Hall','Leeds',100,30, now() + interval '3 days') returning id`, [promoter]))).rows[0].id;
    await expect(asUser(db, promoter, (tx) => tx.query(`insert into public.availability_request_recipients (request_id, artist_id) values ($1,$2)`, [req, blocker]))).rejects.toThrow(/row-level security/);
    const eager = await makeArtist(db);
    await expect(asUser(db, promoter, (tx) => tx.query(`insert into public.availability_request_recipients (request_id, artist_id, response) values ($1,$2,'available')`, [req, eager]))).rejects.toThrow(/must be pending/);
    const suspended = await makeArtist(db);
    await asService(db, (tx) => tx.query(`update public.profiles set suspended_at = now() where id = $1`, [suspended]));
    await expect(asUser(db, promoter, (tx) => tx.query(`insert into public.availability_request_recipients (request_id, artist_id) values ($1,$2)`, [req, suspended]))).rejects.toThrow(/can't be asked/);
  });

  it("a request can only link to the promoter's own listing and only moves sent → withdrawn/filled", async () => {
    const { promoter, req } = await setup();
    const theirs = await makeSlot(db, await makePromoter(db));
    await expect(asUser(db, promoter, (tx) => tx.query(`update public.availability_requests set linked_slot_id=$2 where id=$1`, [req, theirs]))).rejects.toThrow(/isn't yours/);
    await asUser(db, promoter, (tx) => tx.query(`update public.availability_requests set status='withdrawn' where id=$1`, [req]));
    await expect(asUser(db, promoter, (tx) => tx.query(`update public.availability_requests set status='sent' where id=$1`, [req]))).rejects.toThrow(/invalid_transition/);
    await expect(asUser(db, promoter, (tx) => tx.query(`update public.availability_requests set promoter_id=$2 where id=$1`, [req, theirs]))).rejects.toThrow();
  });
});

describe("blocking (artist blocks promoter) is enforced in SQL", () => {
  async function pair() {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1,$2) returning id`, [slot, artist]))).rows[0].id;
    return { artist, promoter, slot, app };
  }
  const block = (artist: string, promoter: string) => asUser(db, artist, (tx) => tx.query(`insert into public.promoter_blocks (artist_id, promoter_id) values ($1,$2)`, [artist, promoter]));

  it("stops the promoter messaging, opening threads, inviting, or offering — but leaves the artist able to message", async () => {
    const { artist, promoter, slot, app } = await pair();
    const thread = (await asUser(db, artist, (tx) => tx.query<{ t: string }>(`select public.open_application_thread($1) as t`, [app]))).rows[0].t;
    await block(artist, promoter);
    await expect(asUser(db, promoter, (tx) => tx.query(`insert into public.messages (thread_id, sender_id, text) values ($1,$2,'hi')`, [thread, promoter]))).rejects.toThrow(/blocked/);
    await expect(asUser(db, promoter, (tx) => tx.query(`select public.open_application_thread($1)`, [app]))).rejects.toThrow(/blocked/);
    await expect(asUser(db, promoter, (tx) => tx.query(`select public.make_offer($1, null)`, [app]))).rejects.toThrow(/blocked/);
    await expect(asUser(db, promoter, (tx) => tx.query(`insert into public.gig_invitations (slot_id, promoter_id, artist_id) values ($1,$2,$3)`, [slot, promoter, artist]))).rejects.toThrow(/blocked/);
    await asUser(db, artist, (tx) => tx.query(`insert into public.messages (thread_id, sender_id, text) values ($1,$2,'still here')`, [thread, artist]));
  });

  it("only the artist can set or lift a block, only against a promoter, and unblocking restores access", async () => {
    const { artist, promoter, app } = await pair();
    await expect(asUser(db, promoter, (tx) => tx.query(`insert into public.promoter_blocks (artist_id, promoter_id) values ($1,$2)`, [artist, promoter]))).rejects.toThrow(/row-level security/);
    const other = await makeArtist(db);
    await expect(asUser(db, other, (tx) => tx.query(`insert into public.promoter_blocks (artist_id, promoter_id) values ($1,$2)`, [artist, promoter]))).rejects.toThrow(/row-level security/);
    await block(artist, promoter);
    expect((await asUser(db, other, (tx) => tx.query(`delete from public.promoter_blocks where artist_id = $1`, [artist]))).affectedRows).toBe(0);
    await asUser(db, artist, (tx) => tx.query(`delete from public.promoter_blocks where artist_id = $1 and promoter_id = $2`, [artist, promoter]));
    await asUser(db, promoter, (tx) => tx.query(`select public.open_application_thread($1)`, [app]));
  });

  it("does not silently cancel an offer or booking already agreed", async () => {
    const { artist, promoter, app } = await pair();
    await asUser(db, promoter, (tx) => tx.query(`select public.make_offer($1, null)`, [app]));
    await block(artist, promoter);
    const res = await asUser(db, artist, (tx) => tx.query<{ r: string }>(`select public.respond_to_offer($1, true, null) as r`, [app]));
    expect(res.rows[0].r).toBe("confirmed");
  });
});

describe("notifications and conversations cannot be rewritten", () => {
  it("a user can mark their notification read and nothing else", async () => {
    const artist = await makeArtist(db);
    await asService(db, (tx) => tx.query(`select public.notify($1, 'system', 'Original text', '/applications', null, false)`, [artist]));
    await expect(asUser(db, artist, (tx) => tx.query(`update public.notifications set text = 'You won £1,000,000' where profile_id = $1`, [artist]))).rejects.toThrow(/only the read state/);
    await expect(asUser(db, artist, (tx) => tx.query(`update public.notifications set href = 'https://evil.example' where profile_id = $1`, [artist]))).rejects.toThrow(/only the read state/);
    await asUser(db, artist, (tx) => tx.query(`update public.notifications set read = true where profile_id = $1`, [artist]));
    const other = await makeArtist(db);
    expect((await asUser(db, other, (tx) => tx.query(`update public.notifications set read = true where profile_id = $1`, [artist]))).affectedRows).toBe(0);
  });

  it("a participant cannot re-point a conversation at someone else", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const victim = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1,$2) returning id`, [slot, artist]))).rows[0].id;
    const thread = (await asUser(db, artist, (tx) => tx.query<{ t: string }>(`select public.open_application_thread($1) as t`, [app]))).rows[0].t;
    await expect(asUser(db, artist, (tx) => tx.query(`update public.message_threads set promoter_id = $2 where id = $1`, [thread, victim]))).rejects.toThrow(/cannot be changed/);
    expect((await asUser(db, victim, (tx) => tx.query(`select 1 from public.message_threads where id = $1`, [thread]))).rows).toHaveLength(0);
  });
});

describe("messages: persistence, pagination order, unread, safe retry", () => {
  it("the same client_id sent twice is one message; a different sender may reuse the id", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1,$2) returning id`, [slot, artist]))).rows[0].id;
    const thread = (await asUser(db, artist, (tx) => tx.query<{ t: string }>(`select public.open_application_thread($1) as t`, [app]))).rows[0].t;
    const cid = "11111111-1111-4111-8111-111111111111";
    const send = (who: string, text: string) =>
      asUser(db, who, (tx) => tx.query(`insert into public.messages (thread_id, sender_id, text, client_id) values ($1,$2,$3,$4) on conflict (sender_id, client_id) do nothing`, [thread, who, text, cid]));
    await send(artist, "hello");
    await send(artist, "hello"); // retry after a dropped connection
    await send(promoter, "hi back"); // other sender: separate namespace
    const msgs = await db.query<{ text: string }>(`select text from public.messages where thread_id = $1 order by created_at, text`, [thread]);
    expect(msgs.rows.map((m) => m.text).sort()).toEqual(["hello", "hi back"]);
    expect(await count(`select 1 from public.notifications where profile_id = '${promoter}' and type = 'message' and read = false`)).toBe(1);
    // Reading clears the unread notification and the unread state.
    await asUser(db, promoter, (tx) => tx.query(`select public.mark_thread_read($1)`, [thread]));
    expect(await count(`select 1 from public.notifications where profile_id = '${promoter}' and type = 'message' and read = false`)).toBe(0);
  });
});

describe("applications and offers: edge rules", () => {
  async function offered() {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1,$2) returning id`, [slot, artist]))).rows[0].id;
    return { artist, promoter, slot, app };
  }

  it("'viewed' is recorded only when the owning promoter actually views: not by the artist, a stranger, or an offer-less retry", async () => {
    const { artist, promoter, app } = await offered();
    const stranger = await makePromoter(db);
    await expect(asUser(db, artist, (tx) => tx.query(`select public.mark_application_viewed($1)`, [app]))).rejects.toThrow(/not_authorized/);
    await expect(asUser(db, stranger, (tx) => tx.query(`select public.mark_application_viewed($1)`, [app]))).rejects.toThrow(/not_authorized/);
    expect((await db.query<{ status: string; viewed_at: string | null }>(`select status, viewed_at from public.applications where id = $1`, [app])).rows[0]).toEqual({ status: "submitted", viewed_at: null });
    await asUser(db, promoter, (tx) => tx.query(`select public.mark_application_viewed($1)`, [app]));
    await asUser(db, promoter, (tx) => tx.query(`select public.mark_application_viewed($1)`, [app])); // retry is a no-op
    expect(await count(`select 1 from public.notifications where profile_id = '${artist}' and type = 'viewed'`)).toBe(1);
  });

  it("an offer past its deadline cannot be accepted even though no background job has run; the sweep then clears it", async () => {
    const { artist, promoter, app } = await offered();
    await asUser(db, promoter, (tx) => tx.query(`select public.make_offer($1, null)`, [app]));
    await asService(db, (tx) => tx.query(`update public.bookings set offer_expires_at = now() - interval '1 minute' where application_id = $1`, [app]));
    await expect(asUser(db, artist, (tx) => tx.query(`select public.respond_to_offer($1, true, null)`, [app]))).rejects.toThrow(/offer_expired/);
    expect((await db.query<{ status: string }>(`select status from public.bookings where application_id = $1`, [app])).rows[0].status).toBe("offered"); // untouched: the failed attempt changed nothing
    await asUser(db, artist, (tx) => tx.query(`select public.refresh_expired_offers()`));
    expect((await db.query<{ status: string }>(`select status from public.bookings where application_id = $1`, [app])).rows[0].status).not.toBe("offered");
  });

  it("retries are idempotent where they should be, and refused where repeating would be wrong", async () => {
    const { artist, promoter, app } = await offered();
    await asUser(db, promoter, (tx) => tx.query(`select public.shortlist_application($1)`, [app]));
    await expect(asUser(db, promoter, (tx) => tx.query(`select public.shortlist_application($1)`, [app]))).rejects.toThrow(/invalid_transition/);
    const first = await asUser(db, promoter, (tx) => tx.query<{ id: string }>(`select public.make_offer($1, null) as id`, [app]));
    await expect(asUser(db, promoter, (tx) => tx.query(`select public.make_offer($1, null)`, [app]))).rejects.toThrow(/invalid_transition/);
    expect(await count(`select 1 from public.bookings where application_id = '${app}'`)).toBe(1);
    await asUser(db, artist, (tx) => tx.query(`select public.respond_to_offer($1, true, null)`, [app]));
    await expect(asUser(db, artist, (tx) => tx.query(`select public.respond_to_offer($1, true, null)`, [app]))).rejects.toThrow(/invalid_transition/);
    expect(first.rows[0].id).toBeTruthy();
    // Withdrawing twice, cancelling twice: second is refused, state unchanged.
    await asUser(db, artist, (tx) => tx.query(`select public.cancel_booking($1, 'Van broke down')`, [app]));
    await expect(asUser(db, artist, (tx) => tx.query(`select public.cancel_booking($1, 'again')`, [app]))).rejects.toThrow(/invalid_transition/);
  });

  it("the agreed terms are a snapshot: editing the listing's wording or venue after the offer doesn't change what was agreed", async () => {
    const { promoter, slot, app } = await offered();
    await asUser(db, promoter, (tx) => tx.query(`select public.make_offer($1, null)`, [app]));
    const before = (await db.query(`select fee_pence, travel_pence, venue_name, venue_city, event_date, set_length_mins from public.bookings where application_id = $1`, [app])).rows[0];
    await expect(asUser(db, promoter, (tx) => tx.query(`update public.slots set support_fee = 1 where id = $1`, [slot]))).rejects.toThrow(/listing_locked/);
    await asService(db, (tx) => tx.query(`update public.venues set name = 'Renamed Hall' where id = (select venue_id from public.slots where id = $1)`, [slot]));
    expect((await db.query(`select fee_pence, travel_pence, venue_name, venue_city, event_date, set_length_mins from public.bookings where application_id = $1`, [app])).rows[0]).toEqual(before);
  });

  it("an application can't be made to a listing that is closed, cancelled or already booked", async () => {
    const promoter = await makePromoter(db);
    const artist = await makeArtist(db);
    const slot = await makeSlot(db, promoter);
    await asUser(db, promoter, (tx) => tx.query(`select public.cancel_slot($1, 'not happening')`, [slot]));
    await expect(asUser(db, artist, (tx) => tx.query(`insert into public.applications (slot_id, artist_id) values ($1,$2)`, [slot, artist]))).rejects.toThrow(/listing_not_open/);
  });
});

describe("data export", () => {
  it("contains the requester's own records, including private location and tools, and never staff notes or others' private data", async () => {
    const promoter = await makePromoter(db);
    const artist = await makeArtist(db, { place: PLACES.brighton });
    const stranger = await makeArtist(db, { name: "Stranger Danger", place: PLACES.cardiff });
    const strangerPromoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    await asUser(db, artist, (tx) => tx.query(`insert into public.applications (slot_id, artist_id, message) values ($1,$2,'my pitch')`, [slot, artist]));
    await asUser(db, stranger, (tx) => tx.query(`insert into public.applications (slot_id, artist_id, message) values ($1,$2,'stranger pitch')`, [slot, stranger]));
    await asUser(db, promoter, (tx) => tx.query(`insert into public.artist_roster (promoter_id, artist_id, notes, tags) values ($1,$2,'private note about them','{loud}')`, [promoter, artist]));
    await asUser(db, strangerPromoter, (tx) => tx.query(`insert into public.artist_roster (promoter_id, artist_id, notes) values ($1,$2,'someone elses roster note')`, [strangerPromoter, artist]));
    // A support request that staff have annotated, and a report with a resolution note.
    const sr = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`select public.submit_support_request('bug', 'Something is broken on my screen', null) as id`))).rows[0].id;
    await asService(db, (tx) => tx.query(`update public.support_requests set staff_note = 'INTERNAL: this user is a known time waster', handled_by = $2 where id = $1`, [sr, promoter]));
    const rep = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`select public.submit_report('slot', $1, $2, 'This listing looked suspicious to me') as id`, [slot, promoter]))).rows[0].id;
    await asService(db, (tx) => tx.query(`update public.reports set resolution_note = 'INTERNAL: reporter is unreliable', reviewed_by = $2 where id = $1`, [rep, promoter]));
    await asService(db, (tx) => tx.query(`update public.profiles set admin_role = 'moderator' where id = $1`, [artist]));

    const mine = (await asUser(db, artist, (tx) => tx.query<{ d: Record<string, unknown> }>(`select public.export_my_data() as d`))).rows[0].d;
    const text = JSON.stringify(mine);
    expect(text).toContain("my pitch");
    expect(text).toContain("Something is broken");
    expect(mine.artist_private_location).toMatchObject({ lat: 50.82, lon: -0.14 });
    expect(text).not.toContain("INTERNAL");
    expect(text).not.toContain("known time waster");
    expect(text).not.toContain("admin_role");
    expect(text).not.toContain("private note about them"); // the promoter's note about me is the promoter's data
    expect(text).not.toContain("someone elses roster note");
    expect(text).not.toContain("stranger pitch");
    expect(text).not.toContain("Stranger Danger");
    expect(text).not.toContain(stranger);

    const theirs = (await asUser(db, promoter, (tx) => tx.query<{ d: Record<string, unknown> }>(`select public.export_my_data() as d`))).rows[0].d;
    const t2 = JSON.stringify(theirs);
    expect(t2).toContain("private note about them"); // their own roster
    expect(t2).toContain("my pitch"); // applications to their listing: they are entitled
    expect(t2).not.toContain("someone elses roster note");
    expect(t2).not.toContain("INTERNAL");
    expect(JSON.stringify((theirs as { artist: unknown }).artist)).toBe("null");
  });

  it("works for any signed-in user, and is refused for visitors", async () => {
    const artist = await makeArtist(db);
    expect((await asUser(db, artist, (tx) => tx.query(`select public.export_my_data()`), { aal: "aal1" })).rows).toHaveLength(1);
    await expect(asAnon(db, (tx) => tx.query(`select public.export_my_data()`))).rejects.toThrow(/permission denied/);
  });
});

describe("account deletion", () => {
  it("refuses visitors, removes the login, and leaves staff audit rows with the actor cleared (not deleted)", async () => {
    const artist = await makeArtist(db);
    await expect(asAnon(db, (tx) => tx.query(`select public.delete_my_account()`))).rejects.toThrow(/permission denied/);
    expect(await count(`select 1 from auth.users where id = '${artist}'`)).toBe(1);

    const mod = await makePromoter(db);
    await asService(db, (tx) => tx.query(`update public.profiles set admin_role = 'moderator' where id = $1`, [mod]));
    const target = await makeArtist(db);
    await asUser(db, mod, (tx) => tx.query(`select public.admin_suspend_user($1, 'Spam and harassment')`, [target]));
    await asUser(db, artist, (tx) => tx.query(`select public.delete_my_account()`));
    expect(await count(`select 1 from auth.users where id = '${artist}'`)).toBe(0);
    expect(await count(`select 1 from public.profiles where id = '${artist}'`)).toBe(0);
    // Audit history of staff actions is retained.
    expect(await count(`select 1 from public.admin_audit_log where action = 'user.suspend'`)).toBeGreaterThan(0);
  });

  it("a suspended person can still delete their account", async () => {
    const artist = await makeArtist(db);
    await asService(db, (tx) => tx.query(`update public.profiles set suspended_at = now() where id = $1`, [artist]));
    await asUser(db, artist, (tx) => tx.query(`select public.delete_my_account()`));
    expect(await count(`select 1 from auth.users where id = '${artist}'`)).toBe(0);
  });

  it("is refused while there is an upcoming confirmed booking, and the account stays active", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1,$2) returning id`, [slot, artist]))).rows[0].id;
    await asUser(db, promoter, (tx) => tx.query(`select public.make_offer($1, null)`, [app]));
    await asUser(db, artist, (tx) => tx.query(`select public.respond_to_offer($1, true, null)`, [app]));
    await expect(asUser(db, artist, (tx) => tx.query(`select public.delete_my_account()`))).rejects.toThrow(/deletion_blocked/);
    expect(await count(`select 1 from auth.users where id = '${artist}'`)).toBe(1);
    expect((await asUser(db, artist, (tx) => tx.query(`select 1 from public.profiles`))).rows).toHaveLength(1);
  });

  it("DOCUMENTED RETENTION BEHAVIOUR (unresolved decisions): what survives a deletion", async () => {
    // Not a claim that this is right — a record of what the schema does today so that a
    // human decides. See docs/CURRENT_STATE.md "Retention decisions".
    const artist = await makeArtist(db, { name: "Soon Deleted" });
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1,$2) returning id`, [slot, artist]))).rows[0].id;
    const thread = (await asUser(db, artist, (tx) => tx.query<{ t: string }>(`select public.open_application_thread($1) as t`, [app]))).rows[0].t;
    await asUser(db, artist, (tx) => tx.query(`insert into public.messages (thread_id, sender_id, text) values ($1,$2,'hello promoter')`, [thread, artist]));
    await asUser(db, artist, (tx) => tx.query(`select public.submit_support_request('account', 'please look at my account soon', null)`));
    await asService(db, (tx) => tx.query(`update public.slots set date = '2000-01-01', application_deadline = '2000-01-01' where id = $1`, [slot])); // a past booking would also survive; keep this simple
    await asUser(db, artist, (tx) => tx.query(`select public.delete_my_account()`));
    // 1. The whole conversation disappears for the other participant too.
    expect(await count(`select 1 from public.message_threads where id = '${thread}'`)).toBe(0);
    // 2. A support request keeps the person's email address and message, unlinked from a profile.
    expect(await count(`select 1 from public.support_requests where message like 'please look at my account%' and profile_id is null`)).toBe(1);
  });
});
