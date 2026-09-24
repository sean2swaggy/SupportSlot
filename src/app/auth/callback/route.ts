import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabase redirects here after a user clicks a confirmation link in an
// email it sent — signup confirmation (see emailRedirectTo in
// src/app/login/page.tsx) or password recovery (see redirectTo in
// src/app/forgot-password/page.tsx). Exchanges the one-time code for a real
// session here, in a route handler, before anything else runs — this has
// to happen before middleware.ts's next request sees a session, which is
// why /reset-password itself doesn't do this exchange: middleware would
// already have redirected a signed-out request to /login before the page
// ever got a chance to.
//
// `next` picks where to land afterwards: /onboarding for a brand new
// signup (the only case before this existed), /reset-password to set a new
// password after a recovery link. Only ever a same-origin relative path —
// never redirect to a value taken from elsewhere without validating it
// stays on this site.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/onboarding";

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}
