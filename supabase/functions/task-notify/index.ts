// task-notify — drains an outbox table and sends email/WhatsApp.
// Self-contained (only an esm.sh import) so it can be deployed via the
// Supabase Management API without local bundling.
//
// OUTBOX : POST body { "table": "..." } selects which outbox to drain. Defaults
//          to "task_notifications"; "wf_customer_comms" is the O2D customer
//          milestone outbox. Both share the same generic row shape. Only the
//          table named in the request is drained, so a cron for one outbox never
//          touches the other.
// EMAIL  : Resend REST API.  Secrets: RESEND_API_KEY, RESEND_FROM (e.g. "Reyansh ERP <noreply@yourdomain.com>")
// WHATSAPP: Meta WhatsApp Cloud API.  Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID
//          (when unset, whatsapp rows are marked 'skipped'). Rows carrying a
//          template_name are sent as a pre-approved business template (required
//          for customer business-initiated messages); others go as free text.
// AUTH   : if SCHEDULER_SECRET is set, callers must send header x-scheduler-secret.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected on deployed functions.
//
// Deploy: handled via Management API. Then schedule with pg_cron to POST every ~5-10 min.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH = 50;
const MAX_ATTEMPTS = 3;
const ALLOWED_TABLES = ["task_notifications", "wf_customer_comms"];

async function mark(db: any, table: string, row: any, status: string, err: string | null) {
  await db.from(table).update({
    status,
    error: err,
    sent_at: status === "sent" ? new Date().toISOString() : null,
    attempts: (row.attempts || 0) + 1,
  }).eq("id", row.id);
}

async function retryOrFail(db: any, table: string, row: any, err: string) {
  const attempts = (row.attempts || 0) + 1;
  await db.from(table).update({
    status: attempts < MAX_ATTEMPTS ? "pending" : "failed",
    error: err,
    attempts,
  }).eq("id", row.id);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const schedulerSecret = Deno.env.get("SCHEDULER_SECRET");
  if (schedulerSecret && req.headers.get("x-scheduler-secret") !== schedulerSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Which outbox to drain (body { table }); default keeps existing callers working.
  let table = "task_notifications";
  try {
    const body = await req.json();
    if (body && typeof body.table === "string") table = body.table;
  } catch { /* empty/invalid body → default table */ }
  if (!ALLOWED_TABLES.includes(table)) {
    return new Response(JSON.stringify({ error: `table not allowed: ${table}` }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Reyansh ERP <onboarding@resend.dev>";
  const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
  const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  const { data: rows, error } = await db
    .from(table)
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(BATCH);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }

  let sent = 0, skipped = 0, failed = 0;

  for (const row of rows || []) {
    try {
      if (row.channel === "email") {
        if (!RESEND_API_KEY) { await mark(db, table, row, "skipped", "RESEND_API_KEY not set"); skipped++; continue; }
        if (!row.recipient_email) { await mark(db, table, row, "skipped", "no recipient email"); skipped++; continue; }
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: [row.recipient_email],
            subject: row.subject || "Notification",
            text: row.body || row.subject || "You have an update from Reyansh International.",
          }),
        });
        if (res.ok) { await mark(db, table, row, "sent", null); sent++; }
        else { await retryOrFail(db, table, row, `email ${res.status} ${(await res.text()).slice(0, 200)}`); failed++; }
      } else if (row.channel === "whatsapp") {
        if (!WA_TOKEN || !WA_PHONE_ID) { await mark(db, table, row, "skipped", "whatsapp not configured"); skipped++; continue; }
        if (!row.recipient_phone) { await mark(db, table, row, "skipped", "no recipient phone"); skipped++; continue; }
        const phone = String(row.recipient_phone).replace(/[^0-9]/g, "");
        // Business-initiated WhatsApp (a customer who hasn't messaged us in 24h)
        // requires a pre-approved template. Rows with template_name go that way;
        // free-text is only valid inside an open 24h session window.
        const params = Array.isArray(row.template_params) ? row.template_params : [];
        const waBody = row.template_name
          ? {
              messaging_product: "whatsapp",
              to: phone,
              type: "template",
              template: {
                name: row.template_name,
                language: { code: "en" },
                components: params.length
                  ? [{ type: "body", parameters: params.map((t: any) => ({ type: "text", text: String(t) })) }]
                  : [],
              },
            }
          : {
              messaging_product: "whatsapp",
              to: phone,
              type: "text",
              text: { body: row.body || row.subject || "Update" },
            };
        const res = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify(waBody),
        });
        if (res.ok) { await mark(db, table, row, "sent", null); sent++; }
        else { await retryOrFail(db, table, row, `wa ${res.status} ${(await res.text()).slice(0, 200)}`); failed++; }
      } else {
        await mark(db, table, row, "skipped", "unknown channel"); skipped++;
      }
    } catch (e) {
      await retryOrFail(db, table, row, String((e as any)?.message || e)); failed++;
    }
  }

  return new Response(JSON.stringify({ processed: (rows || []).length, sent, skipped, failed }), {
    headers: { "content-type": "application/json" },
  });
});
