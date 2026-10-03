import { stripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { json, limited, requireUser } from "@/lib/server/request";

// Permanently deletes the signed-in account. Refuses while there's an
// upcoming confirmed booking or an unresolved payment (those need settling
// first). Everything still in flight is wound down, an active Support+
// subscription is cancelled with Stripe, and the account's personal data is
// removed. Booking and payment records are KEPT — financial records have to
// be — but the account link is cut: they keep only the names snapshotted at
// the time. Needs the typed confirmation "DELETE"; the middleware has
// already required a fully verified (2FA) session to reach this.
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user } = auth;
  const limit = await limited(`delete-account:${user.id}`, 3, 3600);
  if (limit) return limit;

  const body = (await request.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "DELETE") return json({ error: 'Type DELETE to confirm.' }, 400);

  const admin = createAdminClient();
  const { data: blockers, error: blockError } = await admin.rpc("account_deletion_blockers", { p_profile_id: user.id });
  if (blockError) return json({ error: "We couldn't check whether your account can be deleted. Please try again." }, 500);
  if ((blockers as string[]).length > 0) {
    return json({
      error: "Your account can't be deleted yet.",
      blockers,
      detail: "You have an upcoming confirmed booking, or a payment that's still being resolved. Cancel the booking or wait for the payment to settle, then try again.",
    }, 409);
  }

  // Stop the billing first, while we still know which customer it is.
  const { data: billing } = await admin.from("promoter_billing").select("stripe_customer_id").eq("promoter_id", user.id).maybeSingle();
  if (billing?.stripe_customer_id) {
    try {
      const subs = await stripe.subscriptions.list({ customer: billing.stripe_customer_id, status: "all", limit: 10 });
      for (const s of subs.data.filter((x) => ["active", "trialing", "past_due", "unpaid"].includes(x.status))) {
        await stripe.subscriptions.cancel(s.id);
      }
    } catch (err) {
      console.error("couldn't cancel subscription during account deletion", err);
      return json({ error: "We couldn't cancel your Support+ subscription, so your account has not been deleted. Please try again or contact support." }, 502);
    }
  }

  const { error: prepError } = await admin.rpc("prepare_account_deletion", { p_profile_id: user.id });
  if (prepError) return json({ error: "We couldn't wind down your account's activity. Nothing was deleted — please try again." }, 500);

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("auth deleteUser failed", deleteError.message);
    return json({ error: "We couldn't finish deleting your account. Please contact support." }, 500);
  }
  return json({ ok: true });
}
