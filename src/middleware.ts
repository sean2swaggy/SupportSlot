import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match every route except static assets, image optimization files, and
     * API routes. This used to also run on /api/**, which meant an
     * unauthenticated request — e.g. every Stripe webhook call, which has
     * no user session by design — got redirected to /login instead of ever
     * reaching its route handler (confirmed live: POST /api/stripe/webhooks
     * came back as a 307 to /login, not the handler's response). Every API
     * route already does its own auth check server-side (supabase.auth.
     * getUser(), role checks, or the webhook's signature verification), so
     * excluding /api here doesn't remove any real protection — it just
     * stops this browser-oriented redirect logic from intercepting
     * machine-to-machine requests it was never meant to handle.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
