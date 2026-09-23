import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/server";

// Creates (or reuses) the artist's Stripe Connect recipient account and
// returns a one-time hosted onboarding link. Recipient configuration per
// the Connect plan: dashboard=express, fees_collector=application,
// losses_collector=application, destination charges — see
// connect-recommend-plan discussion. Artists never get merchant/card_payments
// capability; they only receive transfers, never take payments directly.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: artist } = await supabase
    .from("artists")
    .select("id, stripe_account_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!artist) {
    return NextResponse.json({ error: "No artist profile found." }, { status: 404 });
  }

  let accountId = artist.stripe_account_id;

  if (!accountId) {
    const account = await stripe.v2.core.accounts.create({
      contact_email: user.email,
      identity: { country: "GB" },
      dashboard: "express",
      defaults: {
        responsibilities: { fees_collector: "application", losses_collector: "application" },
      },
      configuration: {
        recipient: {
          capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
        },
      },
      include: ["configuration.recipient"],
    });
    accountId = account.id;
    await supabase.from("artists").update({ stripe_account_id: accountId }).eq("id", user.id);
  }

  const origin = new URL(request.url).origin;
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

  return NextResponse.json({ url: accountLink.url });
}

// A GET here means Stripe's refresh_url sent the artist back because their
// previous link expired or was already used — just re-run the same logic
// and redirect straight to the new hosted link instead of making them click
// "set up payouts" again.
export async function GET(request: Request) {
  const result = await POST(request);
  const body = await result.json();
  if (body.url) {
    return NextResponse.redirect(body.url);
  }
  const origin = new URL(request.url).origin;
  return NextResponse.redirect(`${origin}/dashboard/artist`);
}
