// Builds the Content-Security-Policy header value. Lives here (not inline
// in next.config.ts) so it's one place to update.
//
// Verified against what this app actually loads: Stripe.js (loadStripe in
// src/lib/stripe/client.ts) and the Payment Element it mounts in
// BookModal.tsx, plus the Supabase project itself (auth + REST/Storage).
// No analytics/tracking script, no other third-party embed exists in the
// codebase today — confirmed by grep, not assumed. The Stripe domains below
// are Stripe's own long-standing, documented CSP requirements for
// Stripe.js/Elements (js.stripe.com, api.stripe.com, hooks.stripe.com,
// m.stripe.network) — re-check
// https://docs.stripe.com/security/guide#content-security-policy before
// launch in case Stripe has since added a domain.
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
    "script-src 'self' 'unsafe-inline' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline'",
    // picsum.photos (and the fastly host it redirects to) serves the placeholder
    // venue photos seeded in 0003_seed_venues.sql. Images only, never script.
    // Remove both once venue photography is hosted in Supabase Storage.
    `img-src 'self' data: blob: https://picsum.photos https://fastly.picsum.photos${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
    "font-src 'self'",
    `connect-src 'self' https://api.stripe.com https://m.stripe.network${supabaseOrigin ? ` ${supabaseOrigin} ${supabaseWs}` : ""}`,
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ]
    .join("; ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
