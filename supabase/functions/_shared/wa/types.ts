// Shared provider-adapter interfaces for the WhatsApp Marketing module.
//
// Architectural rule (see tasks-plan.md Global Constraints + plan §2): no file
// outside supabase/functions/_shared/wa/* and supabase/functions/wa-send/index.ts
// may call a WhatsApp provider's HTTP API directly. Every provider integration
// must implement WaAdapter and be registered in registry.ts — callers (wa-send,
// and later wa-scheduler/wa-webhook) only ever talk to the WaAdapter interface,
// never to a provider SDK/REST endpoint directly.

/** Result of a single outbound send call (text or media) through an adapter. */
export interface WaSendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  /**
   * Coarse failure classification used by wa-send to decide retry/backoff
   * vs. permanent failure. One of:
   *   'invalid_number'       - recipient is not a valid/reachable WhatsApp number
   *   'auth_failed'          - credentials/token invalid, expired, or unauthorized
   *   'rate_limited'         - provider/app throughput or rate limit hit (retryable)
   *   'media_upload_failed'  - the media link/type could not be fetched or is unsupported
   *   'api_error'            - anything else (network error, unclassified provider error)
   */
  code?: 'invalid_number' | 'auth_failed' | 'rate_limited' | 'media_upload_failed' | 'api_error';
}

/** A provider webhook event, normalized to a common shape regardless of provider. */
export interface NormalizedWaEvent {
  type: 'sent' | 'delivered' | 'read' | 'failed' | 'reply' | 'other';
  providerMessageId?: string;
  fromNumber?: string;
  /** The raw, unmodified per-event payload fragment from the provider, kept for wa_events.raw_payload. */
  raw: any;
}

/**
 * The contract every WhatsApp Business Solution Provider (BSP) integration
 * must implement. `credentials` is always the opaque `wa_provider_settings.credentials`
 * jsonb for the active/resolved provider row — each adapter interprets its own
 * shape (e.g. meta_cloud expects { phone_number_id, access_token }).
 */
export interface WaAdapter {
  /** Must match a `wa_provider_settings.provider_key` value (and the registry.ts key). */
  key: string;

  sendText(args: { to: string; body: string; credentials: any }): Promise<WaSendResult>;

  sendMedia(args: {
    to: string;
    mediaType: 'image' | 'video' | 'document' | 'audio';
    link: string;
    caption?: string;
    credentials: any;
  }): Promise<WaSendResult>;

  /**
   * Optional: handles a provider's webhook verification handshake (e.g. Meta's
   * GET .../webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...).
   * Return a Response to short-circuit the caller's handler, or null if this
   * request isn't a verification handshake. Not used by wa-send (Task 4) —
   * reserved for the webhook receiver (Task 6).
   */
  verifyWebhookGet?(url: URL, credentials: any): Response | null;

  /** Normalizes a provider's webhook POST body into a flat array of events. */
  parseWebhookEvents(payload: any): NormalizedWaEvent[];
}
