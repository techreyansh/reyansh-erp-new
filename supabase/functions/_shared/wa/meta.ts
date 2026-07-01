// Meta WhatsApp Cloud API adapter — the only real WaAdapter implementation in
// V1. This is the abstracted version of the calling convention already proven
// (hardcoded) in supabase/functions/task-notify/index.ts: same Graph API URL
// shape, same Bearer auth header, same messaging_product/type/text|<media> body
// shapes. Do not add any other provider's HTTP calls to this file — one
// adapter per file, registered in registry.ts.
import type { WaAdapter, WaSendResult, NormalizedWaEvent } from "./types.ts";

const GRAPH_API_VERSION = "v20.0";

// ---------------------------------------------------------------------------
// Meta/WhatsApp Cloud API error-code classification
//
// These numeric codes are corroborated across multiple third-party
// integrator docs (fetched 2026-07-01, Meta's own error-codes page returned
// truncated content when fetched directly from this environment):
//   - Kaleyra "Cloud API Error Codes": https://developers.kaleyra.io/docs/cloud-api-error-codes
//   - Heltar "All Meta WhatsApp Cloud API Error Codes Explained" (2025)
//   - Sanoflow "Most Common WhatsApp Business API Error codes"
//
//   0       AuthException - token invalid/can't be verified
//   190     Access token has expired / is invalid
//   10      Permission denied - required permission not granted
//   131009  Parameter value not valid - most commonly an invalid/unregistered
//           recipient phone number
//   131026  Message undeliverable - recipient not on WhatsApp / has declined ToS
//   4       Application request limit reached
//   80007   WhatsApp Business Account rate limit hit
//   130429  Rate limit hit - Cloud API message throughput cap
//   131048  Spam rate limit hit
//   131052  Media download error - unsupported media type
//   131053  Media upload error - unsupported media type
//
// Anything not in these sets falls through to a heuristic on HTTP status /
// error.type (documented inline below), then finally to 'api_error' as a
// safe, non-invented default — per the task brief, we are NOT inventing
// specific numeric codes we couldn't corroborate.
const AUTH_FAILED_CODES = new Set([0, 190, 10]);
const INVALID_NUMBER_CODES = new Set([131009, 131026]);
const RATE_LIMITED_CODES = new Set([4, 80007, 130429, 131048]);
const MEDIA_FAILED_CODES = new Set([131052, 131053]);

function classifyMetaError(body: any, httpStatus: number): { code: WaSendResult["code"]; message: string } {
  const err = body?.error || {};
  const numCode = typeof err.code === "number" ? err.code : undefined;
  const message = err.error_user_msg || err.message || `Meta Graph API error (HTTP ${httpStatus})`;

  if (numCode !== undefined) {
    if (AUTH_FAILED_CODES.has(numCode)) return { code: "auth_failed", message };
    if (INVALID_NUMBER_CODES.has(numCode)) return { code: "invalid_number", message };
    if (RATE_LIMITED_CODES.has(numCode)) return { code: "rate_limited", message };
    if (MEDIA_FAILED_CODES.has(numCode)) return { code: "media_upload_failed", message };
  }

  // Heuristic fallback (documented, not authoritative): Meta returns 401 for
  // most auth problems and 429 when literally rate-limited at the transport
  // layer; error.type === 'OAuthException' is Graph API's generic auth error
  // family regardless of the numeric subcode we didn't recognize above.
  if (httpStatus === 401 || err.type === "OAuthException") return { code: "auth_failed", message };
  if (httpStatus === 429) return { code: "rate_limited", message };

  return { code: "api_error", message };
}

export class MetaCloudApiAdapter implements WaAdapter {
  key = "meta_cloud";

  private async post(credentials: any, body: any): Promise<WaSendResult> {
    const phoneNumberId = credentials?.phone_number_id;
    const token = credentials?.access_token;
    if (!phoneNumberId || !token) {
      return {
        ok: false,
        error: "meta_cloud credentials missing phone_number_id / access_token",
        code: "auth_failed",
      };
    }

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return { ok: false, error: `network error calling Meta Graph API: ${(e as Error).message}`, code: "api_error" };
    }

    let json: any = null;
    try { json = await res.json(); } catch { /* non-JSON body, e.g. empty response */ }

    if (res.ok && json?.messages?.[0]?.id) {
      return { ok: true, providerMessageId: json.messages[0].id };
    }

    const { code, message } = classifyMetaError(json, res.status);
    return { ok: false, error: message, code };
  }

  async sendText(args: { to: string; body: string; credentials: any }): Promise<WaSendResult> {
    return this.post(args.credentials, {
      messaging_product: "whatsapp",
      to: args.to,
      type: "text",
      text: { body: args.body },
    });
  }

  async sendMedia(args: {
    to: string;
    mediaType: "image" | "video" | "document" | "audio";
    link: string;
    caption?: string;
    credentials: any;
  }): Promise<WaSendResult> {
    const mediaObj: Record<string, string> = { link: args.link };
    if (args.caption) mediaObj.caption = args.caption;
    return this.post(args.credentials, {
      messaging_product: "whatsapp",
      to: args.to,
      type: args.mediaType,
      [args.mediaType]: mediaObj,
    });
  }

  /**
   * Meta's webhook subscription verification handshake. Not exercised by
   * wa-send (Task 4 doesn't stand up a webhook route) — implemented here
   * because it's part of this adapter's real contract and Task 6's webhook
   * receiver will call PROVIDERS['meta_cloud'].verifyWebhookGet() directly
   * rather than reimplementing Meta's handshake itself.
   */
  verifyWebhookGet(url: URL, credentials: any): Response | null {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && challenge && token && token === credentials?.verify_token) {
      return new Response(challenge, { status: 200 });
    }
    return null;
  }

  /**
   * Normalizes Meta's webhook POST shape:
   *   entry[].changes[].value.statuses[]  -> delivery/read/failed/sent receipts
   *   entry[].changes[].value.messages[]  -> inbound replies
   * into a flat NormalizedWaEvent[]. Reserved for Task 6's webhook receiver;
   * not called from wa-send.
   */
  parseWebhookEvents(payload: any): NormalizedWaEvent[] {
    const events: NormalizedWaEvent[] = [];
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value || {};
        for (const st of value.statuses || []) {
          const type = ["sent", "delivered", "read", "failed"].includes(st?.status) ? st.status : "other";
          events.push({ type, providerMessageId: st?.id, fromNumber: st?.recipient_id, raw: st });
        }
        for (const m of value.messages || []) {
          events.push({ type: "reply", providerMessageId: m?.id, fromNumber: m?.from, raw: m });
        }
      }
    }
    return events;
  }
}
