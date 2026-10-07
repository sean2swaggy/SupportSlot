// Builds the Content-Security-Policy header value. Lives here (not inline
// in next.config.ts) so it's one place to update.
//
// Verified against what this app actually loads: the Supabase project itself
// (auth + REST + realtime websocket) and the placeholder venue photos. No
// payment provider, analytics/tracking script or other third-party embed
// exists in the codebase — confirmed by grep, not assumed.
//
// script-src includes 'unsafe-inline' — not the ideal answer, but the
// evidence-based one. A per-request nonce (Next.js's own documented
// approach: https://nextjs.org/docs/app/guides/content-security-policy)
// was tried first and tested against a REAL production build (`npm run
// build && npm run start`), not just dev — and broke it: Next 16.3.5's own
// inline hydration <script> tags didn't reliably carry a matching nonce, so
// a nonce-only policy blocked the app's own framework scripts. A nonce
// alongside 'unsafe-inline' doesn't fall back gracefully either — per the
// CSP3 spec, a nonce-source in a directive makes browsers ignore
// 'unsafe-inline' entirely, so that combination silently keeps the same
// breakage. 'unsafe-inline' alone (no nonce) is what was actually verified
// working end to end in a real production build. Every other directive
// below is unaffected by this and stays fully restrictive.
export function buildCsp() {
  const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
    : "";
  const supabaseWs = supabaseOrigin ? `wss://${new URL(supabaseOrigin).host}` : "";

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    // picsum.photos (and the fastly host it redirects to) serves the placeholder
    // venue photos seeded in 0003_seed_venues.sql. Images only, never script.
    // Remove both once venue photography is hosted in Supabase Storage.
    `img-src 'self' data: blob: https://picsum.photos https://fastly.picsum.photos${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
    "font-src 'self'",
    `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin} ${supabaseWs}` : ""}`,
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ]
    .join("; ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
