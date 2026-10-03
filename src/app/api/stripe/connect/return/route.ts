import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTransfersActive } from "@/lib/stripe/connect";
import { siteOrigin } from "@/lib/server/origin";

// Stripe sends the artist back here after the hosted onboarding flow (finished
// or not). We ask Stripe for the account's real capability status and cache
// it. Requirements may still be outstanding — the dashboard shows the true
// state either way, and every payment re-checks with Stripe anyway.
export async function GET(request: Request) {
  const origin = siteOrigin(request);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let outcome = "unknown";
  if (user) {
    const admin = createAdminClient();
    const { data: account } = await admin.from("artist_payment_accounts").select("stripe_account_id").eq("artist_id", user.id).maybeSingle();
    if (account?.stripe_account_id) {
      try {
        const active = await fetchTransfersActive(account.stripe_account_id);
        await admin.from("artist_payment_accounts").update({ transfers_active: active, checked_at: new Date().toISOString() }).eq("artist_id", user.id);
        await admin.from("artists").update({ stripe_transfers_active: active }).eq("id", user.id);
        outcome = active ? "ready" : "pending";
      } catch (err) {
        console.error("connect return: couldn't read account status", err);
        outcome = "error";
      }
    }
  }
  return NextResponse.redirect(`${origin}/dashboard/artist?payouts=${outcome}`);
}
