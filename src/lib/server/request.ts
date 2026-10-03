import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: json({ error: "Please log in again." }, 401) } as const;
  return { supabase, user } as const;
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? request.headers.get("x-real-ip") ?? "unknown").trim();
}

/**
 * Postgres-backed limiter (rate_limit_hit in 0020) so the limit holds across
 * every serverless instance. Returns a 429 response to send, or null if the
 * caller is within the limit. Fails OPEN on a limiter error — a database
 * hiccup shouldn't take payments down — but logs it.
 */
export async function limited(key: string, limit: number, windowSeconds: number) {
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error("rate limiter unavailable", error.message);
      return null;
    }
    if (data === false) return json({ error: "You're doing that too quickly. Please wait a minute and try again." }, 429);
  } catch (err) {
    console.error("rate limiter threw", err);
  }
  return null;
}
