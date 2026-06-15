// Supabase Edge Function: email-send
//
// Sends one email through a linked Gmail account and records the result.
// Two modes:
//   { message_id }                               -> send a queued/approved email_messages row
//   { test: { account_id, to, subject, body } }  -> send a one-off test
//
// The heavy lifting lives in _shared/send.ts (also used by email-scheduler).
//
// Deploy:
//   supabase functions deploy email-send
//   supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
import { preflight, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/db.ts";
import { sendMessageById, sendTest } from "../_shared/send.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  let db: any;
  try { db = serviceClient(); } catch (e) { return json({ error: (e as Error).message }, 500); }

  try {
    if (body.test) {
      const { account_id, to } = body.test;
      if (!account_id || !to) return json({ error: "test.account_id and test.to are required" }, 400);
      const r = await sendTest(db, body.test);
      return r.ok ? json(r) : json({ error: r.error }, r.status ?? 500);
    }

    if (!body.message_id) return json({ error: "message_id (or test) is required" }, 400);
    const r = await sendMessageById(db, body.message_id);
    return r.ok ? json(r) : json({ error: r.error, code: (r as any).code }, r.status ?? 500);
  } catch (e) {
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});
