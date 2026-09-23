import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/server";

// Stripe sends the artist here after they finish (or partially finish) the
// hosted onboarding flow. Requirements can still be outstanding at this
// point — this just syncs current capability status; account.updated
// webhooks (once wired up) keep it in sync going forward too.
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: artist } = await supabase
      .from("artists")
      .select("stripe_account_id")
      .eq("id", user.id)
      .maybeSingle();

    if (artist?.stripe_account_id) {
      const account = await stripe.v2.core.accounts.retrieve(artist.stripe_account_id, {
        include: ["configuration.recipient"],
      });
      const active =
        account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers
          ?.status === "active";
      await supabase
        .from("artists")
        .update({ stripe_transfers_active: active })
        .eq("id", user.id);
    }
  }

  return NextResponse.redirect(`${origin}/dashboard/artist`);
}
