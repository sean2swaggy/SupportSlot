import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/request";

// "Download my data": everything the signed-in user can read about
// themselves, as JSON. It runs on THEIR session, so row-level security —
// not this code — decides what's included; it can never contain anyone else's
// private records.
export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;

  const [profile, artist, promoter, applications, bookings, notifications, saved, threads, messages, reports, support] = await Promise.all([
    supabase.from("profiles").select("id, role, email, username, has_onboarded, email_notifications, support_plus_status, created_at").eq("id", user.id).maybeSingle(),
    supabase.from("artists").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("promoters").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("applications").select("*").order("submitted_at", { ascending: false }),
    supabase.from("bookings").select("*").order("created_at", { ascending: false }),
    supabase.from("notifications").select("type, text, created_at, read").eq("profile_id", user.id),
    supabase.from("saved_slots").select("slot_id, created_at").eq("profile_id", user.id),
    supabase.from("message_threads").select("id, context, created_at"),
    supabase.from("messages").select("thread_id, sender_id, text, created_at").order("created_at", { ascending: true }),
    supabase.from("reports").select("context_type, reason, status, created_at").eq("reporter_id", user.id),
    supabase.from("support_requests").select("topic, message, status, created_at").eq("profile_id", user.id),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    account: profile.data,
    artistProfile: artist.data,
    promoterProfile: promoter.data,
    applications: applications.data ?? [],
    bookings: bookings.data ?? [],
    messageThreads: threads.data ?? [],
    messages: messages.data ?? [],
    notifications: notifications.data ?? [],
    savedListings: saved.data ?? [],
    reportsYouFiled: reports.data ?? [],
    supportRequests: support.data ?? [],
  };
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="support-slot-my-data.json"`,
      "Cache-Control": "no-store",
    },
  });
}
