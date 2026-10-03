import { stripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";

// One Stripe Customer per promoter. The Customer is created with a stable
// idempotency key, so two simultaneous requests get the SAME customer back
// from Stripe instead of creating two; the private promoter_billing row is
// the only place the id is stored.
export async function getOrCreatePromoterCustomer(promoterId: string, email: string | undefined): Promise<string> {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("promoter_billing").select("stripe_customer_id").eq("promoter_id", promoterId).maybeSingle();
  if (existing?.stripe_customer_id) return existing.stripe_customer_id as string;

  const customer = await stripe.customers.create(
    { email, metadata: { promoter_id: promoterId } },
    { idempotencyKey: `customer:${promoterId}` }
  );
  const { error } = await admin
    .from("promoter_billing")
    .upsert({ promoter_id: promoterId, stripe_customer_id: customer.id }, { onConflict: "promoter_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  const { data: stored } = await admin.from("promoter_billing").select("stripe_customer_id").eq("promoter_id", promoterId).single();
  return (stored?.stripe_customer_id as string) ?? customer.id;
}
