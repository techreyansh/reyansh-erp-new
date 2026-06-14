// Supabase Edge Function: email-scheduler
//
// The heartbeat of the campaign engine. Invoked by pg_cron (every ~5 min). Each tick:
//   1. find active enrollments that are due (next_send_at <= now) in active campaigns
//   2. resolve the next step; if none left -> mark the enrollment completed
//   3. enforce the send window (IST) + per-account daily cap
//   4. generate a fresh, personalized draft with Gemini
//   5. review_before_send -> park as a pending_review draft (no send, no advance)
//      else                -> send it and advance the enrollment to the next step
//
// Deploy:
//   supabase functions deploy email-scheduler
//   supabase secrets set GEMINI_API_KEY=... GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
// Then schedule it via pg_cron + pg_net (see EMAIL_CAMPAIGNS_SETUP.md).
//
// Optional auth: set SCHEDULER_SECRET and pass it as the x-scheduler-secret header.
import { preflight, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/db.ts";
import { generateEmail } from "../_shared/ai.ts";
import { sendMessageById } from "../_shared/send.ts";
import { evaluateWindow } from "../_shared/schedule.ts";

const BATCH = 50;
const FAIL_BACKOFF_MS = 60 * 60 * 1000; // retry a failed send in ~1h

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  const secret = Deno.env.get("SCHEDULER_SECRET");
  if (secret && req.headers.get("x-scheduler-secret") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "GEMINI_API_KEY is not set." }, 500);

  let db: any;
  try { db = serviceClient(); } catch (e) { return json({ error: (e as Error).message }, 500); }

  const now = new Date();
  const summary = { processed: 0, sent: 0, drafted: 0, completed: 0, skipped: 0, errors: 0 };

  // caches for this tick
  const accountCache = new Map<string, any>();
  const runSent = new Map<string, number>(); // account_id -> sends issued this tick

  const getAccount = async (id: string) => {
    if (accountCache.has(id)) return accountCache.get(id);
    const { data } = await db.from("email_accounts").select("*").eq("id", id).single();
    accountCache.set(id, data);
    return data;
  };
  const getStep = async (campaignId: string, order: number) => {
    const { data } = await db.from("email_campaign_steps")
      .select("*").eq("campaign_id", campaignId).eq("step_order", order).eq("is_active", true).maybeSingle();
    return data;
  };

  try {
    const { data: due, error } = await db
      .from("email_enrollments")
      .select("*, campaign:email_campaigns(*)")
      .eq("status", "active")
      .lte("next_send_at", now.toISOString())
      .order("next_send_at", { ascending: true })
      .limit(BATCH);
    if (error) return json({ error: error.message }, 500);

    for (const enr of due ?? []) {
      summary.processed++;
      const campaign = enr.campaign;
      if (!campaign || campaign.status !== "active") { summary.skipped++; continue; }

      // contact must exist and be mailable
      const { data: contact } = await db.from("email_contacts").select("*").eq("id", enr.contact_id).single();
      if (!contact) { await db.from("email_enrollments").update({ status: "failed", next_send_at: null }).eq("id", enr.id); summary.skipped++; continue; }
      if (contact.status !== "active") {
        const map: Record<string, string> = { unsubscribed: "unsubscribed", bounced: "bounced", complained: "unsubscribed" };
        await db.from("email_enrollments").update({ status: map[contact.status] ?? "paused", next_send_at: null }).eq("id", enr.id);
        summary.skipped++; continue;
      }

      // next step
      const nextOrder = (enr.current_step ?? 0) + 1;
      const step = await getStep(campaign.id, nextOrder);
      if (!step) {
        await db.from("email_enrollments").update({ status: "completed", next_send_at: null }).eq("id", enr.id);
        summary.completed++; continue;
      }

      // a sending account is required to run an enrollment
      if (!campaign.sending_account_id) { summary.skipped++; continue; }

      // send window
      const win = evaluateWindow(campaign);
      if (!win.sendableNow) {
        await db.from("email_enrollments").update({ next_send_at: win.nextOpenIso }).eq("id", enr.id);
        summary.skipped++; continue;
      }

      const reviewMode = !!campaign.review_before_send;

      // daily cap (only constrains actual sends, not draft generation)
      if (!reviewMode) {
        const account = await getAccount(campaign.sending_account_id);
        const today = now.toISOString().slice(0, 10);
        const base = account?.sent_today_date === today ? (account.sent_today ?? 0) : 0;
        const projected = base + (runSent.get(account?.id) ?? 0);
        if (projected >= (campaign.daily_send_cap ?? 200)) {
          // try again next tick; leave next_send_at as-is (still due)
          summary.skipped++; continue;
        }
      }

      // prior sent steps, so the AI doesn't repeat itself
      const { data: prior } = await db.from("email_messages")
        .select("step_order,subject,body").eq("enrollment_id", enr.id).eq("status", "sent").order("step_order");

      // generate
      let gen;
      try {
        gen = await generateEmail({
          apiKey,
          contact,
          campaign,
          step: { step_order: nextOrder, goal: step.goal, subject_hint: step.subject_hint },
          priorMessages: prior ?? [],
        });
      } catch (e) {
        summary.errors++;
        await db.from("email_enrollments").update({ next_send_at: new Date(now.getTime() + FAIL_BACKOFF_MS).toISOString() }).eq("id", enr.id);
        continue;
      }

      // create the message row
      const { data: msg, error: insErr } = await db.from("email_messages").insert({
        enrollment_id: enr.id,
        campaign_id: campaign.id,
        contact_id: contact.id,
        step_id: step.id,
        step_order: nextOrder,
        to_email: contact.email,
        subject: gen.subject,
        body: gen.body,
        status: reviewMode ? "pending_review" : "approved",
        generated_by_ai: true,
        ai_model: gen.model,
        scheduled_for: now.toISOString(),
      }).select("id").single();
      if (insErr || !msg) { summary.errors++; continue; }

      if (reviewMode) {
        // park the enrollment until a human approves; approval flow will send + advance
        await db.from("email_enrollments").update({ next_send_at: null }).eq("id", enr.id);
        summary.drafted++;
        continue;
      }

      // auto-send. On success the DB trigger (trg_email_message_sent) advances the
      // enrollment to the next step (or marks it completed) — see the migration.
      const res = await sendMessageById(db, msg.id);
      if (res.ok) {
        summary.sent++;
        runSent.set(campaign.sending_account_id, (runSent.get(campaign.sending_account_id) ?? 0) + 1);
      } else if ((res as any).code === "daily_cap_reached") {
        // roll the draft back to retry next tick; don't advance
        await db.from("email_messages").update({ status: "approved" }).eq("id", msg.id);
        summary.skipped++;
      } else {
        // hard failure: message is marked failed in send(); back off the enrollment
        summary.errors++;
        await db.from("email_enrollments").update({
          next_send_at: new Date(now.getTime() + FAIL_BACKOFF_MS).toISOString(),
        }).eq("id", enr.id);
      }
    }

    return json({ ok: true, ranAt: now.toISOString(), ...summary });
  } catch (e) {
    return json({ error: (e as Error)?.message || String(e), ...summary }, 500);
  }
});
