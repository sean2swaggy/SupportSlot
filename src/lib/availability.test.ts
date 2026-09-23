import { describe, expect, it } from "vitest";
import {
  MAX_RECIPIENTS_PER_REQUEST,
  isActiveSubscriptionStatus,
  isRequestExpired,
  requestStatusLabel,
  validateRecipients,
} from "@/lib/availability";
import type { AvailabilityRequestWithRecipients } from "@/lib/types";

describe("validateRecipients", () => {
  it("rejects an empty recipient list", () => {
    const result = validateRecipients([]);
    expect(result.ok).toBe(false);
  });

  it("accepts a single recipient", () => {
    expect(validateRecipients(["artist-1"])).toEqual({ ok: true });
  });

  it("accepts exactly the maximum", () => {
    const ids = Array.from({ length: MAX_RECIPIENTS_PER_REQUEST }, (_, i) => `artist-${i}`);
    expect(validateRecipients(ids)).toEqual({ ok: true });
  });

  it("rejects one over the maximum — the 'reasonable sending limit'", () => {
    const ids = Array.from({ length: MAX_RECIPIENTS_PER_REQUEST + 1 }, (_, i) => `artist-${i}`);
    const result = validateRecipients(ids);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/50/);
  });
});

describe("isRequestExpired", () => {
  const now = new Date("2026-06-15T12:00:00Z").getTime();
  const past = "2026-06-15T11:00:00Z";
  const future = "2026-06-15T13:00:00Z";

  it("is expired when still 'sent' and the deadline has passed", () => {
    expect(isRequestExpired({ status: "sent", responseDeadline: past }, now)).toBe(true);
  });

  it("is not expired when 'sent' and the deadline is still ahead", () => {
    expect(isRequestExpired({ status: "sent", responseDeadline: future }, now)).toBe(false);
  });

  it("is never 'expired' once withdrawn — withdrawn is its own terminal state", () => {
    expect(isRequestExpired({ status: "withdrawn", responseDeadline: past }, now)).toBe(false);
  });

  it("is never 'expired' once filled", () => {
    expect(isRequestExpired({ status: "filled", responseDeadline: past }, now)).toBe(false);
  });
});

describe("requestStatusLabel", () => {
  const base = {
    id: "req-1",
    promoterId: "promoter-1",
    eventName: "Test Show",
    eventDate: "2026-06-15",
    eventTime: "20:00",
    timezone: "Europe/London",
    venueName: "Venue",
    venueLocation: "City",
    proposedFee: 100,
    currency: "GBP" as const,
    setLengthMins: 30,
    createdAt: "2026-06-01T00:00:00Z",
    recipients: [],
  };
  const now = new Date("2026-06-15T12:00:00Z").getTime();

  it("prioritizes withdrawn over an expired deadline", () => {
    const req: AvailabilityRequestWithRecipients = {
      ...base,
      status: "withdrawn",
      responseDeadline: "2026-06-01T00:00:00Z",
    };
    expect(requestStatusLabel(req, now)).toBe("withdrawn");
  });

  it("reports filled", () => {
    const req: AvailabilityRequestWithRecipients = {
      ...base,
      status: "filled",
      responseDeadline: "2026-06-20T00:00:00Z",
    };
    expect(requestStatusLabel(req, now)).toBe("filled");
  });

  it("reports expired once the deadline has passed and nothing else changed it", () => {
    const req: AvailabilityRequestWithRecipients = {
      ...base,
      status: "sent",
      responseDeadline: "2026-06-01T00:00:00Z",
    };
    expect(requestStatusLabel(req, now)).toBe("expired");
  });

  it("reports open while sent and within the deadline", () => {
    const req: AvailabilityRequestWithRecipients = {
      ...base,
      status: "sent",
      responseDeadline: "2026-06-20T00:00:00Z",
    };
    expect(requestStatusLabel(req, now)).toBe("open");
  });
});

describe("isActiveSubscriptionStatus", () => {
  it("treats active and trialing as active", () => {
    expect(isActiveSubscriptionStatus("active")).toBe(true);
    expect(isActiveSubscriptionStatus("trialing")).toBe(true);
  });

  it("treats every other Stripe subscription status as inactive", () => {
    for (const status of ["canceled", "past_due", "incomplete", "incomplete_expired", "unpaid", "paused"]) {
      expect(isActiveSubscriptionStatus(status)).toBe(false);
    }
  });
});
