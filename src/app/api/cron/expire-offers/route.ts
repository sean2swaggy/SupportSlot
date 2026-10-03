import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthError } from "@/lib/server/cron";

// Offers nobody answered by their deadline go back to the shortlist (and both
// sides are told). Safe to run as often as you like.
export async function GET(request: Request) {
  const denied = cronAuthError(request);
  if (denied) return denied;
  const { data, error } = await createAdminClient().rpc("expire_stale_offers");
  if (error) {
    console.error("expire_stale_offers failed", error.message);
    return NextResponse.json({ error: "Failed." }, { status: 500 });
  }
  return NextResponse.json({ expired: data ?? 0 });
}
