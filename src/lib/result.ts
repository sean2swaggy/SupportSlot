import { friendlyError } from "./errors";

// Every mutation returns one of these, so callers have to look at the
// outcome: there is no way to "fire and forget" a write and assume it worked.
export type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };

export function ok(): Result<void>;
export function ok<T>(data: T): Result<T>;
export function ok<T>(data?: T): Result<T | undefined> {
  return { ok: true, data };
}

export function fail(err: unknown, fallback?: string): { ok: false; error: string } {
  return { ok: false, error: friendlyError(err, fallback) };
}

/** Wraps the {data, error} shape every Supabase call returns. */
export function fromSupabase<T>(res: { data: T | null; error: { message: string } | null }, fallback?: string): Result<T> {
  if (res.error) return fail(res.error, fallback);
  return { ok: true, data: res.data as T };
}
