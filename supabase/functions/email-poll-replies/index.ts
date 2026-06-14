// Supabase Edge Function: email-poll-replies
//
// Reply detection / sequence stop. Invoked by pg_cron (every ~15 min). For each
// connected Gmail sender it lists recent INBOX threads (inbound = replies),
// matches them to active enrollments by gmail_thread_id, records a 'replied'
// event, and — when the campaign has stop_on_reply — halts that enrollment.
//
// Needs the gmail.readonly scope (requested by the Connect Gmail flow) and:
//   supabase functions deploy email-poll-replies
//   secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (SUPABASE_* auto-injected)
//
// Optional auth: SCHEDULER_SECRET via the x-scheduler-secret header.
import { preflight, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/db.ts";
import { getFreshToken } from "../_shared/send.ts";
import { gmailInboundThreadIds } from "../_shared/gmail.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  const secret = Deno.env.get("SCHEDULER_SECRET");
  if (secret && req.headers.get("x-scheduler-secret") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  let db: any;
  try { db = serviceClient(); } catch (e) { return json({ error: (e as Error).message }, 500); }

  const summary = { accounts: 0, threadsScanned: 0, replied: 0, errors: 0 };

  try {
    // Active enrollments on a thread, with their campaign's sender + stop_on_reply.
    const { data: enrollments, error } = await db
      .from("email_enrollments")
      .select("id, contact_id, campaign_id, gmail_thread_id, campaign:email_campaigns(sending_account_id, stop_on_reply)")
      .eq("status", "active")
      .not("gmail_thread_id", "is", null);
    if (error) return json({ error: error.message }, 500);

    // group enrollments by sending account
    const byAccount = new Map<string, any[]>();
    for (const e of (enrollments ?? [])) {
      const accId = e.campaign?.sending_account_id;
      if (!accId) continue;
      if (!byAccount.has(accId)) byAccount.set(accId, []);
      byAccount.get(accId).push(e);
    }

    for (const [accountId, list] of byAccount) {
      summary.accounts++;
      const { data: account } = await db.from("email_accounts").select("*").eq("id", accountId).single();
      if (!account || account.status === "revoked") continue;

      let token: string;
      try {
        token = await getFreshToken(db, account);
      } catch (e) {
        summary.errors++;
        await db.from("email_accounts").update({ status: "expired", last_error: (e as Error).message }).eq("id", account.id);
        continue;
      }

      let inboundThreads: Set<string>;
      try {
        inboundThreads = await gmailInboundThreadIds(token);
      } catch (e) {
        summary.errors++;
        continue;
      }
      summary.threadsScanned += inboundThreads.size;

      for (const enr of list) {
        if (!inboundThreads.has(enr.gmail_thread_id)) continue;
        const now = new Date().toISOString();
        const stop = enr.campaign?.stop_on_reply !== false;

        await db.from("email_enrollments").update({
          ...(stop ? { status: "replied", next_send_at: null } : {}),
          replied_at: now,
        }).eq("id", enr.id);

        // mark the latest sent message on this enrollment as replied
        await db.from("email_messages").update({ replied_at: now })
          .eq("enrollment_id", enr.id).eq("status", "sent").is("replied_at", null);

        await db.from("email_events").insert({
          contact_id: enr.contact_id, campaign_id: enr.campaign_id,
          type: "replied", meta: { thread_id: enr.gmail_thread_id, stopped: stop },
        });
        summary.replied++;
      }
    }

    return json({ ok: true, ...summary });
  } catch (e) {
    return json({ error: (e as Error)?.message || String(e), ...summary }, 500);
  }
});
