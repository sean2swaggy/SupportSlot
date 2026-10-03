import { describe, expect, it, vi } from "vitest";
import { sendOutbox, type EmailDeps, type OutboxRow } from "./email";

const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({ id: "r1", to_email: "a@example.test", subject: "Hi", body: "You have an offer", href: "/applications", attempts: 1, ...over });
const env = { apiKey: "re_test", from: "Support Slot <n@example.test>", siteUrl: "https://example.test/" };
const mkDeps = (rows: OutboxRow[], fetchImpl: typeof fetch) => {
  const sent: Array<[string, string]> = [];
  const failed: Array<[string, string, boolean]> = [];
  const deps: EmailDeps = {
    claim: async () => rows,
    markSent: async (id, mid) => void sent.push([id, mid]),
    markFailed: async (id, err, final) => void failed.push([id, err, final]),
    fetchImpl,
  };
  return { deps, sent, failed };
};
const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("sendOutbox", () => {
  it("does nothing and says so when no provider is configured — nothing is reported as sent", async () => {
    const f = vi.fn();
    const { deps, sent } = mkDeps([row()], f as unknown as typeof fetch);
    const res = await sendOutbox({ apiKey: undefined, from: undefined, siteUrl: undefined }, deps);
    expect(res).toMatchObject({ configured: false });
    expect(f).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("marks an email sent only with the provider's message id", async () => {
    const { deps, sent, failed } = mkDeps([row()], respond(200, { id: "msg_123" }));
    const res = await sendOutbox(env, deps);
    expect(res).toMatchObject({ configured: true, sent: 1, failed: 0 });
    expect(sent).toEqual([["r1", "msg_123"]]);
    expect(failed).toHaveLength(0);
  });

  it("a 2xx without a message id is NOT treated as sent", async () => {
    const { deps, sent, failed } = mkDeps([row()], respond(200, {}));
    await sendOutbox(env, deps);
    expect(sent).toHaveLength(0);
    expect(failed[0][1]).toContain("no message id");
  });

  it("provider errors and network failures are recorded; the last attempt is final", async () => {
    const a = mkDeps([row({ attempts: 2 })], respond(422, { message: "invalid to address" }));
    await sendOutbox(env, a.deps);
    expect(a.failed[0]).toEqual(["r1", "provider 422: invalid to address", false]);
    const b = mkDeps([row({ attempts: 5 })], vi.fn(async () => { throw new Error("socket hang up"); }) as unknown as typeof fetch);
    await sendOutbox(env, b.deps);
    expect(b.failed[0]).toEqual(["r1", "socket hang up", true]);
  });

  it("builds an absolute link from the site url and sets an idempotency key", async () => {
    const f = respond(200, { id: "m" });
    await sendOutbox(env, mkDeps([row()], f).deps);
    const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).text).toContain("https://example.test/applications");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("outbox-r1");
  });
});
