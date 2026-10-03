// "Take me back to what I was doing" after login/onboarding/2FA, without
// becoming an open redirect: only same-site relative paths are ever followed,
// never a full URL, a protocol-relative URL (//evil.com), a backslash trick,
// or a loop back into the auth screens themselves.

const AUTH_PATHS = ["/login", "/forgot-password", "/reset-password", "/onboarding", "/mfa-setup", "/mfa-challenge", "/auth", "/suspended"];

export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (value.length > 500) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\") || /[\u0000-\u001f]/.test(value)) return null;
  // A scheme smuggled in after the first slash (/\t/evil, /%2f/evil handled above).
  if (/^\/[^?#]*:\/\//.test(value)) return null;
  const path = value.split(/[?#]/)[0];
  if (AUTH_PATHS.some((p) => path === p || path.startsWith(p + "/"))) return null;
  return value;
}

/**
 * Where /auth/callback sends someone after an email link. Normal pages must
 * pass safeNextPath; the one extra destination is /reset-password, which is an
 * auth screen (so safeNextPath refuses it) but is exactly where a recovery
 * link has to land. Anything else falls back to onboarding.
 */
export function callbackNextPath(raw: string | null | undefined): string {
  if (raw === "/reset-password") return "/reset-password";
  return safeNextPath(raw) ?? "/onboarding";
}

/** Reads a safe `next` from the current URL (client only). */
export function nextFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

/** Builds /login?next=<current path> for a signed-out visitor. */
export function loginUrlFor(pathname: string, search: string): string {
  const here = safeNextPath(pathname + search);
  return here ? `/login?next=${encodeURIComponent(here)}` : "/login";
}
