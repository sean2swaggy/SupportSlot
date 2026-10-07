import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, json, limited } from "@/lib/server/request";

const TOPICS = ["account", "booking", "bug", "other"];

// Support requests from signed-in AND signed-out visitors (someone locked out
// of their account can't be asked to log in first). Rate-limited per address
// and per account; stored for staff to review at /admin/support.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { topic?: string; message?: string; email?: string } | null;
  const topic = body?.topic ?? "";
  const message = (body?.message ?? "").trim();
  if (!TOPICS.includes(topic)) return json({ error: "Choose what your request is about." }, 400);
  if (message.length < 10) return json({ error: "Please tell us a bit more (at least 10 characters)." }, 400);
  if (message.length > 4000) return json({ error: "That message is too long (max 4,000 characters)." }, 400);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = (user?.email ?? body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email) || email.length > 254) return json({ error: "Enter an email address we can reply to." }, 400);

  const ipLimit = await limited(`support-ip:${clientIp(request)}`, 5, 3600);
  if (ipLimit) return ipLimit;
  if (user) {
    const userLimit = await limited(`support-user:${user.id}`, 5, 3600);
    if (userLimit) return userLimit;
  }

  const { error } = await createAdminClient().from("support_requests").insert({ profile_id: user?.id ?? null, email, topic, message });
  if (error) {
    console.error("support request insert failed", error.message);
    return json({ error: "We couldn't send that. Please try again." }, 500);
  }
  return json({ ok: true });
}
