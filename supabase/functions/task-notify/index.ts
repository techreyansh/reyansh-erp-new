// Supabase Edge Function: task-notify
//
// Drains the task-notification outbox (public.task_notifications) and delivers
// each pending notification over its channel:
//   - 'email'    -> sent through the first connected Gmail account, reusing the
//                   shared Gmail stack (_shared/gmail.ts + getFreshToken).
//   - 'whatsapp' -> sent via the Meta WhatsApp Cloud API (when credentialed).
//
// Runs as trusted background work with the service role (bypasses RLS). It is
// idempotent: it only ever touches rows with status='pending' whose
// scheduled_for has elapsed, and writes a terminal status (sent/skipped/failed)
// or leaves the row 'pending' for a later retry.
//
// ─────────────────────────────────────────────────────────────────────────────
// REQUIRED env / secrets (set with `supabase secrets set ...`):
//   SUPABASE_URL                 (auto-injected on deployed functions)
//   SUPABASE_SERVICE_ROLE_KEY    (auto-injected on deployed functions)
//   GOOGLE_CLIENT_ID             same OAuth client used for Gmail login
//   GOOGLE_CLIENT_SECRET         "
//
// OPTIONAL secrets:
//   WHATSAPP_TOKEN               Meta WhatsApp Cloud API permanent/system token
//   WHATSAPP_PHONE_NUMBER_ID     the phone-number id to send from
//        -> if BOTH are absent, whatsapp rows are marked 'skipped'.
//   SCHEDULER_SECRET             if set, callers MUST send a matching
//                                'x-scheduler-secret' request header.
//
// ─────────────────────────────────────────────────────────────────────────────
// DEPLOY:
//   supabase functions deploy task-notify
//   supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
//   # optional:
//   supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=...
//   supabase secrets set SCHEDULER_SECRET=...
//
// SCHEDULE (pg_cron) — run in the SQL editor, every 10 minutes:
//   create extension if not exists pg_cron;
//   create extension if not exists pg_net;
//   select cron.schedule(
//     'task-notify-drain',
//     '*/10 * * * *',
//     $$
//       select net.http_post(
//         url     := 'https://<PROJECT_REF>.functions.supabase.co/task-notify',
//         headers := jsonb_build_object(
//           'Content-Type',       'application/json',
//           'x-scheduler-secret', '<SCHEDULER_SECRET>'   -- omit if not set
//         ),
//         body    := '{}'::jsonb
//       );
//     $$
//   );
//   -- to remove later: select cron.unschedule('task-notify-drain');
//
// Expected public.task_notifications columns:
//   id, channel ('email'|'whatsapp'), recipient_email, recipient_phone,
//   subject, body, status ('pending'|'sent'|'skipped'|'failed'),
//   scheduled_for timestamptz, sent_at timestamptz, attempts int, error text
import { preflight, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/db.ts";
import { getFreshToken } from "../_shared/send.ts";
import { buildMime, sendGmail } from "../_shared/gmail.ts";

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 3;
const WHATSAPP_API_VERSION = "v20.0";

const nowIso = () => new Date().toISOString();

// Pick a Gmail account we can actually send from: connected + has a refresh
// token. Returns null when none exists (so the row is skipped, not failed).
async function findSendingAccount(db: any): Promise<any | null> {
  const { data } = await db
    .from("email_accounts")
    .select("*")
    .not("refresh_token", "is", null)
    .eq("status", "connected")
    .order("created_at", { ascending: true })
    .limit(1);
  if (data && data.length) return data[0];

  // Fallback: any account with a refresh token (status may be stale/expired —
  // getFreshToken will refresh and flip it back to connected).
  const { data: any2 } = await db
    .from("email_accounts")
    .select("*")
    .not("refresh_token", "is", null)
    .order("created_at", { ascending: true })
    .limit(1);
  return any2 && any2.length ? any2[0] : null;
}

// Send a WhatsApp text message via the Meta Cloud API. Throws on failure.
//
// TODO: outside the 24-hour customer-service window, free-form 'text' messages
// are rejected by Meta — real proactive sends require a pre-approved *template*
// message (type: 'template'). Swap the body below for a template payload once a
// template is approved. For now we send 'text', which works for replies inside
// the 24h window and for test numbers.
async function sendWhatsApp(opts: { token: string; phoneNumberId: string; to: string; body: string }): Promise<string> {
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${opts.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: opts.to,
      type: "text",
      text: { preview_url: false, body: opts.body },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `WhatsApp send failed (${res.status})`);
  }
  return data?.messages?.[0]?.id || "";
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Optional shared-secret gate for the scheduler.
  const expectedSecret = Deno.env.get("SCHEDULER_SECRET");
  if (expectedSecret && req.headers.get("x-scheduler-secret") !== expectedSecret) {
    return json({ error: "unauthorized" }, 401);
  }

  let db: any;
  try { db = serviceClient(); } catch (e) { return json({ error: (e as Error).message }, 500); }

  const { data: rows, error } = await db
    .from("task_notifications")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_for", nowIso())
    .order("scheduled_for", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) return json({ error: error.message }, 500);

  // WhatsApp credentials are read once for the whole batch.
  const waToken = Deno.env.get("WHATSAPP_TOKEN");
  const waPhoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  // Cache the sending Gmail account/token across email rows in this batch.
  let cachedAccount: any | null | undefined; // undefined = not looked up yet
  let cachedToken: string | null = null;

  let processed = 0, sent = 0, skipped = 0, failed = 0;

  for (const row of (rows || [])) {
    processed++;
    try {
      const channel = (row.channel || "email").toLowerCase();

      // ── EMAIL ─────────────────────────────────────────────────────────────
      if (channel === "email") {
        if (!row.recipient_email) {
          await db.from("task_notifications")
            .update({ status: "skipped", error: "no recipient_email" })
            .eq("id", row.id);
          skipped++;
          continue;
        }

        if (cachedAccount === undefined) cachedAccount = await findSendingAccount(db);
        if (!cachedAccount) {
          await db.from("task_notifications")
            .update({ status: "skipped", error: "no email account connected" })
            .eq("id", row.id);
          skipped++;
          continue;
        }

        try {
          if (!cachedToken) cachedToken = await getFreshToken(db, cachedAccount);
          const mime = buildMime({
            to: row.recipient_email,
            fromEmail: cachedAccount.email,
            fromName: cachedAccount.display_name,
            subject: row.subject || "Task notification",
            body: row.body || "",
          });
          await sendGmail({ accessToken: cachedToken, mime });
          await db.from("task_notifications")
            .update({ status: "sent", sent_at: nowIso(), error: null })
            .eq("id", row.id);
          sent++;
        } catch (e) {
          const attempts = (row.attempts ?? 0) + 1;
          // A token failure poisons the cache for the rest of the batch.
          cachedToken = null;
          await db.from("task_notifications")
            .update({
              status: attempts < MAX_ATTEMPTS ? "pending" : "failed",
              attempts,
              error: (e as Error).message,
            })
            .eq("id", row.id);
          if (attempts < MAX_ATTEMPTS) processed--; // left pending, not terminal
          else failed++;
        }
        continue;
      }

      // ── WHATSAPP ──────────────────────────────────────────────────────────
      if (channel === "whatsapp") {
        if (!waToken || !waPhoneId) {
          await db.from("task_notifications")
            .update({ status: "skipped", error: "whatsapp not configured" })
            .eq("id", row.id);
          skipped++;
          continue;
        }
        if (!row.recipient_phone) {
          await db.from("task_notifications")
            .update({ status: "skipped", error: "no recipient_phone" })
            .eq("id", row.id);
          skipped++;
          continue;
        }

        try {
          await sendWhatsApp({
            token: waToken,
            phoneNumberId: waPhoneId,
            to: row.recipient_phone,
            body: row.body || row.subject || "Task notification",
          });
          await db.from("task_notifications")
            .update({ status: "sent", sent_at: nowIso(), error: null })
            .eq("id", row.id);
          sent++;
        } catch (e) {
          const attempts = (row.attempts ?? 0) + 1;
          await db.from("task_notifications")
            .update({
              status: attempts < MAX_ATTEMPTS ? "pending" : "failed",
              attempts,
              error: (e as Error).message,
            })
            .eq("id", row.id);
          if (attempts < MAX_ATTEMPTS) processed--;
          else failed++;
        }
        continue;
      }

      // ── UNKNOWN CHANNEL ───────────────────────────────────────────────────
      await db.from("task_notifications")
        .update({ status: "skipped", error: `unknown channel '${row.channel}'` })
        .eq("id", row.id);
      skipped++;
    } catch (e) {
      // Defensive: a per-row crash must never stop the batch. Best-effort mark.
      failed++;
      try {
        await db.from("task_notifications")
          .update({ status: "failed", error: (e as Error).message, attempts: (row.attempts ?? 0) + 1 })
          .eq("id", row.id);
      } catch { /* swallow — already counted as failed */ }
    }
  }

  return json({ processed, sent, skipped, failed });
});
