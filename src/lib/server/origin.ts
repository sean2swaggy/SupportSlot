// The public base URL for links we hand to Stripe (return/refresh URLs) —
// NEXT_PUBLIC_SITE_URL when set (production), else the request's own origin.
export function siteOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  return configured || new URL(request.url).origin;
}
