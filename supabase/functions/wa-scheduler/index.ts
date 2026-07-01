// Supabase Edge Function: wa-scheduler
//
// The heartbeat of the WhatsApp drip engine. Invoked by pg_cron (every ~5 min,
// see WHATSAPP_MARKETING_SETUP.md for the exact cron.schedule SQL). Mirrors
// email-scheduler/index.ts's shape, adapted to the wa_* schema. Each tick:
//
//   1. Find active enrollments that are due (next_send_at <= now), joined to
//      their campaign + contact.
//   2. Skip enrollments whose campaign isn't status='running', or whose
//      contact is opt_out (flips the enrollment to 'opted_out').
//   3. Evaluate the campaign's business-hours/working-days window
//      (_shared/wa/schedule.ts). If outside the window, push next_send_at
//      forward and do NOT send.
//   4. Resolve the next active step (current_step+1 among is_active steps,
//      ordered by step_order — same rule the wa_advance_enrollment_on_send
//      trigger uses to find the next step after a send). If none, the
//      enrollment is complete.
//   5. Compose + send in-process via _shared/wa/send.ts. Advancement after a
//      successful send is NOT reimplemented here — it's handled entirely by
//      the wa_advance_enrollment_on_send DB trigger (AFTER UPDATE OF status
//      ON wa_messages, fires when status flips to 'sent').
//
// Plus two carry-forward contracts from Task 4's review:
//   A. Stale-`sending` sweep — wa-send marks a message 'sending' before the
//      live provider call; if the process dies mid-flight the row is stuck.
//      Any 'sending' row older than STALE_SENDING_MS gets re-driven through
//      sendOneWaMessage, which is safe because that function reloads the row
//      fresh and no-ops on anything already sent/delivered/read.
//   B. Sandbox progression — wa-send's sandbox shortcut leaves a message at
//      'sent' and does not synthesize delivered/read. This tick progresses
//      sandbox messages (detected by the `sandbox-` provider_message_id
//      prefix synthesized in _shared/wa/send.ts) sent -> delivered -> read
//      with a small per-message randomized delay, so the Live Monitor demo
//      looks realistic instead of jumping straight to a terminal state.
//
// Auth: same x-scheduler-secret header-guard pattern as task-notify/email-scheduler.
//
// Deploy:
//   supabase functions deploy wa-scheduler
import { preflight, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/db.ts";
import { sendOneWaMessage, composeMessagesForStep, recordEvent } from "../_shared/wa/send.ts";
import { evaluateWaWindow } from "../_shared/wa/schedule.ts";

const BATCH = 50;
// "A few minutes" per the Task 5 carry-forward contract — comfortably longer
// than any real provider call/timeout, short enough that a crashed tick
// recovers within one or two scheduler ticks.
const STALE_SENDING_MS = 5 * 60 * 1000;

// Sandbox progression delay ranges (ms). Deterministic-per-message (hashed
// off the message id) rather than Math.random() each tick, so: (a) the
// "due at" instant is stable across ticks/retries, and (b) different
// messages naturally drift apart instead of all flipping in lockstep.
const SANDBOX_DELIVERED_MIN_MS = 15_000; // 15s
const SANDBOX_DELIVERED_MAX_MS = 90_000; // 90s
const SANDBOX_READ_MIN_MS = 30_000; // 30s
const SANDBOX_READ_MAX_MS = 240_000; // 4min

/** Deterministic pseudo-random offset in [min, max] derived from a string id. */
function pseudoRandomOffsetMs(id: string, min: number, max: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const frac = (Math.abs(h) % 10_000) / 10_000; // 0..1
  return min + frac * (max - min);
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const secret = Deno.env.get("SCHEDULER_SECRET");
  if (secret && req.headers.get("x-scheduler-secret") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  let db: any;
  try { db = serviceClient(); } catch (e) { return json({ error: (e as Error).message }, 500); }

  const now = new Date();
  const summary = {
    processed: 0,
    sent: 0,
    completed: 0,
    opted_out: 0,
    window_deferred: 0,
    skipped: 0,
    errors: 0,
    stale_recovered: 0,
    sandbox_delivered: 0,
    sandbox_read: 0,
  };

  try {
    // ---- 1. Due enrollments ------------------------------------------------
    const { data: due, error } = await db
      .from("wa_enrollments")
      .select("*, campaign:wa_campaigns(*), contact:wa_contacts(*)")
      .eq("status", "active")
      .lte("next_send_at", now.toISOString())
      .order("next_send_at", { ascending: true })
      .limit(BATCH);
    if (error) return json({ error: error.message }, 500);

    for (const enr of due ?? []) {
      summary.processed++;
      try {
        const campaign = enr.campaign;
        if (!campaign || campaign.status !== "running") { summary.skipped++; continue; }

        const contact = enr.contact;
        if (!contact) {
          await db.from("wa_enrollments").update({ status: "failed", next_send_at: null }).eq("id", enr.id);
          summary.skipped++;
          continue;
        }
        if (contact.opt_out) {
          await db.from("wa_enrollments").update({ status: "opted_out", next_send_at: null }).eq("id", enr.id);
          summary.opted_out++;
          continue;
        }

        // ---- 3. Business-hours / working-days window -----------------------
        const win = evaluateWaWindow(campaign);
        if (!win.sendableNow) {
          await db.from("wa_enrollments").update({ next_send_at: win.nextOpenIso }).eq("id", enr.id);
          summary.window_deferred++;
          continue;
        }

        // ---- 4. Resolve the next active step --------------------------------
        // Same rule as wa_advance_enrollment_on_send: smallest step_order that
        // is > current_step and is_active.
        const { data: step } = await db
          .from("wa_campaign_steps")
          .select("*")
          .eq("campaign_id", campaign.id)
          .eq("is_active", true)
          .gt("step_order", enr.current_step ?? 0)
          .order("step_order", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!step) {
          await db.from("wa_enrollments").update({ status: "completed", next_send_at: null }).eq("id", enr.id);
          summary.completed++;
          continue;
        }

        // ---- 5. Compose + send in-process -----------------------------------
        const messages = await composeMessagesForStep(db, enr.id, step.id);
        for (const m of messages) {
          if (m.status === "failed") continue; // permanently failed; needs human intervention
          if (m.status === "sending") continue; // mid-flight; the stale-sending sweep below owns recovery
          if (m.status === "retry_pending" && m.scheduled_for && new Date(m.scheduled_for) > now) continue; // backoff not elapsed yet

          const res = await sendOneWaMessage(db, m.id);
          if (res.ok) summary.sent++; else summary.errors++;
        }
        // Enrollment advancement (current_step / next_send_at / completion) on
        // a successful send is handled entirely by the wa_advance_enrollment_on_send
        // DB trigger — not reimplemented here.
      } catch {
        summary.errors++;
      }
    }

    // ---- Carry-forward contract A: stale-`sending` sweep ---------------------
    const staleThreshold = new Date(now.getTime() - STALE_SENDING_MS).toISOString();
    const { data: stale } = await db
      .from("wa_messages")
      .select("id")
      .eq("status", "sending")
      .lte("updated_at", staleThreshold)
      .limit(BATCH);
    for (const m of stale ?? []) {
      try {
        const res = await sendOneWaMessage(db, m.id);
        if (res.ok) summary.stale_recovered++; else summary.errors++;
      } catch {
        summary.errors++;
      }
    }

    // ---- Carry-forward contract B: sandbox progression sent -> delivered ----
    const { data: sandboxSent } = await db
      .from("wa_messages")
      .select("id, sent_at, contact_id, campaign_id")
      .eq("status", "sent")
      .like("provider_message_id", "sandbox-%")
      .limit(BATCH);
    for (const m of sandboxSent ?? []) {
      if (!m.sent_at) continue;
      const dueAt = new Date(m.sent_at).getTime() + pseudoRandomOffsetMs(m.id, SANDBOX_DELIVERED_MIN_MS, SANDBOX_DELIVERED_MAX_MS);
      if (now.getTime() < dueAt) continue;
      const nowIso = now.toISOString();
      await db.from("wa_messages").update({ status: "delivered", delivered_at: nowIso }).eq("id", m.id);
      await recordEvent(db, m, "delivered", { raw_payload: { sandbox: true } });
      summary.sandbox_delivered++;
    }

    // ---- ...and delivered -> read --------------------------------------------
    const { data: sandboxDelivered } = await db
      .from("wa_messages")
      .select("id, delivered_at, contact_id, campaign_id")
      .eq("status", "delivered")
      .like("provider_message_id", "sandbox-%")
      .limit(BATCH);
    for (const m of sandboxDelivered ?? []) {
      if (!m.delivered_at) continue;
      const dueAt = new Date(m.delivered_at).getTime() + pseudoRandomOffsetMs(m.id, SANDBOX_READ_MIN_MS, SANDBOX_READ_MAX_MS);
      if (now.getTime() < dueAt) continue;
      const nowIso = now.toISOString();
      await db.from("wa_messages").update({ status: "read", read_at: nowIso }).eq("id", m.id);
      await recordEvent(db, m, "read", { raw_payload: { sandbox: true } });
      summary.sandbox_read++;
    }

    return json({ ok: true, ranAt: now.toISOString(), ...summary });
  } catch (e) {
    return json({ error: (e as Error)?.message || String(e), ...summary }, 500);
  }
});
