import type Stripe from "stripe";

export type VerifyResult =
  | { ok: true; event: Stripe.Event }
  | { ok: false; status: number; error: string };

// Verifies a webhook against the RAW request body — never a parsed-and-
// re-serialised copy, which would change the bytes the signature covers.
// Anything unsigned, tampered with, signed with another secret, or older
// than Stripe's 5-minute replay tolerance is refused.
export function verifyWebhook(
  stripe: Pick<Stripe, "webhooks">,
  rawBody: string,
  signature: string | null,
  secret: string | undefined
): VerifyResult {
  if (!secret) {
    // Our misconfiguration, not the caller's: 500 so Stripe keeps retrying
    // and the failure is loud instead of silently dropping payments.
    return { ok: false, status: 500, error: "Webhook signing secret is not configured." };
  }
  if (!signature) return { ok: false, status: 400, error: "Missing Stripe-Signature header." };
  try {
    return { ok: true, event: stripe.webhooks.constructEvent(rawBody, signature, secret, 300) };
  } catch {
    return { ok: false, status: 400, error: "Invalid signature." };
  }
}
