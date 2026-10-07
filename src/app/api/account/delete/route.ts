import { createAdminClient } from "@/lib/supabase/admin";
import { json, limited, requireUser } from "@/lib/server/request";

// Permanently deletes the signed-in account. Refuses while there's an
// upcoming confirmed booking (cancel it first, so the other side isn't left
// waiting). Everything still in flight is wound down and the account's
// personal data is removed. Booking records are KEPT, but the account link is
// cut: they keep only the names snapshotted at the time. Needs the typed
// confirmation "DELETE"; the middleware has already required a fully verified
// (2FA) session to reach this.
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { user } = auth;
  const limit = await limited(`delete-account:${user.id}`, 3, 3600);
  if (limit) return limit;

  const body = (await request.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "DELETE") return json({ error: 'Type DELETE to confirm.' }, 400);

  const admin = createAdminClient();
  const { data: blockers, error: blockError } = await admin.rpc("account_deletion_blockers", { p_profile_id: user.id });
  if (blockError) return json({ error: "We couldn't check whether your account can be deleted. Please try again." }, 500);
  if ((blockers as string[]).length > 0) {
    return json({
      error: "Your account can't be deleted yet.",
      blockers,
      detail: "You have an upcoming confirmed booking. Cancel it first (the other side is told straight away), then try again.",
    }, 409);
  }

  const { error: prepError } = await admin.rpc("prepare_account_deletion", { p_profile_id: user.id });
  if (prepError) return json({ error: "We couldn't wind down your account's activity. Nothing was deleted — please try again." }, 500);

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("auth deleteUser failed", deleteError.message);
    return json({ error: "We couldn't finish deleting your account. Please contact support." }, 500);
  }
  return json({ ok: true });
}
