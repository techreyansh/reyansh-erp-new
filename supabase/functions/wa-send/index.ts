// Supabase Edge Function: wa-send
//
// Thin Deno.serve wrapper. All of the real work — sendOneWaMessage /
// composeMessagesForStep, media-freshness, sandbox handling, retry/backoff —
// lives in ../_shared/wa/send.ts (moved there in Task 5 so wa-scheduler can
// call the same logic in-process without an HTTP hop). See that file for the
// implementation and its carry-forward contract notes.
//
// Two call shapes:
//   { message_id }                    -> send an existing wa_messages row
//   { enrollment_id, step_id }        -> compose (personalize + fan out media)
//                                        wa_messages row(s) for that step, then
//                                        send each of them
//
// Deploy:
//   supabase functions deploy wa-send
import { preflight, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/db.ts";
import { sendOneWaMessage, composeMessagesForStep } from "../_shared/wa/send.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  let db: any;
  try { db = serviceClient(); } catch (e) { return json({ error: (e as Error).message }, 500); }

  try {
    let messages: any[];
    if (body.message_id) {
      const { data, error } = await db.from("wa_messages").select("*").eq("id", body.message_id).single();
      if (error || !data) return json({ error: "message not found" }, 404);
      messages = [data];
    } else if (body.enrollment_id && body.step_id) {
      messages = await composeMessagesForStep(db, body.enrollment_id, body.step_id);
    } else {
      return json({ error: "message_id or { enrollment_id, step_id } is required" }, 400);
    }

    const results = [];
    for (const m of messages) {
      results.push(await sendOneWaMessage(db, m.id));
    }

    return json({ ok: results.every((r) => r.ok), results });
  } catch (e) {
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});
