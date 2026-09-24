import { describe, expect, it } from "vitest";
import { evaluatePassword, isPasswordAcceptable, PASSWORD_MIN_LENGTH } from "@/lib/password";

describe("evaluatePassword", () => {
  it("flags passwords shorter than the minimum", () => {
    const result = evaluatePassword("Abc1");
    expect(result.blockingIssues.length).toBeGreaterThan(0);
    expect(result.score).toBe(0);
  });

  it("flags a common password even if it's long enough", () => {
    const result = evaluatePassword("password123");
    expect(result.blockingIssues.length).toBeGreaterThan(0);
    expect(result.score).toBe(0);
  });

  it("flags a long password with only one character class", () => {
    const result = evaluatePassword("aaaaaaaaaaaa");
    expect(result.blockingIssues.length).toBeGreaterThan(0);
  });

  it("accepts a reasonable password with two character classes", () => {
    const result = evaluatePassword("correcthorse1");
    expect(result.blockingIssues).toEqual([]);
    expect(result.score).toBeGreaterThanOrEqual(2);
  });

  it("scores a long, varied password as strong", () => {
    const result = evaluatePassword("Correct-Horse-Battery-99");
    expect(result.blockingIssues).toEqual([]);
    expect(result.score).toBe(4);
    expect(result.label).toBe("Strong");
  });

  it("minimum length constant is 8", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });
});

describe("isPasswordAcceptable", () => {
  it("rejects weak passwords", () => {
    expect(isPasswordAcceptable("short")).toBe(false);
  });

  it("accepts passwords that clear the bar", () => {
    expect(isPasswordAcceptable("correcthorse1")).toBe(true);
  });
});
