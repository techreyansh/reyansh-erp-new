// Shared helpers for the PPC ↔ ERP integration Edge Functions.
//
// Covers: API-key auth (PPC → ERP), HMAC webhook signing (ERP → PPC),
// idempotency, sync_log audit, and the ERP→PPC field mappers per the
// "PPC ↔ ERP Integration Spec v1.0" (§3.2, §6).

// ---------------------------------------------------------------------------
// Auth (spec §4.1.1 / §7): PPC authenticates to the ERP with X-API-Key.
// ---------------------------------------------------------------------------
export function checkApiKey(req: Request): boolean {
  const expected = Deno.env.get("PPC_API_KEY");
  if (!expected) return false; // fail closed if the secret isn't configured
  const got = req.headers.get("x-api-key") || req.headers.get("X-API-Key");
  return !!got && got === expected;
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 webhook signature (spec §7.2) for ERP → PPC outbound calls.
// Returns { signature, timestamp } to send as x-erp-signature / x-erp-timestamp.
// ---------------------------------------------------------------------------
export async function signWebhook(bodyText: string): Promise<{ signature: string; timestamp: string }> {
  const secret = Deno.env.get("PPC_WEBHOOK_SECRET") || "";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = `${timestamp}.${bodyText}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const signature = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { signature, timestamp };
}

// Deterministic sha256 hex (used for derived idempotency keys, spec §6.4).
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Idempotency (spec §4.2.3): same key → same stored response, no re-apply.
// ---------------------------------------------------------------------------
export async function getStoredIdempotent(db: any, key: string) {
  if (!key) return null;
  const { data } = await db.from("sync_idempotency").select("*").eq("idempotency_key", key).maybeSingle();
  return data || null;
}

export async function storeIdempotent(
  db: any,
  key: string,
  entity: string,
  ppcRef: string | null,
  responseBody: unknown,
  httpStatus: number,
) {
  if (!key) return;
  await db.from("sync_idempotency").upsert(
    {
      idempotency_key: key,
      entity,
      ppc_ref: ppcRef,
      response_body: responseBody,
      http_status: httpStatus,
    },
    { onConflict: "idempotency_key" },
  );
}

// ---------------------------------------------------------------------------
// Audit log (spec §6.2) — best-effort; never throws into the request path.
// ---------------------------------------------------------------------------
export async function logSync(db: any, row: {
  direction: "inbound" | "outbound";
  entity: string;
  ppc_ref?: string | null;
  erp_ref?: string | null;
  request_body?: unknown;
  response_body?: unknown;
  http_status?: number;
  status: "success" | "failure" | "retry" | "dead_letter";
  idempotency_key?: string | null;
  duration_ms?: number;
}) {
  try {
    await db.from("sync_log").insert({
      direction: row.direction,
      entity: row.entity,
      ppc_ref: row.ppc_ref ?? null,
      erp_ref: row.erp_ref ?? null,
      request_body: row.request_body ?? null,
      response_body: row.response_body ?? null,
      http_status: row.http_status ?? null,
      status: row.status,
      idempotency_key: row.idempotency_key ?? null,
      duration_ms: row.duration_ms ?? null,
    });
  } catch (_e) {
    // logging must never break the actual operation
  }
}

// ---------------------------------------------------------------------------
// ERP → PPC master mappers (spec §3.2.1 / §3.2.2)
// ---------------------------------------------------------------------------

// clients2 row → PPC customer shape
export function mapCustomer(r: any) {
  return {
    erp_id: r.id,
    code: r.ClientCode ?? null,
    name: r.ClientName ?? null,
    city: r.City ?? null,
    credit_days: toInt(r.CreditPeriod),
    gst: r.GSTIN ?? null,
    payment_terms: r.PaymentTerms ?? null,
    active: String(r.Status ?? "Active").toLowerCase() !== "inactive",
    updated_at: r.updated_at ?? r.created_at ?? null,
  };
}

// vendors_data row → PPC supplier shape
export function mapSupplier(r: any) {
  const rec = r.record || {};
  return {
    erp_id: r.id,
    code: r["Vendor Code"] ?? rec["Vendor Code"] ?? null,
    name: r["Vendor Name"] ?? rec["Vendor Name"] ?? null,
    gst: r.GSTIN ?? rec.GSTIN ?? null,
    payment_terms: r["Payment Terms"] ?? rec["Payment Terms"] ?? null,
    lead_days: toInt(r["Lead Time (Days)"] ?? rec["Lead Time (Days)"]),
    active: true,
    updated_at: r.updated_at ?? r.created_at ?? null,
  };
}

// products row (+ joined uom) → PPC item shape. "(NEW)" fields live in record jsonb.
export function mapItem(r: any) {
  const rec = r.record || {};
  const uom = r.units_of_measure?.code || rec.uom || null;
  return {
    erp_id: r.id,
    code: r.code ?? null,
    desc: r.description ?? r.name ?? null,
    type: rec.type ?? rec.item_type ?? null,        // RM / SFG / FG
    line: rec.product_line ?? rec.line ?? null,
    uom,
    lead_days: toInt(rec.lead_time_days ?? rec.lead_days),
    min_stock: toNum(rec.min_stock),
    std_cost: toNum(rec.std_cost ?? rec.std_cost_inr),
    gl_account: rec.gl_account ?? null,
    tax_rate_pct: toNum(rec.tax_rate_pct),
    hsn_code: rec.hsn_code ?? null,
    active: r.deleted_at == null,
    updated_at: r.updated_at ?? r.created_at ?? null,
  };
}

function toInt(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}
function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// HTTP error classification helper for the inbound writers (spec §8.2).
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
