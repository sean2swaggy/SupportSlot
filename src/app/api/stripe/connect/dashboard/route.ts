import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/server";

// Deep-links a verified artist straight into their own Stripe Express
// dashboard — where their real payout schedule, bank details, and payout
// history actually live. We don't mirror any of that in our own database;
// Stripe already has it, this just hands them a one-time link to see it.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: artist } = await supabase
    .from("artists")
    .select("stripe_account_id, stripe_transfers_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!artist?.stripe_account_id || !artist.stripe_transfers_active) {
    return NextResponse.json({ error: "Set up Stripe payouts first." }, { status: 400 });
  }

  const loginLink = await stripe.accounts.createLoginLink(artist.stripe_account_id);
  return NextResponse.json({ url: loginLink.url });
}
