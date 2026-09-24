import { describe, expect, it } from "vitest";
import { validateUsernameFormat } from "@/lib/username";

describe("validateUsernameFormat", () => {
  it("rejects too short", () => {
    expect(validateUsernameFormat("ab").ok).toBe(false);
  });

  it("rejects too long", () => {
    expect(validateUsernameFormat("a".repeat(21)).ok).toBe(false);
  });

  it("accepts the minimum length", () => {
    expect(validateUsernameFormat("abc")).toEqual({ ok: true });
  });

  it("accepts the maximum length", () => {
    expect(validateUsernameFormat("a".repeat(20))).toEqual({ ok: true });
  });

  it("accepts letters, numbers and underscores", () => {
    expect(validateUsernameFormat("slow_cpu_92")).toEqual({ ok: true });
  });

  it("rejects spaces", () => {
    expect(validateUsernameFormat("slow cpu").ok).toBe(false);
  });

  it("rejects symbols", () => {
    expect(validateUsernameFormat("slow-cpu!").ok).toBe(false);
  });
});
