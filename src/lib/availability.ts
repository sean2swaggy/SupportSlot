// Pure, framework-free helpers for availability requests — kept separate
// from queries.ts (which needs a live SupabaseClient) so the actual
// decision logic can be unit tested without a database.
import type { AvailabilityRequest, AvailabilityRequestForArtist, AvailabilityRequestWithRecipients } from "@/lib/types";

export const MAX_RECIPIENTS_PER_REQUEST = 50;

export function validateRecipients(artistIds: string[]): { ok: true } | { ok: false; error: string } {
  if (artistIds.length === 0) {
    return { ok: false, error: "Select at least one artist from your roster." };
  }
  if (artistIds.length > MAX_RECIPIENTS_PER_REQUEST) {
    return { ok: false, error: `Send to at most ${MAX_RECIPIENTS_PER_REQUEST} artists at a time.` };
  }
  return { ok: true };
}

// A request is only ever "expired" while it's still nominally open — once a
// promoter withdraws it or marks it filled, that status wins instead (see
// 0011_availability_requests.sql's recipient-response RLS policy, which
// mirrors this exact condition server-side).
export function isRequestExpired(
  request: Pick<AvailabilityRequest, "status" | "responseDeadline">,
  now: number = Date.now()
): boolean {
  return request.status === "sent" && new Date(request.responseDeadline).getTime() < now;
}

export function requestStatusLabel(
  request: AvailabilityRequestWithRecipients | AvailabilityRequestForArtist,
  now: number = Date.now()
): "withdrawn" | "filled" | "expired" | "open" {
  if (request.status === "withdrawn") return "withdrawn";
  if (request.status === "filled") return "filled";
  if (isRequestExpired(request, now)) return "expired";
  return "open";
}

// Mirrors the webhook's own rule (customer.subscription.updated/deleted in
// /api/stripe/webhooks) so both places agree on what "active" means.
export function isActiveSubscriptionStatus(status: string): boolean {
  return status === "active" || status === "trialing";
}
