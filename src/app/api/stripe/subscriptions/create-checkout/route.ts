import { stripe } from "@/lib/stripe/server";
import { toPence } from "@/lib/stripe/fees";
import { getOrCreatePromoterCustomer } from "@/lib/stripe/customers";
import { SUPPORT_PLUS_ANNUAL_PRICE, SUPPORT_PLUS_MONTHLY_PRICE } from "@/lib/pricing";
import { json, limited, requireUser } from "@/lib/server/request";
import { siteOrigin } from "@/lib/server/origin";

// Support+ is a promoter-only subscription (see 0010/0022 migrations). Prices
// come from lib/pricing.ts — the single source of truth the pricing page also
// reads — never from the request. Built with inline price_data so there's no
// Stripe Price object to drift out of sync with those constants.
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;
  const limit = await limited(`checkout:${user.id}`, 6, 60);
  if (limit) return limit;

  const { data: profile } = await supabase.from("profiles").select("role, is_support_plus, support_plus_status").eq("id", user.id).maybeSingle();
  if (profile?.role !== "promoter") {
    return json({ error: "Support+ is only available for promoter accounts." }, 403);
  }
  if (profile.is_support_plus) {
    return json(
      {
        error:
          profile.support_plus_status === "past_due"
            ? "Your last Support+ payment failed. Update your payment method in billing instead of starting a new subscription."
            : "You already have an active Support+ subscription.",
      },
      409
    );
  }

  const { period } = await request.json().catch(() => ({ period: null }));
  if (period !== "monthly" && period !== "annual") return json({ error: "Invalid billing period." }, 400);

  const customerId = await getOrCreatePromoterCustomer(user.id, user.email);

  // Stripe is the source of truth for "already subscribed" — our own flag can
  // lag a webhook. A second concurrent subscription would bill twice.
  const existing = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  if (existing.data.some((s) => ["active", "trialing", "past_due", "unpaid"].includes(s.status))) {
    return json({ error: "You already have a Support+ subscription. Use 'Manage billing' to change it." }, 409);
  }

  const unitAmount = toPence(period === "annual" ? SUPPORT_PLUS_ANNUAL_PRICE : SUPPORT_PLUS_MONTHLY_PRICE);
  const origin = siteOrigin(request);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    // This Stripe account has Managed Payments (merchant-of-record) on by
    // default, which needs a product tax_code on inline price_data. Not how
    // this app is set up (direct account + Connect), so opt this session out.
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

  return json({ url: session.url });
}
