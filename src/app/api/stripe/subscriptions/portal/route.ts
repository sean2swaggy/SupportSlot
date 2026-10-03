import { stripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { json, limited, requireUser } from "@/lib/server/request";
import { siteOrigin } from "@/lib/server/origin";

// Stripe's hosted Billing Portal: update the card, see invoices, cancel. A
// cancellation there reaches us through the subscription webhook, which is
// what actually changes is_support_plus — nothing flips locally from here.
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user } = auth;
  const limit = await limited(`portal:${user.id}`, 10, 60);
  if (limit) return limit;

  const { data: billing } = await createAdminClient().from("promoter_billing").select("stripe_customer_id").eq("promoter_id", user.id).maybeSingle();
  if (!billing?.stripe_customer_id) return json({ error: "No billing account found yet." }, 400);

  const session = await stripe.billingPortal.sessions.create({
    customer: billing.stripe_customer_id,
    return_url: `${siteOrigin(request)}/support-plus`,
  });
  return json({ url: session.url });
}
