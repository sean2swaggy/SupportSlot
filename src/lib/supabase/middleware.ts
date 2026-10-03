import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decideAccess, type AccessContext } from "@/lib/routes";

// Real server-side route protection. This file only GATHERS the facts about
// the request (who's signed in, their role, whether they've finished
// onboarding and 2FA, whether they're suspended) and applies the verdict;
// the actual rules live in decideAccess() in src/lib/routes.ts, where every
// branch is unit-tested. The UI hides things as a courtesy — this is the
// enforcement: a bookmark, typed URL or stale link is stopped here.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ctx: AccessContext = {
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    signedIn: !!user,
    profile: null,
    mfa: "ok",
  };

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, has_onboarded, suspended_at, admin_role")
      .eq("id", user.id)
      .single();
    // The profile row is created by a database trigger at signup; if it's
    // somehow missing, treat the account as not-yet-onboarded.
    ctx.profile = {
      role: (profile?.role as "artist" | "promoter" | undefined) ?? "artist",
      hasOnboarded: profile?.has_onboarded ?? false,
      suspended: !!profile?.suspended_at,
      adminRole: (profile?.admin_role as string | null | undefined) ?? null,
    };

    // Mandatory 2FA: every onboarded account needs a verified TOTP factor and
    // every session must have passed its challenge. Read off the session's
    // own JWT (already refreshed by getUser above), so no extra round trip.
    if (ctx.profile.hasOnboarded) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!aal || aal.nextLevel !== "aal2") ctx.mfa = "needs_setup";
      else if (aal.currentLevel !== aal.nextLevel) ctx.mfa = "needs_challenge";
    }
  }

  const redirectTo = decideAccess(ctx);
  if (!redirectTo) return response;

  const url = request.nextUrl.clone();
  const [path, query] = redirectTo.split("?");
  url.pathname = path;
  url.search = query ? `?${query}` : "";
  const redirect = NextResponse.redirect(url);
  // Carry any refreshed session cookies onto the redirect.
  response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}
