import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";
import { siteOrigin } from "@/lib/server/origin";

// Stripe sends the promoter here right after Checkout. For a fast first
// impression it reads the Checkout Session and subscription straight from
// Stripe (never trusting anything in the URL beyond the session id) and
// applies them through the same SQL function the webhook uses — which ignores
// anything older than what the webhook has already recorded. The webhook
// stays the long-term authority for renewals, failures and cancellation.
export async function GET(request: Request) {
  const origin = siteOrigin(request);
  const sessionId = new URL(request.url).searchParams.get("session_id");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let outcome = "pending";
  if (user && sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
      const sub = session.subscription;
      if (
        session.metadata?.promoter_id === user.id &&
        session.mode === "subscription" &&
        session.status === "complete" &&
        sub &&
        typeof sub !== "string"
      ) {
        const periodEnd =
          (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end ??
          (sub as unknown as { current_period_end?: number }).current_period_end;
        const { error } = await createAdminClient().rpc("apply_subscription_state", {
          p_event_id: `checkout:${session.id}`,
          p_occurred: new Date(session.created * 1000).toISOString(),
          p_promoter_id: user.id,
          p_subscription_id: sub.id,
          p_status: sub.status,
          p_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          p_cancel_at_period_end: sub.cancel_at_period_end ?? false,
          p_billing_period: session.metadata?.billing_period ?? null,
        });
        outcome = error ? "error" : "success";
        if (error) console.error("checkout return: apply_subscription_state failed", error.message);
      }
    } catch (err) {
      console.error("checkout return: couldn't read the session", err);
      outcome = "error";
    }
  }
  return NextResponse.redirect(`${origin}/support-plus?checkout=${outcome}`);
}
