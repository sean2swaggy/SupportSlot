import type Stripe from "stripe";

// What a Stripe webhook delivery actually does. The route (src/app/api/
// stripe/webhooks/route.ts) verifies the signature against the RAW body, then
// calls this. All state changes happen in SQL functions (0022) that are
// idempotent and refuse to move a payment backwards, so a duplicated,
// delayed or reordered delivery is safe.
//
// Dependencies are injected so tests can run this exact code against the real
// SQL functions (in-process Postgres) with hand-built Stripe events — no
// network, no Stripe account.

export interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

export interface WebhookDeps {
  rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  getCharge(chargeId: string): Promise<{ receipt_url: string | null; transfer: string | null }>;
  createTransferReversal(transferId: string, amountPence: number, idempotencyKey: string): Promise<void>;
  log?(message: string, context?: unknown): void;
}

export type WebhookOutcome =
  | { kind: "processed"; type: string }
  | { kind: "duplicate"; type: string }
  | { kind: "ignored"; type: string }
  | { kind: "in_progress"; type: string }
  // Something we can never fix by retrying (an unmatched or mismatched
  // payment). Recorded as failed for a human to look at; Stripe is told 200
  // so it stops redelivering.
  | { kind: "permanent_failure"; type: string; error: string };

const PERMANENT = /payment_unmatched|amount_mismatch|subscription_unmatched|booking_not_found|bad_phase/;

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const idOf = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === "string" ? v : v?.id ?? null;

async function call(deps: WebhookDeps, fn: string, args: Record<string, unknown>) {
  const { data, error } = await deps.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function handleStripeEvent(event: Stripe.Event, deps: WebhookDeps): Promise<WebhookOutcome> {
  const type = event.type;
  const begin = (await call(deps, "begin_stripe_event", { p_id: event.id, p_type: type })) as string;
  if (begin === "duplicate") return { kind: "duplicate", type };
  if (begin === "in_progress") return { kind: "in_progress", type };

  try {
    const handled = await dispatch(event, deps);
    await call(deps, "finish_stripe_event", { p_id: event.id, p_error: null });
    return handled ? { kind: "processed", type } : { kind: "ignored", type };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await call(deps, "finish_stripe_event", { p_id: event.id, p_error: message.slice(0, 500) }).catch(() => undefined);
    if (PERMANENT.test(message)) {
      deps.log?.(`Stripe event ${event.id} (${type}) can't be applied: ${message}`);
      return { kind: "permanent_failure", type, error: message };
    }
    throw err; // transient: let the route answer 500 so Stripe retries
  }
}

async function dispatch(event: Stripe.Event, deps: WebhookDeps): Promise<boolean> {
  const occurred = iso(event.created);

  switch (event.type) {
    case "payment_intent.processing": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const bookingId = pi.metadata?.booking_id;
      if (!bookingId) return false;
      await call(deps, "apply_payment_processing", {
        p_event_id: event.id, p_occurred: occurred, p_payment_intent_id: pi.id, p_booking_id: bookingId,
      });
      return true;
    }

    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const bookingId = pi.metadata?.booking_id;
      if (!bookingId) return false; // not one of our booking payments
      const chargeId = idOf(pi.latest_charge as string | { id: string } | null);
      let receipt: string | null = null;
      if (chargeId) {
        try {
          receipt = (await deps.getCharge(chargeId)).receipt_url;
        } catch {
          receipt = null; // a missing receipt link must never block recording the payment
        }
      }
      await call(deps, "apply_payment_succeeded", {
        p_event_id: event.id, p_occurred: occurred, p_payment_intent_id: pi.id, p_booking_id: bookingId,
        p_amount_pence: pi.amount_received || pi.amount, p_charge_id: chargeId, p_receipt_url: receipt,
      });
      return true;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const bookingId = pi.metadata?.booking_id;
      if (!bookingId) return false;
      await call(deps, "apply_payment_failed", {
        p_event_id: event.id, p_occurred: occurred, p_payment_intent_id: pi.id, p_booking_id: bookingId,
        p_reason: pi.last_payment_error?.message ?? pi.last_payment_error?.code ?? "payment failed",
      });
      return true;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      await call(deps, "apply_refund", {
        p_event_id: event.id, p_occurred: occurred, p_payment_intent_id: idOf(charge.payment_intent as string | null) ?? "",
        p_charge_id: charge.id, p_refunded_total: charge.amount_refunded,
      });
      return true;
    }

    case "charge.dispute.created": {
      const d = event.data.object as Stripe.Dispute;
      await call(deps, "apply_dispute", {
        p_event_id: event.id, p_occurred: occurred, p_payment_intent_id: idOf(d.payment_intent as string | null) ?? "",
        p_charge_id: idOf(d.charge as string | { id: string }), p_phase: "opened", p_amount_pence: d.amount,
      });
      return true;
    }

    case "charge.dispute.closed": {
      const d = event.data.object as Stripe.Dispute;
      const won = d.status === "won" || d.status === "warning_closed";
      const lost = d.status === "lost";
      if (!won && !lost) return false;
      const chargeId = idOf(d.charge as string | { id: string });
      const piId = idOf(d.payment_intent as string | null) ?? "";
      await call(deps, "apply_dispute", {
        p_event_id: event.id, p_occurred: occurred, p_payment_intent_id: piId,
        p_charge_id: chargeId, p_phase: won ? "won" : "lost", p_amount_pence: d.amount,
      });
      if (lost && chargeId) {
        // For a destination charge Stripe takes the money from the PLATFORM
        // balance. Only once the dispute is actually lost do we claw back the
        // artist's transfer (doing it when a dispute merely opens would take
        // money from an artist who may well be vindicated).
        const charge = await deps.getCharge(chargeId);
        const bookingId = (await call(deps, "booking_for_payment", { p_payment_intent_id: piId, p_charge_id: chargeId })) as string | null;
        if (charge.transfer && bookingId) {
          try {
            await deps.createTransferReversal(charge.transfer, d.amount, `reversal:${d.id}`);
            await call(deps, "record_transfer_reversal", {
              p_key: `reversal:${d.id}`, p_booking_id: bookingId, p_amount_pence: d.amount, p_note: "dispute lost",
            });
          } catch (err) {
            // Most likely the artist's connected balance can't cover it. Left
            // for a human; never fail the whole webhook over it.
            deps.log?.(`Transfer reversal failed for dispute ${d.id}`, err);
            await call(deps, "record_transfer_reversal", {
              p_key: `reversal_failed:${d.id}`, p_booking_id: bookingId, p_amount_pence: 0,
              p_note: `reversal failed — needs manual follow-up: ${err instanceof Error ? err.message : err}`,
            });
          }
        }
      }
      return true;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const promoterId = sub.metadata?.promoter_id;
      if (!promoterId) return false;
      // Newer API versions moved the period end onto the subscription item.
      const periodEnd =
        (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end ??
        (sub as unknown as { current_period_end?: number }).current_period_end;
      await call(deps, "apply_subscription_state", {
        p_event_id: event.id, p_occurred: occurred, p_promoter_id: promoterId, p_subscription_id: sub.id,
        p_status: event.type === "customer.subscription.deleted" ? "canceled" : sub.status,
        p_period_end: periodEnd ? iso(periodEnd) : null,
        p_cancel_at_period_end: sub.cancel_at_period_end ?? false,
        p_billing_period: sub.metadata?.billing_period ?? null,
      });
      return true;
    }

    default:
      return false;
  }
}
