import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ONBOARDING_PATH = "/onboarding";
const LOGIN_PATH = "/login";
// Legal/policy pages must be readable without an account — you can't
// meaningfully "agree to our Terms" via a link that only works once you're
// already signed in. Everything else still requires sign-up, per the
// app's mandatory-signup design (see AppGate.tsx).
const PUBLIC_PATHS = ["/privacy", "/terms", "/trust"];

// Artist and promoter are deliberately two different apps sharing one
// codebase — each role has its own landing page and routes the other role
// has no reason to be on (a promoter posting/managing gigs, an artist
// browsing/applying to them). This must hold no matter how the route is
// reached — nav only links to the right places, but a bookmark, typed URL,
// or stale link has to be stopped here, server-side, not just hidden from
// the menu.
const PROMOTER_ONLY_PREFIXES = ["/create-slot", "/dashboard/promoter", "/promoter", "/support-plus"];
const ARTIST_ONLY_PREFIXES = ["/dashboard/artist", "/applications", "/requests", "/last-minute"];

function isUnderPrefix(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// Each role's actual home — the page nav's logo/landing takes them to.
// "/" is the artist-facing slot-discovery homepage; promoters land on
// Discover Artists instead (their main landing page per the discovery
// redesign), never on the artist marketing copy or a "Post a Slot" button.
function landingPathFor(role: "artist" | "promoter") {
  return role === "artist" ? "/" : "/discover";
}

// Real server-side route protection — the app has no anonymous browsing
// mode at all (sign-up is mandatory for every route, see AppGate.tsx), so
// every request either belongs on /login, on /onboarding, or requires a
// fully onboarded session.
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
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const onLoginRoute = pathname === LOGIN_PATH;
  const onOnboardingRoute = pathname.startsWith(ONBOARDING_PATH);
  const onPublicRoute = PUBLIC_PATHS.includes(pathname);

  if (onPublicRoute) return response;

  if (!user) {
    if (onLoginRoute) return response;
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    return NextResponse.redirect(url);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, has_onboarded")
    .eq("id", user.id)
    .single();

  // Profile row is created by a DB trigger at signup; if it's somehow
  // missing, treat as not-onboarded rather than failing the request.
  const role = (profile?.role as "artist" | "promoter" | undefined) ?? "artist";
  const hasOnboarded = profile?.has_onboarded ?? false;

  if (!hasOnboarded) {
    if (onOnboardingRoute) return response;
    const url = request.nextUrl.clone();
    url.pathname = ONBOARDING_PATH;
    return NextResponse.redirect(url);
  }

  if (onLoginRoute || onOnboardingRoute) {
    const url = request.nextUrl.clone();
    url.pathname = landingPathFor(role);
    return NextResponse.redirect(url);
  }

  const wrongRoleRoute =
    (isUnderPrefix(pathname, PROMOTER_ONLY_PREFIXES) && role !== "promoter") ||
    (isUnderPrefix(pathname, ARTIST_ONLY_PREFIXES) && role !== "artist");

  if (wrongRoleRoute || (pathname === "/" && role === "promoter")) {
    const url = request.nextUrl.clone();
    url.pathname = landingPathFor(role);
    return NextResponse.redirect(url);
  }

  return response;
}
