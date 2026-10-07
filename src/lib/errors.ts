// Turns the stable error codes raised by our SQL functions and triggers (and
// the occasional Postgres/PostgREST error) into one plain sentence a person
// can act on. Never surfaces raw database text for an unknown error.

const MESSAGES: Array<[RegExp, string]> = [
  [/not_authenticated/, "Your session has expired. Please log in again."],
  [/account_suspended/, "This account is suspended, so that action isn't available. Contact support if you think that's a mistake."],
  [/not_authorized/, "You don't have permission to do that."],
  [/application_not_found|listing_not_found|thread_not_found/, "That item no longer exists."],
  [/listing_not_open/, "This listing isn't open any more."],
  [/applications_closed/, "Applications for this listing have closed."],
  [/listing_past/, "This show's date has already passed."],
  [/slot_filled/, "Another artist has already been confirmed for this slot."],
  [/offer_expired/, "This offer has expired. Ask the promoter to send a new one."],
  [/offers_outstanding/, "There's an offer waiting for an answer — withdraw it before changing the date."],
  [/has_confirmed_booking/, "This listing has a confirmed booking. Cancel the booking first, or cancel the whole listing."],
  [/listing_locked/, "This listing has an offer or a confirmed booking, so its date, venue, times and money can't be edited."],
  [/booking_not_confirmed/, "The booking has to be confirmed by the artist before it can be paid."],
  [/already_paid/, "This booking has already been paid."],
  [/blocked/, "You can't message this person."],
  [/rate_limited/, "You're doing that too quickly. Please wait a moment and try again."],
  [/duplicate key|already exists|unique constraint/i, "You've already done that."],
  [/row-level security/, "You don't have permission to do that."],
  [/deletion_blocked/, "This account can't be deleted yet — there's an upcoming confirmed booking. Cancel it first."],
];

// Codes whose message already carries a human sentence after the colon
// (e.g. "slot_invalid: the show date is in the past").
const PASS_THROUGH = /^(slot_invalid|application_invalid|message_invalid|profile_invalid|offer_invalid|cancel_invalid|report_invalid|invalid_transition|rate_limited|blocked): ?([\s\S]+)$/;

export function friendlyError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw = typeof err === "string" ? err : err instanceof Error ? err.message : (err as { message?: string } | null)?.message ?? "";
  if (!raw) return fallback;

  const passthrough = raw.match(PASS_THROUGH);
  if (passthrough) {
    const text = passthrough[2].trim();
    return text.charAt(0).toUpperCase() + text.slice(1).replace(/([^.!?])$/, "$1.");
  }
  for (const [pattern, message] of MESSAGES) {
    if (pattern.test(raw)) return message;
  }
  if (/fetch|network|failed to fetch|load failed/i.test(raw)) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  if (/jwt|session|refresh token/i.test(raw)) return "Your session has expired. Please log in again.";
  return fallback;
}

/** True when the failure looks like a dropped connection or timeout (worth a Retry button). */
export function isNetworkError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String((err as { message?: string } | null)?.message ?? err ?? "");
  return /fetch|network|failed to fetch|load failed|timeout|ECONN/i.test(raw);
}
