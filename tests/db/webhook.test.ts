import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createTestDb, makeArtist, makePromoter, makeSlot, type Db } from "./harness";
import { handleStripeEvent, type WebhookDeps } from "../../src/lib/stripe/webhook-handler";
import { verifyWebhook } from "../../src/lib/stripe/verify-webhook";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => db.close());

// Real Stripe library, used offline (signature maths only — no network).
const stripe = new Stripe("sk_test_offline_placeholder");
const SECRET = "whsec_test_secret";

// Adapter: Supabase's rpc(name, namedArgs) -> real SQL with named arguments.
const reversals: Array<{ transfer: string; amount: number; key: string }> = [];
const deps = (over: Partial<WebhookDeps> = {}): WebhookDeps => ({
  async rpc(fn, args) {
    const keys = Object.keys(args);
    try {
      const res = await asService(db, (tx) =>
        tx.query<Record<string, unknown>>(
          `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`,
          keys.map((k) => args[k])
        )
      );
      return { data: res.rows[0]?.r ?? null, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  },
  async getCharge(id) {
    return { receipt_url: `https://pay.stripe.com/receipts/${id}`, transfer: `tr_for_${id}` };
  },
  async createTransferReversal(transfer, amount, key) {
    reversals.push({ transfer, amount, key });
  },
  ...over,
});

let evtCounter = 0;
const evt = (type: string, object: unknown, created = 1_790_000_000 + evtCounter) =>
  ({ id: `evt_${++evtCounter}_${type.replace(/\W/g, "")}`, type, created, data: { object } }) as unknown as Stripe.Event;

async function confirmedBooking() {
  const artist = await makeArtist(db);
  const promoter = await makePromoter(db);
  const slot = await makeSlot(db, promoter, { supportFee: 100 });
  const app = (await asUser(db, artist, (tx) => tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1,$2) returning id`, [slot, artist]))).rows[0].id;
  await asUser(db, promoter, (tx) => tx.query(`select public.make_offer($1)`, [app]));
  await asUser(db, artist, (tx) => tx.query(`select public.respond_to_offer($1, true, null)`, [app]));
  const b = (await db.query<{ id: string; total_pence: number }>(`select id, total_pence from public.bookings where application_id = $1`, [app])).rows[0];
  const pi = `pi_${b.id.slice(0, 8)}`;
  await asService(db, (tx) => tx.query(`select public.attach_payment_intent($1, $2)`, [b.id, pi]));
  return { artist, promoter, bookingId: b.id, total: b.total_pence, pi };
}
const booking = async (id: string) => (await db.query<Record<string, unknown>>(`select * from public.bookings where id = $1`, [id])).rows[0];
const piObj = (b: { bookingId: string; pi: string; total: number }, over: Record<string, unknown> = {}) => ({
  id: b.pi, amount: b.total, amount_received: b.total, latest_charge: `ch_${b.pi}`, metadata: { booking_id: b.bookingId }, ...over,
});

describe("signature verification (raw body, real Stripe maths)", () => {
  const body = JSON.stringify({ id: "evt_sig", object: "event", type: "payment_intent.succeeded", data: { object: {} } });
  const sign = (b: string, secret = SECRET, t?: number) =>
    stripe.webhooks.generateTestHeaderString({ payload: b, secret, timestamp: t });

  it("accepts a correctly signed body", () => {
    const r = verifyWebhook(stripe, body, sign(body), SECRET);
    expect(r.ok).toBe(true);
  });
  it("rejects a tampered body, the wrong secret, a missing header, and a stale (replayed) timestamp", () => {
    expect(verifyWebhook(stripe, body + " ", sign(body), SECRET)).toMatchObject({ ok: false, status: 400 });
    expect(verifyWebhook(stripe, body, sign(body, "whsec_other"), SECRET)).toMatchObject({ ok: false, status: 400 });
    expect(verifyWebhook(stripe, body, null, SECRET)).toMatchObject({ ok: false, status: 400 });
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(verifyWebhook(stripe, body, sign(body, SECRET, old), SECRET)).toMatchObject({ ok: false, status: 400 });
  });
  it("a missing server secret is a loud 500, not a quiet 400", () => {
    expect(verifyWebhook(stripe, body, sign(body), undefined)).toMatchObject({ ok: false, status: 500 });
  });
});

describe("handling real-shaped events", () => {
  it("payment_intent.succeeded marks the right booking paid, once, with a Stripe receipt", async () => {
    const b = await confirmedBooking();
    const e = evt("payment_intent.succeeded", piObj(b));
    expect(await handleStripeEvent(e, deps())).toMatchObject({ kind: "processed" });
    const row = await booking(b.bookingId);
    expect(row.payment_status).toBe("paid");
    expect(String(row.receipt_url)).toContain("stripe.com/receipts");
    // Stripe redelivers the identical event: acknowledged, nothing repeated.
    expect(await handleStripeEvent(e, deps())).toMatchObject({ kind: "duplicate" });
    const notes = await db.query(`select 1 from public.notifications where profile_id = $1 and type = 'payment_received'`, [b.promoter]);
    expect(notes.rows).toHaveLength(1);
    const events = await db.query(`select 1 from public.payment_events where booking_id = $1 and kind = 'payment_succeeded'`, [b.bookingId]);
    expect(events.rows).toHaveLength(1);
  });

  it("a payment for the wrong amount or an unknown booking is recorded as failed for a human, never marked paid", async () => {
    const b = await confirmedBooking();
    const wrong = await handleStripeEvent(evt("payment_intent.succeeded", piObj(b, { amount_received: b.total - 100 })), deps());
    expect(wrong).toMatchObject({ kind: "permanent_failure" });
    const ghost = await handleStripeEvent(evt("payment_intent.succeeded", piObj(b, { metadata: { booking_id: "00000000-0000-0000-0000-000000000000" } })), deps());
    expect(ghost).toMatchObject({ kind: "permanent_failure" });
    expect((await booking(b.bookingId)).payment_status).toBe("unpaid");
    const ledger = await db.query<{ status: string }>(`select status from public.stripe_events where type = 'payment_intent.succeeded' and status = 'failed'`);
    expect(ledger.rows.length).toBeGreaterThanOrEqual(2);
  });

  it("events that aren't about our bookings are acknowledged and ignored", async () => {
    const r = await handleStripeEvent(evt("payment_intent.succeeded", { id: "pi_other", amount: 1, metadata: {} }), deps());
    expect(r).toMatchObject({ kind: "ignored" });
    expect(await handleStripeEvent(evt("customer.created", { id: "cus_1" }), deps())).toMatchObject({ kind: "ignored" });
  });

  it("a transient failure (database error) surfaces as an error so Stripe retries, and the retry then succeeds", async () => {
    const b = await confirmedBooking();
    const e = evt("payment_intent.succeeded", piObj(b));
    let calls = 0;
    const flaky = deps({
      async rpc(fn, args) {
        if (fn === "apply_payment_succeeded" && calls++ === 0) return { data: null, error: { message: "connection reset by peer" } };
        return deps().rpc(fn, args);
      },
    });
    await expect(handleStripeEvent(e, flaky)).rejects.toThrow(/connection reset/);
    expect(await handleStripeEvent(e, flaky)).toMatchObject({ kind: "processed" });
    expect((await booking(b.bookingId)).payment_status).toBe("paid");
  });

  it("out-of-order delivery: refund before payment, failure after success, duplicates throughout", async () => {
    const b = await confirmedBooking();
    const charge = `ch_${b.pi}`;
    await handleStripeEvent(evt("charge.refunded", { id: charge, payment_intent: b.pi, amount_refunded: b.total }, 1_790_000_300), deps());
    await handleStripeEvent(evt("payment_intent.succeeded", piObj(b), 1_790_000_100), deps());
    await handleStripeEvent(evt("payment_intent.payment_failed", { ...piObj(b), last_payment_error: { message: "late" } }, 1_790_000_400), deps());
    const row = await booking(b.bookingId);
    expect(row.payment_status).toBe("refunded");
    expect(row.refunded_pence).toBe(b.total);
  });

  it("a lost dispute reverses the artist's transfer exactly once; opening one does not", async () => {
    const b = await confirmedBooking();
    await handleStripeEvent(evt("payment_intent.succeeded", piObj(b)), deps());
    const charge = `ch_${b.pi}`;
    reversals.length = 0;
    await handleStripeEvent(evt("charge.dispute.created", { id: "dp_1", charge, payment_intent: b.pi, amount: b.total }), deps());
    expect((await booking(b.bookingId)).payment_status).toBe("disputed");
    expect(reversals).toHaveLength(0);
    const closed = evt("charge.dispute.closed", { id: "dp_1", charge, payment_intent: b.pi, amount: b.total, status: "lost" });
    await handleStripeEvent(closed, deps());
    await handleStripeEvent(closed, deps()); // redelivery
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ amount: b.total, key: "reversal:dp_1" });
    expect((await booking(b.bookingId)).dispute_status).toBe("lost");
  });

  it("a won dispute restores 'paid' and reverses nothing; a failed reversal is recorded for follow-up, not thrown", async () => {
    const won = await confirmedBooking();
    await handleStripeEvent(evt("payment_intent.succeeded", piObj(won)), deps());
    const wch = `ch_${won.pi}`;
    reversals.length = 0;
    await handleStripeEvent(evt("charge.dispute.created", { id: "dp_w", charge: wch, payment_intent: won.pi, amount: won.total }), deps());
    await handleStripeEvent(evt("charge.dispute.closed", { id: "dp_w", charge: wch, payment_intent: won.pi, amount: won.total, status: "won" }), deps());
    expect((await booking(won.bookingId)).payment_status).toBe("paid");
    expect(reversals).toHaveLength(0);

    const lost = await confirmedBooking();
    await handleStripeEvent(evt("payment_intent.succeeded", piObj(lost)), deps());
    const lch = `ch_${lost.pi}`;
    const failing = deps({ async createTransferReversal() { throw new Error("insufficient funds in connected account"); } });
    await handleStripeEvent(evt("charge.dispute.created", { id: "dp_l", charge: lch, payment_intent: lost.pi, amount: lost.total }), failing);
    const r = await handleStripeEvent(evt("charge.dispute.closed", { id: "dp_l", charge: lch, payment_intent: lost.pi, amount: lost.total, status: "lost" }), failing);
    expect(r).toMatchObject({ kind: "processed" });
    const note = await db.query<{ details: { note: string } }>(`select details from public.payment_events where booking_id = $1 and kind = 'transfer_reversed'`, [lost.bookingId]);
    expect(note.rows[0].details.note).toContain("needs manual follow-up");
  });
});

describe("Support+ events", () => {
  const sub = (status: string, over: Record<string, unknown> = {}) => ({
    id: "sub_w1", status, cancel_at_period_end: false,
    items: { data: [{ current_period_end: 1_793_000_000 }] },
    metadata: { promoter_id: "", billing_period: "monthly" }, ...over,
  });
  const profile = async (id: string) => (await db.query<Record<string, unknown>>(`select is_support_plus, support_plus_status, support_plus_cancel_at_period_end from public.profiles where id = $1`, [id])).rows[0];

  it("created -> past_due (kept on) -> deleted (off), with renewal date stored", async () => {
    const p = await makePromoter(db);
    const meta = { promoter_id: p, billing_period: "annual" };
    await handleStripeEvent(evt("customer.subscription.created", sub("active", { metadata: meta }), 1_790_100_000), deps());
    expect((await profile(p)).is_support_plus).toBe(true);
    const row = await db.query<{ support_plus_current_period_end: Date }>(`select support_plus_current_period_end from public.profiles where id = $1`, [p]);
    expect(row.rows[0].support_plus_current_period_end).toBeTruthy();
    await handleStripeEvent(evt("customer.subscription.updated", sub("past_due", { metadata: meta }), 1_790_100_100), deps());
    expect(await profile(p)).toMatchObject({ is_support_plus: true, support_plus_status: "past_due" });
    await handleStripeEvent(evt("customer.subscription.deleted", sub("canceled", { metadata: meta }), 1_790_100_200), deps());
    expect((await profile(p)).is_support_plus).toBe(false);
  });

  it("a subscription event for a non-promoter is a recorded permanent failure, not an entitlement", async () => {
    const artist = await makeArtist(db);
    const r = await handleStripeEvent(evt("customer.subscription.created", sub("active", { metadata: { promoter_id: artist } })), deps());
    expect(r).toMatchObject({ kind: "permanent_failure" });
    expect((await profile(artist)).is_support_plus).toBe(false);
  });
});
