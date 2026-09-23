import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — bypasses Row Level Security entirely. Server-only,
// never import from a Client Component. Used only where RLS deliberately
// can't allow a write (e.g. flipping an application to "booked" only after
// server-side payment verification — see 0008_real_payments.sql).
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
