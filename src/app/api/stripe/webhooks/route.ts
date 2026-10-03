import { stripe } from "@/lib/stripe/server";
import { verifyWebhook } from "@/lib/stripe/verify-webhook";
import { handleStripeEvent } from "@/lib/stripe/webhook-handler";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// Stripe -> us. The signature is checked against the RAW body first; only then
// is anything read from it. State changes are idempotent SQL functions (0022)
// and each event id is recorded once, so retries, duplicates and reordering
// are safe. 2xx tells Stripe "got it"; a 5xx makes Stripe retry.
export async function POST(request: Request) {
  const raw = await request.text();
  const verified = verifyWebhook(stripe, raw, request.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET);
  if (!verified.ok) {
    if (verified.status === 500) console.error(verified.error);
    return NextResponse.json({ error: verified.error }, { status: verified.status });
  }

  const admin = createAdminClient();
  try {
    const outcome = await handleStripeEvent(verified.event, {
      rpc: async (fn, args) => {
        const { data, error } = await admin.rpc(fn, args);
        return { data, error };
      },
      getCharge: async (id) => {
        const charge = await stripe.charges.retrieve(id);
        return { receipt_url: charge.receipt_url ?? null, transfer: typeof charge.transfer === "string" ? charge.transfer : charge.transfer?.id ?? null };
      },
      createTransferReversal: async (transferId, amount, key) => {
        await stripe.transfers.createReversal(transferId, { amount }, { idempotencyKey: key });
      },
      log: (message, context) => console.error(message, context ?? ""),
    });
    // Another delivery of this same event is mid-flight: ask Stripe to retry.
    if (outcome.kind === "in_progress") return NextResponse.json({ received: false, retry: true }, { status: 409 });
    return NextResponse.json({ received: true, outcome: outcome.kind });
  } catch (err) {
    console.error(`Webhook ${verified.event.id} (${verified.event.type}) failed; Stripe will retry`, err);
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}
