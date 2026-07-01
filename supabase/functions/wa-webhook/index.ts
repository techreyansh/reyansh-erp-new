// Supabase Edge Function: wa-webhook
//
// Public, unauthenticated receiver for the active WhatsApp Business Solution
// Provider's webhook (only `meta_cloud` has a real adapter in V1 — see
// PROVIDERS['meta_cloud'] in ../_shared/wa/registry.ts). Handles:
//   GET  - Meta's webhook subscription verification handshake
//   POST - inbound message + delivery-status callbacks
//
// MUST be deployed public (Meta's servers can't hold a Supabase JWT), same
// pattern as ../email-track-open/index.ts:
//   supabase functions deploy wa-webhook --no-verify-jwt
//
// PROVIDER-ABSTRACTION RULE (tasks-plan.md Global Constraints): this file
// never hand-parses graph.facebook.com's payload shape. It only calls
// PROVIDERS['meta_cloud'].verifyWebhookGet() / .parseWebhookEvents() —
// ../_shared/wa/meta.ts's own header comments say those two methods exist
// specifically so this function calls them directly instead of
// reimplementing Meta's handshake/webhook-body parsing here.
//
// FIELD-NAME NOTE: the Task 6 brief describes the stored verification secret
// as `wa_provider_settings.credentials.webhook_verify_token`, but the
// already-committed meta_cloud adapter (Task 4, _shared/wa/meta.ts
// `verifyWebhookGet`) reads `credentials?.verify_token`. Rather than forking
// the contract (a second field name, or editing Task 4's shipped/reviewed
// adapter for a naming preference), this function follows the adapter's
// existing, documented contract: store the Meta App Dashboard's verify token
// as `verify_token` inside the active meta_cloud row's
// `wa_provider_settings.credentials` jsonb. See WHATSAPP_MARKETING_SETUP.md
// for the exact setup steps.
import { preflight, CORS } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/db.ts";
import { PROVIDERS } from "../_shared/wa/registry.ts";
import type { NormalizedWaEvent, WaAdapter } from "../_shared/wa/types.ts";

// meta_cloud is always registered in registry.ts — this guard only protects
// against a future registry refactor accidentally dropping it. Re-asserted as
// non-null (rather than relying on TS control-flow narrowing, which doesn't
// carry a module-level const's narrowed type into nested function closures)
// because the runtime check above already guarantees it.
if (!PROVIDERS["meta_cloud"]) {
  throw new Error("wa-webhook: PROVIDERS['meta_cloud'] adapter is not registered");
}
const META = PROVIDERS["meta_cloud"] as WaAdapter;

// Status-callback event types map onto a specific wa_messages timestamp column.
// 'reply' (inbound) and 'other' (an unrecognized status sub-type from Meta)
// intentionally have no entry — neither one updates a wa_messages row's
// status/timestamp.
const TIMESTAMP_COLUMN: Record<string, string> = {
  sent: "sent_at",
  delivered: "delivered_at",
  read: "read_at",
  failed: "failed_at",
};

// Forward-progression rank so a late/duplicate/out-of-order status webhook
// (Meta retries aggressively and delivery order across statuses is not
// guaranteed) never regresses an already-more-advanced wa_messages.status —
// e.g. a delayed 'sent' arriving after 'read' was already recorded.
const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { ...CORS, "Content-Type": "text/plain" } });
}

// ---------------------------------------------------------------------------
// GET — Meta's webhook subscription verification handshake
// ---------------------------------------------------------------------------
async function handleGet(req: Request, db: any): Promise<Response> {
  const url = new URL(req.url);
  try {
    const { data: settings } = await db
      .from("wa_provider_settings")
      .select("credentials")
      .eq("is_active", true)
      .eq("provider_key", "meta_cloud")
      .maybeSingle();

    if (!settings || !META.verifyWebhookGet) return textResponse("Forbidden", 403);

    const verified = META.verifyWebhookGet(url, settings.credentials);
    if (verified) return verified; // raw hub.challenge body, status 200 — set by the adapter
    return textResponse("Forbidden", 403);
  } catch (e) {
    console.error("wa-webhook GET handshake error:", (e as Error).message);
    return textResponse("Forbidden", 403);
  }
}

// ---------------------------------------------------------------------------
// POST — inbound messages + delivery-status callbacks
// ---------------------------------------------------------------------------
function extractErrorMessage(raw: any): string | undefined {
  const err = Array.isArray(raw?.errors) ? raw.errors[0] : undefined;
  return err?.message || err?.title || undefined;
}

// Best-effort, case-insensitive contact match against wa_contacts.whatsapp_number
// (the schema carries `unique index on lower(whatsapp_number)`). ilike with no
// wildcard characters in fromNumber is a case-insensitive exact match. This is
// row enrichment only — never blocks the inbound wa_events insert if it misses
// or errors.
async function findContactIdByNumber(db: any, fromNumber?: string): Promise<string | null> {
  if (!fromNumber) return null;
  try {
    const { data } = await db
      .from("wa_contacts")
      .select("id")
      .ilike("whatsapp_number", fromNumber)
      .limit(1)
      .maybeSingle();
    return data?.id ?? null;
  } catch (e) {
    console.error("wa-webhook: contact lookup failed:", (e as Error).message);
    return null;
  }
}

async function handleStatusEvent(db: any, event: NormalizedWaEvent): Promise<void> {
  let message: any = null;
  if (event.providerMessageId) {
    const { data } = await db
      .from("wa_messages")
      .select("id, contact_id, campaign_id, status")
      .eq("provider_message_id", event.providerMessageId)
      .maybeSingle();
    message = data ?? null;
  }

  const timestampCol = TIMESTAMP_COLUMN[event.type];
  if (message && timestampCol) {
    const currentRank = STATUS_RANK[message.status] ?? 0;
    const incomingRank = STATUS_RANK[event.type] ?? 0;
    if (incomingRank >= currentRank) {
      const updates: Record<string, any> = { status: event.type, [timestampCol]: new Date().toISOString() };
      if (event.type === "failed") {
        const errMsg = extractErrorMessage(event.raw);
        if (errMsg) updates.error = errMsg;
      }
      await db.from("wa_messages").update(updates).eq("id", message.id);
    }
  }

  await db.from("wa_events").insert({
    message_id: message?.id ?? null,
    contact_id: message?.contact_id ?? null,
    campaign_id: message?.campaign_id ?? null,
    direction: "outbound",
    type: event.type,
    provider_message_id: event.providerMessageId ?? null,
    from_number: event.fromNumber ?? null,
    raw_payload: event.raw ?? {},
  });
}

async function handleInboundEvent(db: any, event: NormalizedWaEvent): Promise<void> {
  const contactId = await findContactIdByNumber(db, event.fromNumber);
  await db.from("wa_events").insert({
    message_id: null,
    contact_id: contactId,
    campaign_id: null,
    direction: "inbound",
    type: "reply",
    provider_message_id: event.providerMessageId ?? null,
    from_number: event.fromNumber ?? null,
    raw_payload: event.raw ?? {},
  });
}

async function handlePost(req: Request, db: any): Promise<Response> {
  // Meta retries aggressively on non-200/timeout, so this handler always
  // returns 200 (even on a malformed body or a parse/processing failure) —
  // errors are logged, never thrown back to the caller.
  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    console.error("wa-webhook: invalid JSON body:", (e as Error).message);
    return textResponse("EVENT_RECEIVED", 200);
  }

  let events: NormalizedWaEvent[] = [];
  try {
    events = META.parseWebhookEvents(body) || [];
  } catch (e) {
    console.error("wa-webhook: parseWebhookEvents failed:", (e as Error).message);
    return textResponse("EVENT_RECEIVED", 200);
  }

  for (const event of events) {
    try {
      if (event.type === "reply") {
        await handleInboundEvent(db, event);
      } else {
        await handleStatusEvent(db, event);
      }
    } catch (e) {
      // Per-event isolation: one bad event must never fail the whole batch.
      console.error("wa-webhook: failed to process event", event?.type, (e as Error).message);
    }
  }

  return textResponse("EVENT_RECEIVED", 200);
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  let db: any;
  try {
    db = serviceClient();
  } catch (e) {
    console.error("wa-webhook: serviceClient init failed:", (e as Error).message);
    // POST must still 200 (Meta retry-storm avoidance); GET can surface the error.
    if (req.method === "POST") return textResponse("EVENT_RECEIVED", 200);
    return textResponse("Internal Server Error", 500);
  }

  if (req.method === "GET") return handleGet(req, db);
  if (req.method === "POST") return handlePost(req, db);
  return textResponse("Method Not Allowed", 405);
});
