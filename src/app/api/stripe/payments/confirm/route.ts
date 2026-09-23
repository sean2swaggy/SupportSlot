import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/server";

// The client calls this right after stripe.confirmPayment() returns — but
// we never trust that claim. We re-fetch the PaymentIntent from Stripe
// ourselves and only flip the application to "booked" if Stripe confirms
// it actually succeeded. Uses the service-role client because the
// "booked" transition is deliberately blocked from direct client writes
// (see 0008_real_payments.sql) — this route is the only legitimate path.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { applicationId } = await request.json();
  if (!applicationId) {
    return NextResponse.json({ error: "Missing applicationId." }, { status: 400 });
  }

  const { data: application } = await supabase
    .from("applications")
    .select("id, status, stripe_payment_intent_id, slots(promoter_id)")
    .eq("id", applicationId)
    .maybeSingle();

  const slot = application?.slots as unknown as { promoter_id: string } | null;
  if (!application || !slot || slot.promoter_id !== user.id) {
    return NextResponse.json({ error: "Not authorized for this booking." }, { status: 403 });
  }
  if (!application.stripe_payment_intent_id) {
    return NextResponse.json({ error: "No payment was started for this booking." }, { status: 400 });
  }
  if (application.status === "booked") {
    return NextResponse.json({ ok: true }); // already confirmed (e.g. by the webhook)
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(application.stripe_payment_intent_id);
  if (paymentIntent.status !== "succeeded") {
    return NextResponse.json(
      { error: `Payment not completed yet (status: ${paymentIntent.status}).` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.from("applications").update({ status: "booked" }).eq("id", applicationId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
