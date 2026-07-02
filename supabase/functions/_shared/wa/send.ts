// Core send logic shared by the wa-send edge function and wa-scheduler
// (Task 5). Extracted verbatim out of wa-send/index.ts (Task 4) so both can
// call it in-process, mirroring how email-scheduler calls `sendMessageById`
// from `_shared/send.ts` rather than POSTing to email-send's URL.
//
// SANDBOX / LIVE MONITOR COORDINATION: when wa_provider_settings.mode ===
// 'sandbox', sendOneWaMessage synchronously marks the message 'sent' (with a
// synthesized `sandbox-<uuid>` provider_message_id) and inserts one wa_events
// 'sent' row — it deliberately does NOT also synthesize 'delivered'/'read' in
// the same call. wa-scheduler's tick handler advances sandboxed messages
// through delivered -> read on later ticks (detecting them by the
// `sandbox-` provider_message_id prefix synthesized below), so the Live
// Monitor demo shows a realistic status progression over time instead of
// jumping straight to a terminal state in one call.
import { PROVIDERS } from "./registry.ts";
import type { WaSendResult } from "./types.ts";
import { renderTemplate, buildPersonalizationContext } from "./personalize.ts";

// How long a freshly-signed media URL should stay valid. Generated fresh on
// every send attempt (see freshMediaLink below) — long enough to comfortably
// outlast Meta's fetch of the media at send time, short enough to not matter
// if it leaks.
const MEDIA_LINK_TTL_SECONDS = 6 * 60 * 60; // 6 hours

const TERMINAL_SENT_STATUSES = new Set(["sent", "delivered", "read"]);

// ---------------------------------------------------------------------------
// Provider settings resolution: campaign.provider_id first, else the single
// is_active=true row (per plan §2's stated fallback).
// ---------------------------------------------------------------------------
async function resolveProviderSettings(db: any, campaign: any): Promise<any | null> {
  if (campaign?.provider_id) {
    const { data } = await db.from("wa_provider_settings").select("*").eq("id", campaign.provider_id).maybeSingle();
    if (data) return data;
  }
  const { data } = await db.from("wa_provider_settings").select("*").eq("is_active", true).limit(1).maybeSingle();
  return data || null;
}

// ---------------------------------------------------------------------------
// MEDIA FRESHNESS CONTRACT (carry-forward from Task 3's review): wa_messages.media
// only ever stores a `storage_path` snapshot, never a URL. Drip steps can fire
// days after authoring (delay_type='after_days'), so any signed URL captured
// earlier would already be expired by send time. This function regenerates a
// brand-new signed URL from storage_path immediately before every adapter
// call — it is NEVER cached or reused across attempts/retries.
//
// The 'documents' bucket's public/private flag was unconfirmed as of Task 3/4
// (see src/services/waMediaService.js's mediaUrl() caveat comment).
// createSignedUrl works correctly whether the bucket is public or private, so
// it's the safe default here. If the bucket is later confirmed public, this
// can be simplified to:
//   db.storage.from('documents').getPublicUrl(media.storage_path).data.publicUrl
// ---------------------------------------------------------------------------
async function freshMediaLink(db: any, media: any): Promise<string> {
  if (!media?.storage_path) throw new Error("media snapshot is missing storage_path");
  const { data, error } = await db.storage.from("documents").createSignedUrl(media.storage_path, MEDIA_LINK_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(`failed to sign media URL for ${media.storage_path}: ${error?.message || "unknown error"}`);
  }
  return data.signedUrl;
}

/** Records a wa_events row. Exported so wa-scheduler can log the same shape
 * for sandbox delivered/read progression events. */
export async function recordEvent(db: any, message: any, type: string, extra: Record<string, any> = {}) {
  await db.from("wa_events").insert({
    message_id: message.id,
    contact_id: message.contact_id,
    campaign_id: message.campaign_id,
    direction: "outbound",
    type,
    provider_message_id: extra.provider_message_id ?? null,
    raw_payload: extra.raw_payload ?? {},
  });
}

// Marks a message failed/retry_pending. `permanent` skips the retry loop
// entirely (used for config errors like a missing/unimplemented provider,
// where retrying would never succeed without a human fixing the setting).
async function failMessage(db: any, message: any, result: { error?: string; code?: string }, permanent: boolean) {
  const nowIso = new Date().toISOString();

  if (permanent) {
    await db.from("wa_messages").update({
      status: "failed",
      error: result.error ?? null,
      failed_at: nowIso,
    }).eq("id", message.id);
  } else {
    // retry_count < 3 -> retry_pending with exponential backoff (2^retry_count
    // minutes); otherwise permanently failed. Uses the POST-increment value
    // for both the threshold check and the backoff exponent, so attempts are
    // capped at 3 total (retry_count 1, 2, then a 3rd failure trips the else).
    const retryCount = (message.retry_count ?? 0) + 1;
    const willRetry = retryCount < 3;
    await db.from("wa_messages").update({
      status: willRetry ? "retry_pending" : "failed",
      error: result.error ?? null,
      retry_count: retryCount,
      scheduled_for: willRetry ? new Date(Date.now() + Math.pow(2, retryCount) * 60_000).toISOString() : message.scheduled_for,
      failed_at: willRetry ? null : nowIso,
    }).eq("id", message.id);
  }

  await recordEvent(db, message, "failed", { raw_payload: { error: result.error, code: result.code } });
}

/**
 * Core send-one-message logic. Reloads the message fresh from the DB (so
 * repeated calls always see the latest status/retry_count), resolves the
 * provider, and either takes the sandbox shortcut or calls the real adapter.
 * Idempotent: already-sent/delivered/read messages return immediately.
 *
 * This idempotency guard is also what makes wa-scheduler's stale-`sending`
 * sweep and its retry_pending re-drive safe: if a concurrent tick (or the
 * original attempt, which merely lost its response) already flipped the row
 * to sent/delivered/read, this call reloads that fresh status and returns
 * `already_sent: true` instead of sending a second time.
 */
export async function sendOneWaMessage(db: any, messageId: string): Promise<{ ok: boolean; message_id: string; status?: string; error?: string; code?: string; provider_message_id?: string; already_sent?: boolean }> {
  const { data: message, error: msgErr } = await db.from("wa_messages").select("*").eq("id", messageId).single();
  if (msgErr || !message) return { ok: false, message_id: messageId, error: "message not found" };

  if (TERMINAL_SENT_STATUSES.has(message.status)) {
    return { ok: true, message_id: message.id, status: message.status, already_sent: true };
  }

  const { data: campaign } = message.campaign_id
    ? await db.from("wa_campaigns").select("*").eq("id", message.campaign_id).single()
    : { data: null };

  const settings = await resolveProviderSettings(db, campaign);
  if (!settings) {
    const error = "no_active_provider";
    await failMessage(db, message, { error, code: "api_error" }, true);
    return { ok: false, message_id: message.id, error };
  }

  const adapter = PROVIDERS[settings.provider_key];
  if (!adapter) {
    const error = `provider_not_implemented: ${settings.provider_key}`;
    await failMessage(db, message, { error, code: "api_error" }, true);
    return { ok: false, message_id: message.id, error };
  }

  const to = String(message.recipient_number || "").replace(/[^0-9]/g, "");
  if (!to) {
    const error = "missing/invalid recipient_number";
    await failMessage(db, message, { error, code: "invalid_number" }, true);
    return { ok: false, message_id: message.id, error, code: "invalid_number" };
  }

  // ---- Sandbox mode: skip the real HTTP call entirely -------------------
  if (settings.mode === "sandbox") {
    const providerMessageId = `sandbox-${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    await db.from("wa_messages").update({
      status: "sent",
      provider_message_id: providerMessageId,
      sent_at: nowIso,
      error: null,
    }).eq("id", message.id);
    await recordEvent(db, message, "sent", { provider_message_id: providerMessageId, raw_payload: { sandbox: true } });
    return { ok: true, message_id: message.id, status: "sent", provider_message_id: providerMessageId };
  }

  // ---- Live send ----------------------------------------------------------
  await db.from("wa_messages").update({ status: "sending" }).eq("id", message.id);

  let result: WaSendResult;
  try {
    if (message.media) {
      // Regenerate the link fresh, right here, right before the call — see
      // the MEDIA FRESHNESS CONTRACT comment on freshMediaLink above.
      const link = await freshMediaLink(db, message.media);
      // wa_campaign_media.category also allows 'other' (schema check constraint),
      // but Meta's Graph API only accepts image/video/document/audio message
      // types. Coerce 'other' (and any unrecognized category) to 'document'.
      const validMediaTypes = ["image", "video", "document", "audio"];
      const mediaType = validMediaTypes.includes(message.media.category)
        ? message.media.category
        : "document";
      result = await adapter.sendMedia({
        to,
        mediaType,
        link,
        caption: message.body_text || undefined,
        credentials: settings.credentials,
      });
    } else {
      result = await adapter.sendText({ to, body: message.body_text || "", credentials: settings.credentials });
    }
  } catch (e) {
    result = { ok: false, error: (e as Error).message, code: "api_error" };
  }

  if (result.ok) {
    const nowIso = new Date().toISOString();
    await db.from("wa_messages").update({
      status: "sent",
      provider_message_id: result.providerMessageId || null,
      sent_at: nowIso,
      error: null,
    }).eq("id", message.id);
    await recordEvent(db, message, "sent", { provider_message_id: result.providerMessageId, raw_payload: { provider: settings.provider_key } });
    return { ok: true, message_id: message.id, status: "sent", provider_message_id: result.providerMessageId };
  }

  await failMessage(db, message, result, false);
  return { ok: false, message_id: message.id, error: result.error, code: result.code };
}

/**
 * Composes wa_messages row(s) for one (enrollment_id, step_id) pair, then
 * returns them (does NOT send — the caller sends each returned row via
 * sendOneWaMessage). Idempotent at the compose level: if rows already exist
 * for this pair, they're returned as-is instead of duplicating.
 *
 * MODELING CHOICE: a step with N wa_campaign_media rows produces N separate
 * wa_messages rows (one sendMedia call each), all sharing step_id/step_order.
 * Only the FIRST attachment carries the step's personalized body_text as its
 * caption, so a multi-image step doesn't repeat the full message text on
 * every photo — the rest go out as caption-less media. A step with no media
 * produces exactly one text-only wa_messages row.
 */
export async function composeMessagesForStep(db: any, enrollmentId: string, stepId: string): Promise<any[]> {
  const { data: existing } = await db
    .from("wa_messages")
    .select("*")
    .eq("enrollment_id", enrollmentId)
    .eq("step_id", stepId)
    .order("created_at", { ascending: true });
  if (existing && existing.length) return existing;

  const { data: enrollment, error: enrErr } = await db.from("wa_enrollments").select("*").eq("id", enrollmentId).single();
  if (enrErr || !enrollment) throw new Error("enrollment not found");

  const { data: step, error: stepErr } = await db.from("wa_campaign_steps").select("*").eq("id", stepId).single();
  if (stepErr || !step) throw new Error("step not found");

  const { data: campaign } = await db.from("wa_campaigns").select("*").eq("id", enrollment.campaign_id).single();
  const { data: contact, error: contactErr } = await db.from("wa_contacts").select("*").eq("id", enrollment.contact_id).single();
  if (contactErr || !contact) throw new Error("contact not found");

  const ctx = buildPersonalizationContext(contact, campaign);
  const body = renderTemplate(step.body_text || "", ctx);

  const { data: mediaRows } = await db
    .from("wa_campaign_media")
    .select("*")
    .eq("step_id", stepId)
    .order("sort_order", { ascending: true });

  const nowIso = new Date().toISOString();
  const baseRow = {
    enrollment_id: enrollmentId,
    campaign_id: enrollment.campaign_id,
    contact_id: enrollment.contact_id,
    step_id: stepId,
    step_order: step.step_order,
    recipient_number: contact.whatsapp_number,
    status: "queued",
    queued_at: nowIso,
  };

  const rowsToInsert = mediaRows && mediaRows.length
    ? mediaRows.map((m: any, i: number) => ({
        ...baseRow,
        body_text: i === 0 ? body : null,
        media: {
          storage_path: m.storage_path,
          file_name: m.file_name,
          mime_type: m.mime_type,
          category: m.category || "document",
        },
      }))
    : [{ ...baseRow, body_text: body, media: null }];

  const { data: inserted, error: insErr } = await db.from("wa_messages").insert(rowsToInsert).select("*");
  if (insErr) throw new Error(insErr.message);
  return inserted;
}
