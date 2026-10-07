import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match every route except static assets, image optimization files, and
     * API routes. API routes do their own auth check server-side (session,
     * role checks, or the CRON_SECRET bearer token), and the browser-oriented
     * redirect logic here must not intercept machine-to-machine requests such
     * as the scheduled jobs, which have no user session by design.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
