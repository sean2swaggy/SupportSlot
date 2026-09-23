import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";

// Stripe sends the promoter here right after Checkout succeeds. Syncs
// is_support_plus immediately (good UX — no waiting on a webhook) by
// re-reading the Checkout Session directly from Stripe, not trusting
// anything in the URL; the subscription webhook is still the long-term
// authority for renewals/cancellations (see /api/stripe/webhooks).
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const sessionId = new URL(request.url).searchParams.get("session_id");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && sessionId) {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    const promoterId = session.metadata?.promoter_id;
    const billingPeriod = session.metadata?.billing_period;
    const subscription = session.subscription;

    if (
      promoterId === user.id &&
      session.mode === "subscription" &&
      session.payment_status === "paid" &&
      subscription &&
      typeof subscription !== "string"
    ) {
      const admin = createAdminClient();
      await admin
        .from("profiles")
        .update({
          is_support_plus: true,
          support_plus_billing_period: billingPeriod === "annual" ? "annual" : "monthly",
          stripe_subscription_id: subscription.id,
        })
        .eq("id", user.id);
    }
  }

  return NextResponse.redirect(`${origin}/support-plus`);
}
