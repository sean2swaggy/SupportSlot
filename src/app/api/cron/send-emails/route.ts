import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthError } from "@/lib/server/cron";
import { sendOutbox, type OutboxRow } from "@/lib/email";

// Drains the notification email outbox through the configured provider.
export async function GET(request: Request) {
  const denied = cronAuthError(request);
  if (denied) return denied;
  const admin = createAdminClient();
  const summary = await sendOutbox(
    { apiKey: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM, siteUrl: process.env.NEXT_PUBLIC_SITE_URL },
    {
      claim: async (limit) => {
        const { data, error } = await admin.rpc("claim_email_outbox", { p_limit: limit });
        if (error) throw new Error(error.message);
        return (data ?? []) as OutboxRow[];
      },
      markSent: async (id, providerMessageId) => {
        await admin.from("email_outbox").update({ status: "sent", provider_message_id: providerMessageId, sent_at: new Date().toISOString(), last_error: null }).eq("id", id);
      },
      markFailed: async (id, error, final) => {
        await admin.from("email_outbox").update({ last_error: error.slice(0, 500), ...(final ? { status: "failed" } : {}) }).eq("id", id);
      },
    }
  );
  return NextResponse.json(summary);
}
