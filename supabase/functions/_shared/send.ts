// Core send logic shared by the email-send function and the scheduler.
// Sends one email_messages row through its campaign's linked Gmail account and
// records the result (message / enrollment / contact / account + email_events).
import { refreshAccessToken, buildMime, sendGmail } from "./gmail.ts";

const todayStr = () => new Date().toISOString().slice(0, 10);

export async function getFreshToken(db: any, account: any): Promise<string> {
  const stillValid = account.access_token && account.token_expires_at &&
    new Date(account.token_expires_at).getTime() - Date.now() > 60_000;
  if (stillValid) return account.access_token;

  if (!account.refresh_token) {
    throw new Error(`Gmail account ${account.email} has no refresh token — reconnect it.`);
  }
  const { accessToken, expiresAt } = await refreshAccessToken(account.refresh_token);
  await db.from("email_accounts")
    .update({ access_token: accessToken, token_expires_at: expiresAt, status: "connected" })
    .eq("id", account.id);
  return accessToken;
}

async function bumpDailyCounter(db: any, account: any) {
  const sameDay = account.sent_today_date === todayStr();
  await db.from("email_accounts").update({
    sent_today: (sameDay ? account.sent_today : 0) + 1,
    sent_today_date: todayStr(),
  }).eq("id", account.id);
}

export type SendResult =
  | { ok: true; gmail_message_id: string; gmail_thread_id: string; already_sent?: boolean }
  | { ok: false; error: string; code?: string; status?: number };

// Send a one-off test email from a given account.
export async function sendTest(db: any, args: {
  account_id: string; to: string; subject?: string; body?: string;
}): Promise<SendResult> {
  const { data: account, error } = await db.from("email_accounts").select("*").eq("id", args.account_id).single();
  if (error || !account) return { ok: false, error: "Sending account not found", status: 404 };

  try {
    const token = await getFreshToken(db, account);
    const mime = buildMime({
      to: args.to,
      fromEmail: account.email,
      fromName: account.display_name,
      subject: args.subject || "Test from Reyansh ERP",
      body: args.body || "This is a test email from your Reyansh ERP email module.",
    });
    const sent = await sendGmail({ accessToken: token, mime });
    return { ok: true, gmail_message_id: sent.id, gmail_thread_id: sent.threadId };
  } catch (e) {
    return { ok: false, error: (e as Error).message, status: 502 };
  }
}

// Send a real campaign message by id. Idempotent on already-sent rows.
export async function sendMessageById(db: any, messageId: string): Promise<SendResult> {
  const { data: msg, error: msgErr } = await db.from("email_messages").select("*").eq("id", messageId).single();
  if (msgErr || !msg) return { ok: false, error: "Message not found", status: 404 };
  if (msg.status === "sent") {
    return { ok: true, already_sent: true, gmail_message_id: msg.gmail_message_id, gmail_thread_id: msg.gmail_thread_id };
  }

  const { data: campaign } = await db.from("email_campaigns").select("*").eq("id", msg.campaign_id).single();
  if (!campaign) return { ok: false, error: "Campaign not found for message", status: 404 };
  if (!campaign.sending_account_id) return { ok: false, error: "Campaign has no linked sending account", status: 400 };

  const { data: account, error: accErr } = await db.from("email_accounts")
    .select("*").eq("id", campaign.sending_account_id).single();
  if (accErr || !account) return { ok: false, error: "Sending account not found", status: 404 };

  // daily cap guard
  const sentToday = account.sent_today_date === todayStr() ? account.sent_today : 0;
  if (sentToday >= (campaign.daily_send_cap ?? 200)) {
    return { ok: false, error: "daily_cap_reached", code: "daily_cap_reached", status: 429 };
  }

  const { data: enrollment } = msg.enrollment_id
    ? await db.from("email_enrollments").select("*").eq("id", msg.enrollment_id).single()
    : { data: null };

  await db.from("email_messages").update({ status: "sending" }).eq("id", msg.id);

  let token: string;
  try {
    token = await getFreshToken(db, account);
  } catch (e) {
    await db.from("email_accounts").update({ status: "expired", last_error: (e as Error).message }).eq("id", account.id);
    await db.from("email_messages").update({
      status: "failed", error: (e as Error).message, retry_count: (msg.retry_count ?? 0) + 1,
    }).eq("id", msg.id);
    return { ok: false, error: (e as Error).message, status: 502 };
  }

  // Open tracking (opt-in per campaign): inject a 1x1 pixel pointing at the
  // public email-track-open function, keyed by this message id.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const trackOpenUrl = campaign.track_opens && supabaseUrl
    ? `${supabaseUrl}/functions/v1/email-track-open?m=${msg.id}`
    : null;

  const mime = buildMime({
    to: msg.to_email,
    fromEmail: account.email,
    fromName: campaign.from_name || account.display_name,
    subject: msg.subject,
    body: msg.body,
    trackOpenUrl,
  });

  try {
    const sent = await sendGmail({
      accessToken: token,
      mime,
      threadId: enrollment?.gmail_thread_id || msg.gmail_thread_id || null,
    });

    await db.from("email_messages").update({
      status: "sent",
      sent_at: new Date().toISOString(),
      gmail_message_id: sent.id,
      gmail_thread_id: sent.threadId,
      error: null,
    }).eq("id", msg.id);

    if (enrollment) {
      await db.from("email_enrollments").update({
        gmail_thread_id: enrollment.gmail_thread_id || sent.threadId,
        last_sent_at: new Date().toISOString(),
      }).eq("id", enrollment.id);
    }
    if (msg.contact_id) {
      await db.from("email_contacts").update({ last_contacted_at: new Date().toISOString() }).eq("id", msg.contact_id);
    }
    await bumpDailyCounter(db, account);
    await db.from("email_events").insert({
      message_id: msg.id, contact_id: msg.contact_id, campaign_id: msg.campaign_id,
      type: "sent", meta: { gmail_message_id: sent.id },
    });

    return { ok: true, gmail_message_id: sent.id, gmail_thread_id: sent.threadId };
  } catch (e) {
    await db.from("email_messages").update({
      status: "failed", error: (e as Error).message, retry_count: (msg.retry_count ?? 0) + 1,
    }).eq("id", msg.id);
    return { ok: false, error: (e as Error).message, status: 502 };
  }
}
