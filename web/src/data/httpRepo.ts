import type { User } from "../domain/types";
import { RepoError, type Repo } from "./repo";

const TOKEN_KEY = "support-slot:token";
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t: string | null) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

async function call<T>(method: string, args: unknown[]): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json", ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}) },
      body: JSON.stringify({ method, args }),
    });
  } catch {
    throw new RepoError("network", "We couldn't reach the server. Check your connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.error) {
    const e = body?.error ?? { code: "network", message: "The server sent an unexpected reply." };
    if (res.status === 401 && method !== "signIn") setToken(null);
    throw new RepoError(e.code, e.message);
  }
  return body.result as T;
}

/** Talks to server/server.ts. The acting-user argument the screens pass is
 *  ignored by the server; it uses the signed-in session instead. */
export function createHttpRepo(): Repo {
  const passthrough = (name: string) => (...args: unknown[]) => call(name, args);
  const base = Object.fromEntries(
    ["updateProfile", "notifications", "markAllRead", "threads", "thread", "sendMessage", "openSlots", "slot", "apply", "withdraw",
      "myApplications", "myBookings", "booking", "cancelBooking", "myListings", "createListing", "cancelListing", "applicants", "accept", "decline"]
      .map((n) => [n, passthrough(n)]),
  );
  return {
    ...(base as unknown as Repo),
    signUp: async (a) => { const r = await call<{ user: User; token: string }>("signUp", [a]); setToken(r.token); return r.user; },
    signIn: async (e, p) => { const r = await call<{ user: User; token: string }>("signIn", [e, p]); setToken(r.token); return r.user; },
    user: async (id) => (getToken() ? call<User | null>("user", [id]) : null),
    signOut: async () => { try { await call("signOut", []); } finally { setToken(null); } },
  };
}
