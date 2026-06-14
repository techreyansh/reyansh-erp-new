// Supabase Edge Function: ppc-emit
//
// Outbound master sync, ERP → PPC (spec §5.1 path A, §7.2). When a Customer /
// Item / Supplier changes in the ERP, this pushes a signed webhook to the PPC
// backend so masters mirror within seconds (the ?since= poll in ppc-integration
// is the fallback path B).
//
// Invoke (from the ERP app "Sync now" button, or a DB trigger via pg_net):
//   POST { entity: "customer"|"item"|"supplier", id: "<row uuid>", action?: "upsert" }
//   POST { entity: "customer", all: true }     // re-emit every active row (initial seed)
//
// Auth to PPC: X-API-Key (PPC_OUTBOUND_API_KEY) + HMAC body signature (§7.2).
//
// Deploy:
//   supabase functions deploy ppc-emit
//   supabase secrets set PPC_BASE_URL=https://ppc.reyansh.in/api/v1 \
//                        PPC_OUTBOUND_API_KEY=<key PPC accepts> \
//                        PPC_WEBHOOK_SECRET=<shared HMAC secret>
import { serviceClient } from "../_shared/db.ts";
import { signWebhook, logSync, mapCustomer, mapSupplier, mapItem } from "../_shared/ppc.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const SOURCES: Record<string, { table: string; select: string; mapper: (r: any) => any; webhook: string }> = {
  customer: { table: "clients2", select: "*", mapper: mapCustomer, webhook: "customer" },
  supplier: { table: "vendors_data", select: "*", mapper: mapSupplier, webhook: "supplier" },
  item: { table: "products", select: "*, units_of_measure:unit_of_measure_id(code)", mapper: mapItem, webhook: "item" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const base = Deno.env.get("PPC_BASE_URL");
  const outKey = Deno.env.get("PPC_OUTBOUND_API_KEY");
  if (!base || !outKey) return json({ error: "PPC_BASE_URL / PPC_OUTBOUND_API_KEY are not configured on this function." }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const src = SOURCES[body.entity];
  if (!src) return json({ error: `entity must be one of ${Object.keys(SOURCES).join(", ")}` }, 400);

  let db: any;
  try { db = serviceClient(); } catch (e) { return json({ error: (e as Error).message }, 500); }

  // Gather the rows to emit.
  let rows: any[] = [];
  if (body.all) {
    const { data, error } = await db.from(src.table).select(src.select).limit(5000);
    if (error) return json({ error: error.message }, 500);
    rows = data || [];
  } else if (body.id) {
    const { data, error } = await db.from(src.table).select(src.select).eq("id", body.id).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: `${body.entity} ${body.id} not found` }, 404);
    rows = [data];
  } else {
    return json({ error: "Provide id (single) or all:true (bulk)" }, 400);
  }

  const action = body.action || "upsert";
  let ok = 0, failed = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const mapped = src.mapper(row);
    const payload = { action, [body.entity]: mapped };
    const bodyText = JSON.stringify(payload);
    const started = Date.now();
    try {
      const { signature, timestamp } = await signWebhook(bodyText);
      const resp = await fetch(`${base.replace(/\/$/, "")}/erp/webhook/${src.webhook}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": outKey,
          "X-ERP-Signature": signature,
          "X-ERP-Timestamp": timestamp,
          "Idempotency-Key": `${body.entity}:${mapped.erp_id}:${mapped.updated_at}`,
        },
        body: bodyText,
      });
      const text = await resp.text().catch(() => "");
      if (resp.ok) ok++; else { failed++; errors.push(`${mapped.code || mapped.erp_id}: ${resp.status} ${text.slice(0, 120)}`); }
      await logSync(db, {
        direction: "outbound", entity: body.entity, erp_ref: mapped.code || mapped.erp_id,
        request_body: payload, http_status: resp.status, status: resp.ok ? "success" : "failure",
        response_body: text ? safeJson(text) : null, duration_ms: Date.now() - started,
      });
    } catch (e) {
      failed++; errors.push(`${mapped.code || mapped.erp_id}: ${(e as Error).message}`);
      await logSync(db, { direction: "outbound", entity: body.entity, erp_ref: mapped.code || mapped.erp_id, request_body: payload, status: "failure", response_body: { error: (e as Error).message }, duration_ms: Date.now() - started });
    }
  }

  // Advance the outbound watermark for this entity.
  await db.from("sync_state").upsert({ entity: `out_${body.entity}`, last_synced_at: new Date().toISOString(), total_records: ok }, { onConflict: "entity" });

  return json({ entity: body.entity, action, emitted: rows.length, ok, failed, errors: errors.slice(0, 20) });
});

function safeJson(t: string): unknown { try { return JSON.parse(t); } catch { return { raw: t.slice(0, 500) }; } }
