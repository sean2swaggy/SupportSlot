import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/server";
import { toPence } from "@/lib/stripe/fees";
import { SUPPORT_PLUS_ANNUAL_PRICE, SUPPORT_PLUS_MONTHLY_PRICE } from "@/lib/pricing";

// Support+ is a promoter-only subscription (see 0010_promoter_support_plus.sql).
// Built with inline price_data rather than a pre-created Stripe Price, so
// there's no live Product/Price object to manage or accidentally modify —
// the existing £7.99/mo, £89.99/yr amounts in lib/pricing.ts stay the
// single source of truth on both the marketing page and here.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "promoter") {
    return NextResponse.json({ error: "Support+ is only available for promoter accounts." }, { status: 403 });
  }

  const { period } = await request.json();
  if (period !== "monthly" && period !== "annual") {
    return NextResponse.json({ error: "Invalid billing period." }, { status: 400 });
  }

  const { data: promoter } = await supabase
    .from("promoters")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  let customerId = promoter?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email });
    customerId = customer.id;
    await supabase.from("promoters").update({ stripe_customer_id: customerId }).eq("id", user.id);
  }

  const unitAmount = toPence(period === "annual" ? SUPPORT_PLUS_ANNUAL_PRICE : SUPPORT_PLUS_MONTHLY_PRICE);
  const origin = new URL(request.url).origin;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    // This account has Stripe's newer Managed Payments (merchant-of-record)
    // product on by default, which requires a product tax_code on every
    // inline price_data line item. Not relevant to this app's architecture
    // (direct Stripe account, Connect destination charges elsewhere) — opt
    // this session out rather than inventing a tax code for a subscription
    // price that was built from price_data, not a real Product.
    managed_payments: { enabled: false },
    line_items: [
      {
        price_data: {
          currency: "gbp",
          product_data: { name: "Support+ (promoter)" },
          unit_amount: unitAmount,
          recurring: { interval: period === "annual" ? "year" : "month" },
        },
        quantity: 1,
      },
    ],
    metadata: { promoter_id: user.id, billing_period: period },
    subscription_data: { metadata: { promoter_id: user.id, billing_period: period } },
    success_url: `${origin}/api/stripe/subscriptions/return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/support-plus`,
  });

  return NextResponse.json({ url: session.url });
}
