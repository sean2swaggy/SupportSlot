import { describe, expect, it } from "vitest";
import { friendlyError, isNetworkError } from "./errors";

describe("friendlyError", () => {
  it("maps stable database codes to plain sentences", () => {
    expect(friendlyError(new Error("slot_filled"))).toMatch(/already been confirmed/);
    expect(friendlyError({ message: "offer_expired" })).toMatch(/expired/);
    expect(friendlyError("account_suspended")).toMatch(/suspended/);
    expect(friendlyError({ message: 'duplicate key value violates unique constraint "applications_slot_id_artist_id_key"' })).toMatch(/already done that/);
    expect(friendlyError({ message: 'new row violates row-level security policy for table "x"' })).toMatch(/permission/);
  });

  it("passes through the sentence after a validation code, capitalised", () => {
    expect(friendlyError(new Error("slot_invalid: the show date is in the past"))).toBe("The show date is in the past.");
    expect(friendlyError(new Error("rate_limited: slow down — too many messages in the last minute"))).toContain("Slow down");
  });

  it("never leaks raw database text for something unknown", () => {
    expect(friendlyError(new Error('column "secret_col" of relation "x" does not exist'))).toBe("Something went wrong. Please try again.");
    expect(friendlyError(null, "custom")).toBe("custom");
  });

  it("recognises dropped connections", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("slot_filled"))).toBe(false);
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/connection/);
  });
});
