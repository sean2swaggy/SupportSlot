import { stripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { json, limited, requireUser } from "@/lib/server/request";

// Deep-links an artist into their own Stripe Express dashboard, where their
// real payout schedule, bank details and payout history live. Nothing about
// payouts is mirrored in our database — Stripe is the source of truth.
export async function POST() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user } = auth;
  const limit = await limited(`connect-dash:${user.id}`, 10, 60);
  if (limit) return limit;

  const { data: account } = await createAdminClient()
    .from("artist_payment_accounts")
    .select("stripe_account_id, transfers_active")
    .eq("artist_id", user.id)
    .maybeSingle();
  if (!account?.stripe_account_id || !account.transfers_active) return json({ error: "Set up Stripe payouts first." }, 400);

  const loginLink = await stripe.accounts.createLoginLink(account.stripe_account_id);
  return json({ url: loginLink.url });
}
