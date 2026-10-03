import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createTestDb, makeArtist, makePromoter, makeSlot, type Db } from "./harness";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => db.close());

const svc = (sql: string, params: unknown[] = []) => asService(db, (tx) => tx.query(sql, params));
const asPromoter = (id: string, fn: string, ...a: unknown[]) =>
  asUser(db, id, (tx) => tx.query(`select public.${fn}(${a.map((_, i) => `$${i + 1}`).join(",")})`, a));

/** artist applied -> offered -> accepted: a confirmed, unpaid booking. */
async function confirmedBooking() {
  const artist = await makeArtist(db, { location: "London" });
  const promoter = await makePromoter(db);
  const slot = await makeSlot(db, promoter, { supportFee: 200 });
  const app = (
    await asUser(db, artist, (tx) =>
      tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1, $2) returning id`, [slot, artist])
    )
  ).rows[0].id;
  await asPromoter(promoter, "make_offer", app);
  await asUser(db, artist, (tx) => tx.query(`select public.respond_to_offer($1, true, null)`, [app]));
  const b = (await db.query<{ id: string; total_pence: number }>(`select id, total_pence from public.bookings where application_id = $1`, [app])).rows[0];
  return { artist, promoter, slot, app, bookingId: b.id, total: b.total_pence };
}
async function row(bookingId: string) {
  return (await db.query<Record<string, unknown>>(`select * from public.bookings where id = $1`, [bookingId])).rows[0];
}
const events = async (bookingId: string) =>
  (await db.query<{ kind: string }>(`select kind from public.payment_events where booking_id = $1 order by kind`, [bookingId])).rows.map((r) => r.kind);
const count = async (profile: string, type: string) =>
  (await db.query(`select 1 from public.notifications where profile_id = $1 and type = $2`, [profile, type])).rows.length;

const T0 = "2026-10-01T10:00:00Z";
const T1 = "2026-10-01T10:05:00Z";
const T2 = "2026-10-01T10:10:00Z";
const succeed = (eventId: string, pi: string, booking: string, amount: number, at = T0) =>
  svc(`select public.apply_payment_succeeded($1, $2, $3, $4, $5, 'ch_' || $3, 'https://pay.stripe.com/receipts/x')`, [eventId, at, pi, booking, amount]);

describe("payment lifecycle", () => {
  it("only a confirmed booking can start a payment, and a paid one cannot be paid again", async () => {
    const { bookingId } = await confirmedBooking();
    await svc(`select public.attach_payment_intent($1, 'pi_1')`, [bookingId]);
    expect((await row(bookingId)).stripe_payment_intent_id).toBe("pi_1");

    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1,$2) returning id`, [slot, artist]))).rows[0].id;
    await asPromoter(promoter, "make_offer", app);
    const offered = (await db.query<{ id: string }>(`select id from public.bookings where application_id = $1`, [app])).rows[0].id;
    await expect(svc(`select public.attach_payment_intent($1, 'pi_x')`, [offered])).rejects.toThrow(/booking_not_confirmed/);
  });

  it("a verified success marks the booking paid and notifies once; a duplicate delivery changes nothing", async () => {
    const { bookingId, total, promoter, artist } = await confirmedBooking();
    await svc(`select public.attach_payment_intent($1, 'pi_2')`, [bookingId]);
    await succeed("evt_1", "pi_2", bookingId, total);
    await succeed("evt_1", "pi_2", bookingId, total); // Stripe redelivery
    const b = await row(bookingId);
    expect(b.payment_status).toBe("paid");
    expect(b.receipt_url).toContain("stripe.com");
    expect(await events(bookingId)).toEqual(["payment_started", "payment_succeeded"]); // one succeeded event, not two
    expect(await count(promoter, "payment_received")).toBe(1);
    expect(await count(artist, "payment_received")).toBe(1);
    // A DIFFERENT event id for the same payment is also harmless to the state.
    await succeed("evt_1b", "pi_2", bookingId, total);
    expect((await row(bookingId)).payment_status).toBe("paid");
    expect(await count(promoter, "payment_received")).toBe(1);
  });

  it("refuses to mark paid when the amount or PaymentIntent doesn't match the agreed booking", async () => {
    const { bookingId, total } = await confirmedBooking();
    await svc(`select public.attach_payment_intent($1, 'pi_3')`, [bookingId]);
    await expect(succeed("evt_a", "pi_3", bookingId, total - 1)).rejects.toThrow(/amount_mismatch/);
    await expect(succeed("evt_b", "pi_OTHER", bookingId, total)).rejects.toThrow(/payment_unmatched/);
    await expect(succeed("evt_c", "pi_3", "00000000-0000-0000-0000-000000000000", total)).rejects.toThrow(/payment_unmatched/);
    expect((await row(bookingId)).payment_status).toBe("unpaid");
  });

  it("a checkout return page can never mark a booking paid: clients have no way to write payment state", async () => {
    const { bookingId, artist, promoter } = await confirmedBooking();
    for (const who of [artist, promoter]) {
      const res = await asUser(db, who, (tx) => tx.query(`update public.bookings set payment_status = 'paid' where id = $1`, [bookingId]));
      expect(res.affectedRows).toBe(0);
      await expect(asUser(db, who, (tx) => tx.query(`select public.apply_payment_succeeded('e','2026-01-01','pi',$1,1,'c','r')`, [bookingId]))).rejects.toThrow(/permission denied/);
    }
    expect((await row(bookingId)).payment_status).toBe("unpaid");
  });

  it("failure then success ends paid; success then a late failure does NOT downgrade", async () => {
    const a = await confirmedBooking();
    await svc(`select public.attach_payment_intent($1, 'pi_4')`, [a.bookingId]);
    await svc(`select public.apply_payment_failed('evt_f1', $1, 'pi_4', $2, 'card_declined')`, [T0, a.bookingId]);
    expect((await row(a.bookingId)).payment_status).toBe("failed");
    expect(await count(a.promoter, "payment_failed")).toBe(1);
    await succeed("evt_s1", "pi_4", a.bookingId, a.total, T1);
    expect((await row(a.bookingId)).payment_status).toBe("paid");
    await svc(`select public.apply_payment_failed('evt_f2', $1, 'pi_4', $2, 'late')`, [T2, a.bookingId]);
    expect((await row(a.bookingId)).payment_status).toBe("paid");
  });

  it("refunds only move forward (cumulative), partial then full, in any delivery order", async () => {
    const { bookingId, total } = await confirmedBooking();
    await svc(`select public.attach_payment_intent($1, 'pi_5')`, [bookingId]);
    await succeed("evt_s", "pi_5", bookingId, total);
    // full refund event arrives BEFORE the earlier partial one
    await svc(`select public.apply_refund('evt_r2', $1, 'pi_5', 'ch_pi_5', $2)`, [T2, total]);
    await svc(`select public.apply_refund('evt_r1', $1, 'pi_5', 'ch_pi_5', $2)`, [T1, 1000]);
    const b = await row(bookingId);
    expect(b.refunded_pence).toBe(total);
    expect(b.payment_status).toBe("refunded");
    // a late payment_succeeded redelivery can't resurrect it
    await succeed("evt_s_again", "pi_5", bookingId, total, T2);
    expect((await row(bookingId)).payment_status).toBe("refunded");
  });

  it("a partial refund is recorded as partially_refunded", async () => {
    const { bookingId, total } = await confirmedBooking();
    await svc(`select public.attach_payment_intent($1, 'pi_6')`, [bookingId]);
    await succeed("evt_s6", "pi_6", bookingId, total);
    await svc(`select public.apply_refund('evt_r6', $1, 'pi_6', 'ch_pi_6', 2500)`, [T1]);
    expect((await row(bookingId)).payment_status).toBe("partially_refunded");
  });

  it("disputes: opened -> lost stays disputed; opened -> won returns to paid; never backwards", async () => {
    const a = await confirmedBooking();
    await svc(`select public.attach_payment_intent($1, 'pi_7')`, [a.bookingId]);
    await succeed("evt_s7", "pi_7", a.bookingId, a.total);
    await svc(`select public.apply_dispute('evt_d1', $1, 'pi_7', 'ch_pi_7', 'opened', $2)`, [T1, a.total]);
    expect((await row(a.bookingId)).payment_status).toBe("disputed");
    expect(await count(a.artist, "dispute")).toBe(1);
    await svc(`select public.apply_dispute('evt_d1', $1, 'pi_7', 'ch_pi_7', 'opened', $2)`, [T1, a.total]); // dup
    expect(await count(a.artist, "dispute")).toBe(1);
    await svc(`select public.apply_dispute('evt_d2', $1, 'pi_7', 'ch_pi_7', 'won', $2)`, [T2, a.total]);
    expect((await row(a.bookingId)).payment_status).toBe("paid");
    expect((await row(a.bookingId)).dispute_status).toBe("won");
    // a stray "opened" after the outcome is recorded but doesn't reopen it
    await svc(`select public.apply_dispute('evt_d3', $1, 'pi_7', 'ch_pi_7', 'opened', $2)`, [T2, a.total]);
    expect((await row(a.bookingId)).dispute_status).toBe("won");

    const b = await confirmedBooking();
    await svc(`select public.attach_payment_intent($1, 'pi_8')`, [b.bookingId]);
    await succeed("evt_s8", "pi_8", b.bookingId, b.total);
    await svc(`select public.apply_dispute('evt_d4', $1, 'pi_8', 'ch_pi_8', 'opened', $2)`, [T1, b.total]);
    await svc(`select public.apply_dispute('evt_d5', $1, 'pi_8', 'ch_pi_8', 'lost', $2)`, [T2, b.total]);
    expect((await row(b.bookingId)).payment_status).toBe("disputed");
    expect((await row(b.bookingId)).dispute_status).toBe("lost");
  });

  it("a payment that lands after the booking was cancelled is flagged for a refund decision", async () => {
    const { bookingId, total, artist } = await confirmedBooking();
    await svc(`select public.attach_payment_intent($1, 'pi_9')`, [bookingId]);
    const app = (await db.query<{ application_id: string }>(`select application_id from public.bookings where id = $1`, [bookingId])).rows[0].application_id;
    await asUser(db, artist, (tx) => tx.query(`select public.cancel_booking($1, 'changed my mind')`, [app]));
    await succeed("evt_s9", "pi_9", bookingId, total);
    const b = await row(bookingId);
    expect(b.payment_status).toBe("paid");
    expect(b.refund_review_required).toBe(true);
  });
});

describe("stripe event ledger", () => {
  it("processes an event once, retries a failed one, and holds off a concurrent delivery", async () => {
    const r1 = await svc(`select public.begin_stripe_event('evt_x', 'payment_intent.succeeded') as r`);
    expect((r1.rows[0] as { r: string }).r).toBe("new");
    const r2 = await svc(`select public.begin_stripe_event('evt_x', 'payment_intent.succeeded') as r`);
    expect((r2.rows[0] as { r: string }).r).toBe("in_progress");
    await svc(`select public.finish_stripe_event('evt_x', 'boom')`);
    const r3 = await svc(`select public.begin_stripe_event('evt_x', 'payment_intent.succeeded') as r`);
    expect((r3.rows[0] as { r: string }).r).toBe("retry");
    await svc(`select public.finish_stripe_event('evt_x')`);
    const r4 = await svc(`select public.begin_stripe_event('evt_x', 'payment_intent.succeeded') as r`);
    expect((r4.rows[0] as { r: string }).r).toBe("duplicate");
  });
});

describe("Support+ billing state", () => {
  const sub = (event: string, at: string, promoter: string, subId: string, status: string, cancelAtEnd = false, end = "2026-11-01T00:00:00Z") =>
    svc(`select public.apply_subscription_state($1, $2, $3, $4, $5, $6, $7, 'monthly')`, [event, at, promoter, subId, status, end, cancelAtEnd]);
  const profile = async (id: string) =>
    (await db.query<Record<string, unknown>>(`select is_support_plus, support_plus_status, support_plus_cancel_at_period_end, stripe_subscription_id from public.profiles where id = $1`, [id])).rows[0];

  it("purchase -> failed renewal (kept on while retrying) -> cancelled (off)", async () => {
    const p = await makePromoter(db);
    await sub("e1", T0, p, "sub_1", "active");
    expect((await profile(p)).is_support_plus).toBe(true);
    await sub("e2", T1, p, "sub_1", "past_due");
    const pd = await profile(p);
    expect(pd.is_support_plus).toBe(true); // grace while Stripe retries
    expect(pd.support_plus_status).toBe("past_due");
    expect(await count(p, "subscription")).toBe(2); // "Support+ is active", then "payment failed"
    await sub("e3", T2, p, "sub_1", "canceled");
    const off = await profile(p);
    expect(off.is_support_plus).toBe(false);
    expect(off.stripe_subscription_id).toBeNull();
  });

  it("cancel-at-period-end keeps access until the subscription actually ends", async () => {
    const p = await makePromoter(db);
    await sub("c1", T0, p, "sub_c", "active");
    await sub("c2", T1, p, "sub_c", "active", true);
    const mid = await profile(p);
    expect(mid.is_support_plus).toBe(true);
    expect(mid.support_plus_cancel_at_period_end).toBe(true);
    await sub("c3", T2, p, "sub_c", "canceled");
    expect((await profile(p)).is_support_plus).toBe(false);
  });

  it("stale (out-of-order) events are ignored; an old subscription's end can't revoke a newer one", async () => {
    const p = await makePromoter(db);
    await sub("o1", T0, p, "sub_old", "active");
    await sub("o2", T2, p, "sub_new", "active"); // re-subscribed
    await sub("o3", T1, p, "sub_old", "canceled"); // older + stale
    expect((await profile(p)).is_support_plus).toBe(true);
    expect((await profile(p)).stripe_subscription_id).toBe("sub_new");
    await sub("o4", "2026-10-02T00:00:00Z", p, "sub_old", "canceled"); // newer but for the OLD subscription
    expect((await profile(p)).is_support_plus).toBe(true);
  });

  it("only promoter accounts can hold Support+; a client can't write the entitlement", async () => {
    const a = await makeArtist(db);
    await expect(sub("x1", T0, a, "sub_a", "active")).rejects.toThrow(/not a promoter/);
    const p = await makePromoter(db);
    await expect(
      asUser(db, p, (tx) => tx.query(`update public.profiles set support_plus_status = 'active', is_support_plus = true where id = $1`, [p]))
    ).rejects.toThrow(/billing system/);
  });

  it("lapsed Support+ blocks adding to the roster but keeps existing data readable", async () => {
    const p = await makePromoter(db);
    const art = await makeArtist(db);
    await sub("r1", T0, p, "sub_r", "active");
    await asUser(db, p, (tx) => tx.query(`insert into public.artist_roster (promoter_id, artist_id) values ($1, $2)`, [p, art]));
    await sub("r2", T2, p, "sub_r", "canceled");
    const read = await asUser(db, p, (tx) => tx.query(`select 1 from public.artist_roster`));
    expect(read.rows).toHaveLength(1);
    const art2 = await makeArtist(db);
    await expect(
      asUser(db, p, (tx) => tx.query(`insert into public.artist_roster (promoter_id, artist_id) values ($1, $2)`, [p, art2]))
    ).rejects.toThrow(/row-level security/);
  });
});
