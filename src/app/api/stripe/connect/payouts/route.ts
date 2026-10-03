import { stripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { json, requireUser } from "@/lib/server/request";

// The artist's recent bank payouts, read live from Stripe (not stored by us):
// status is Stripe's own — pending / in_transit / paid / failed / canceled.
// Payouts batch many transfers, so they're shown for the account, never
// attached to a single booking.
export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { data: account } = await createAdminClient()
    .from("artist_payment_accounts")
    .select("stripe_account_id, transfers_active")
    .eq("artist_id", auth.user.id)
    .maybeSingle();
  if (!account?.stripe_account_id || !account.transfers_active) return json({ payouts: [] });
  try {
    const list = await stripe.payouts.list({ limit: 5 }, { stripeAccount: account.stripe_account_id });
    return json({
      payouts: list.data.map((p) => ({
        id: p.id,
        amountPence: p.amount,
        currency: p.currency,
        status: p.status,
        arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
        failureMessage: p.failure_message ?? null,
      })),
    });
  } catch (err) {
    console.error("couldn't list payouts", err);
    return json({ error: "We couldn't load your payouts from Stripe right now." }, 502);
  }
}
