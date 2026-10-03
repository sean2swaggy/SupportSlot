// Sends queued notification emails through Resend (https://resend.com), and
// is careful about what it claims:
//   - An email is marked 'sent' ONLY when the provider replies 2xx with a
//     message id, which is stored. Anything else stays pending (retried, up
//     to 5 attempts) or ends 'failed' with the provider's error.
//   - With no RESEND_API_KEY the sender does nothing at all and says so —
//     nothing is ever reported as sent.
//   - Only transactional notices go out (offers, bookings, payments); there
//     is no marketing mail, so there is nothing to opt out of beyond the
//     account-level email_notifications switch the queue already respects.

export interface OutboxRow {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  href: string | null;
  attempts: number;
}

export interface EmailEnv {
  apiKey: string | undefined;
  from: string | undefined; // e.g. "Support Slot <notifications@yourdomain>"
  siteUrl: string | undefined;
}

export interface EmailDeps {
  claim(limit: number): Promise<OutboxRow[]>;
  markSent(id: string, providerMessageId: string): Promise<void>;
  markFailed(id: string, error: string, final: boolean): Promise<void>;
  fetchImpl?: typeof fetch;
}

export type SendSummary =
  | { configured: false; reason: string }
  | { configured: true; claimed: number; sent: number; failed: number };

const MAX_ATTEMPTS = 5;

export async function sendOutbox(env: EmailEnv, deps: EmailDeps, limit = 20): Promise<SendSummary> {
  if (!env.apiKey || !env.from) {
    return { configured: false, reason: "RESEND_API_KEY and EMAIL_FROM are not set, so no email is being sent." };
  }
  const doFetch = deps.fetchImpl ?? fetch;
  const rows = await deps.claim(limit);
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const link = row.href && env.siteUrl ? `\n\nOpen it: ${env.siteUrl.replace(/\/+$/, "")}${row.href}` : "";
    try {
      const res = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `outbox-${row.id}` },
        body: JSON.stringify({
          from: env.from,
          to: [row.to_email],
          subject: row.subject,
          text: `${row.body}${link}\n\n— Support Slot\nYou're getting this because of activity on your Support Slot account. You can turn email notifications off in Settings.`,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (res.ok && payload.id) {
        await deps.markSent(row.id, payload.id);
        sent += 1;
      } else {
        await deps.markFailed(row.id, `provider ${res.status}: ${payload.message ?? "no message id returned"}`, row.attempts >= MAX_ATTEMPTS);
        failed += 1;
      }
    } catch (err) {
      await deps.markFailed(row.id, err instanceof Error ? err.message : String(err), row.attempts >= MAX_ATTEMPTS);
      failed += 1;
    }
  }
  return { configured: true, claimed: rows.length, sent, failed };
}
