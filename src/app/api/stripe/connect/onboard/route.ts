import { stripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { json, limited, requireUser } from "@/lib/server/request";
import { siteOrigin } from "@/lib/server/origin";
import { NextResponse } from "next/server";

// Creates (or reuses) the artist's Stripe Connect recipient account and
// returns a one-time hosted onboarding link. Artists only ever RECEIVE
// transfers (destination charges); they never take card payments themselves.
// The account id lives in the private artist_payment_accounts table, written
// only here, by the service role.
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;
  const limit = await limited(`connect:${user.id}`, 10, 60);
  if (limit) return limit;

  const { data: artist } = await supabase.from("artists").select("id").eq("id", user.id).maybeSingle();
  if (!artist) return json({ error: "Only artist accounts can set up payouts." }, 403);

  const admin = createAdminClient();
  const { data: existing } = await admin.from("artist_payment_accounts").select("stripe_account_id").eq("artist_id", user.id).maybeSingle();
  let accountId = existing?.stripe_account_id as string | undefined;

  if (!accountId) {
    const account = await stripe.v2.core.accounts.create(
      {
        contact_email: user.email,
        identity: { country: "GB" },
        dashboard: "express",
        defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
        configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
        include: ["configuration.recipient"],
      },
      { idempotencyKey: `connect-account:${user.id}` }
    );
    accountId = account.id;
    const { error } = await admin
      .from("artist_payment_accounts")
      .upsert({ artist_id: user.id, stripe_account_id: accountId }, { onConflict: "artist_id", ignoreDuplicates: true });
    if (error) {
      console.error("couldn't store connected account", error.message);
      return json({ error: "We couldn't start payout setup. Please try again." }, 500);
    }
  }

  const origin = siteOrigin(request);
  const accountLink = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["recipient"],
        return_url: `${origin}/api/stripe/connect/return`,
        refresh_url: `${origin}/api/stripe/connect/onboard`,
      },
    },
  });
  return json({ url: accountLink.url });
}

// Stripe's refresh_url lands here when a link expired or was already used:
// mint a fresh one and send them straight on.
export async function GET(request: Request) {
  const res = (await POST(request)) as Response;
  const body = await res.json().catch(() => ({}));
  if (body.url) return NextResponse.redirect(body.url);
  return NextResponse.redirect(`${siteOrigin(request)}/dashboard/artist?payouts=error`);
}
