import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabase redirects here after a user clicks the confirmation link in their
// signup email (see emailRedirectTo in src/app/login/page.tsx). Exchanges the
// one-time code for a real session, then hands off to middleware.ts, which
// routes the now-authenticated user to /onboarding or their dashboard.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}/onboarding`);
}
