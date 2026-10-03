import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

// Scheduled routes are called by the host's cron with
// `Authorization: Bearer $CRON_SECRET`. Compared in constant time; with no
// secret configured the route refuses everything rather than running open.
export function cronAuthError(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return null;
}
