import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isActiveSubscriptionStatus } from "@/lib/availability";
import type Stripe from "stripe";

// Always verify the signature before trusting anything in the body — this
// is what actually proves a request came from Stripe, not just anyone who
// found the URL. Uses the service-role client throughout since there's no
// end-user session in a webhook request.
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const body = await request.text();

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature or webhook secret." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return NextResponse.json(
      { error: `Signature verification failed: ${err instanceof Error ? err.message : err}` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  switch (event.type) {
    // Safety net in case the client never called /api/stripe/payments/confirm
    // (e.g. they closed the tab right after paying) — same idempotent
    // "flip to booked" as that route.
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const applicationId = pi.metadata?.application_id;
      if (applicationId) {
        await admin.from("applications").update({ status: "booked" }).eq("id", applicationId);
      }
      break;
    }

    // The critical dispute-recovery step the Connect plan (Section K)
    // flagged: for destination charges, Stripe debits OUR balance first.
    // Nothing reverses the transfer to the artist automatically — we have
    // to do it, or Support Slot silently eats the loss while the artist
    // keeps the funds.
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const charge = await stripe.charges.retrieve(dispute.charge as string);
      const transferId =
        typeof charge.transfer === "string" ? charge.transfer : charge.transfer?.id;
      if (transferId) {
        try {
          await stripe.transfers.createReversal(transferId, { amount: dispute.amount });
        } catch (err) {
          // Most likely cause: the artist's connected account balance is
          // insufficient to reverse — this creates a negative balance on
          // their account instead (which losses_collector: "application"
          // is specifically configured to allow). Log for manual follow-up
          // either way; don't fail the webhook response over it.
          console.error("Transfer reversal failed for dispute", dispute.id, err);
        }
      }
      break;
    }

    // NOTE: keeping stripe_transfers_active in sync on an ongoing basis
    // (not just right after onboarding, e.g. if Stripe later restricts an
    // account) needs the V2 Core "thin events" system
    // (v2.core.account.updated), which is a different mechanism from the
    // V1 webhooks handled here (separate Event Destination registration,
    // separate verification method) — not wired up yet. For now,
    // /api/stripe/connect/return.ts syncs this once, right after
    // onboarding completes.

    // Support+ subscription lifecycle — the long-term authority for
    // is_support_plus (the checkout return route only handles the initial
    // "just paid" moment for fast UX; this handles renewals, cancellations,
    // and payment failures for as long as the subscription exists).
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const promoterId = sub.metadata?.promoter_id;
      if (promoterId) {
        const active = isActiveSubscriptionStatus(sub.status);
        await admin
          .from("profiles")
          .update({
            is_support_plus: active,
            stripe_subscription_id: active ? sub.id : null,
          })
          .eq("id", promoterId);
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
