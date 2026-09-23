import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/server";

// Real cancel/manage flow — Stripe's own hosted Billing Portal, not a fake
// "cancel" button that just flips a local flag. Cancellations here reach us
// through the subscription webhook, which is what actually turns
// is_support_plus off (see /api/stripe/webhooks).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: promoter } = await supabase
    .from("promoters")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!promoter?.stripe_customer_id) {
    return NextResponse.json({ error: "No billing account found yet." }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const session = await stripe.billingPortal.sessions.create({
    customer: promoter.stripe_customer_id,
    return_url: `${origin}/support-plus`,
  });

  return NextResponse.json({ url: session.url });
}
