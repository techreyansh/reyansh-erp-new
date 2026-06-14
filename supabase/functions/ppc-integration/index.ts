// Supabase Edge Function: ppc-integration
//
// The ERP's half of the "PPC ↔ ERP Integration Spec v1.0" (§4.2).
// PPC (the Production Planning & Control backend) calls these endpoints with an
// X-API-Key. Masters flow OUT (ERP is authoritative); transactional documents
// flow IN on production events.
//
//   GET  /health                       liveness + DB check
//   GET  /customers?since=&limit=       delta sync of clients2   (spec §3.2.1)
//   GET  /items?since=&limit=           delta sync of products   (spec §3.2.2)
//   GET  /suppliers?since=&limit=       delta sync of vendors    (spec §3.2)
//   GET  /stock-balance/:code           current on-hand by item  (spec §4.2.1)
//   POST /invoices                      invoice from dispatch    (spec §3.2.3)
//   POST /purchase-orders               PO from indent           (spec §3.2.4)
//   POST /stock-journals                stock movement           (spec §3.2.5-7)
//
// Auth: X-API-Key === env PPC_API_KEY. All POSTs honour Idempotency-Key (§4.2.3)
// and every call is written to sync_log (§6.2).
//
// Deploy:
//   supabase functions deploy ppc-integration
//   supabase secrets set PPC_API_KEY=<shared-with-ppc>
import { serviceClient } from "../_shared/db.ts";
import {
  checkApiKey, getStoredIdempotent, storeIdempotent, logSync,
  mapCustomer, mapSupplier, mapItem, ApiError,
} from "../_shared/ppc.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Strip the "/functions/v1/ppc-integration" prefix → the integration route.
function routeOf(url: URL): string {
  const m = url.pathname.match(/\/ppc-integration(\/.*)?$/);
  const sub = (m?.[1] || "/").replace(/\/+$/, "");
  return sub === "" ? "/" : sub;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const route = routeOf(url);

  // /health is unauthenticated so PPC's sync agent can probe liveness (§4.2.1).
  let db: any;
  try { db = serviceClient(); } catch (e) { return json({ ok: false, error: (e as Error).message }, 500); }

  if (route === "/health" && req.method === "GET") {
    const { error } = await db.from("sync_state").select("entity").limit(1);
    return json({ ok: !error, service: "ppc-integration", db: error ? "down" : "up", time: new Date().toISOString() });
  }

  // Everything else requires the shared API key.
  if (!checkApiKey(req)) return json({ error: "Unauthorized — missing or invalid X-API-Key" }, 401);

  const started = Date.now();
  try {
    // ---------------- Masters OUT (GET) ----------------
    if (req.method === "GET") {
      const since = url.searchParams.get("since");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "1000", 10) || 1000, 5000);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10) || 0;

      if (route === "/customers") return await listMasters(db, "clients2", "*", since, limit, offset, mapCustomer, "customer", started);
      if (route === "/suppliers") return await listMasters(db, "vendors_data", "*", since, limit, offset, mapSupplier, "supplier", started);
      if (route === "/items") {
        return await listMasters(
          db, "products",
          "*, units_of_measure:unit_of_measure_id(code)",
          since, limit, offset, mapItem, "item", started,
        );
      }
      if (route.startsWith("/stock-balance/") || route === "/stock-balance") {
        const code = route === "/stock-balance" ? url.searchParams.get("code") : decodeURIComponent(route.split("/stock-balance/")[1] || "");
        return await stockBalance(db, code || "");
      }
      return json({ error: `Unknown GET route ${route}` }, 404);
    }

    // ---------------- Documents IN (POST) ----------------
    if (req.method === "POST") {
      let body: any;
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
      const idemKey = req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key") || "";

      // Idempotency replay (spec §4.2.3): return the prior response, no re-apply.
      const prior = await getStoredIdempotent(db, idemKey);
      if (prior) {
        await logSync(db, { direction: "inbound", entity: prior.entity, ppc_ref: prior.ppc_ref, status: "success", http_status: prior.http_status, idempotency_key: idemKey, duration_ms: Date.now() - started, response_body: prior.response_body });
        return json(prior.response_body, prior.http_status || 200);
      }

      let handler: (db: any, body: any) => Promise<{ entity: string; ppcRef: string | null; result: any }>;
      if (route === "/invoices") handler = postInvoice;
      else if (route === "/purchase-orders") handler = postPurchaseOrder;
      else if (route === "/stock-journals") handler = postStockJournal;
      else return json({ error: `Unknown POST route ${route}` }, 404);

      try {
        const { entity, ppcRef, result } = await handler(db, body);
        await storeIdempotent(db, idemKey, entity, ppcRef, result, 201);
        await logSync(db, { direction: "inbound", entity, ppc_ref: ppcRef, erp_ref: result.invoice_no || result.po_no || result.voucher_no || null, request_body: body, response_body: result, http_status: 201, status: "success", idempotency_key: idemKey, duration_ms: Date.now() - started });
        return json(result, 201);
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 500;
        const msg = (e as Error).message;
        await logSync(db, { direction: "inbound", entity: route.replace("/", ""), request_body: body, response_body: { error: msg }, http_status: status, status: "failure", idempotency_key: idemKey, duration_ms: Date.now() - started });
        return json({ error: msg }, status);
      }
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (e) {
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Masters OUT
// ---------------------------------------------------------------------------
async function listMasters(
  db: any, table: string, select: string, since: string | null,
  limit: number, offset: number, mapper: (r: any) => any, entity: string, started: number,
) {
  let q = db.from(table).select(select).order("updated_at", { ascending: true }).range(offset, offset + limit - 1);
  if (since) q = q.gte("updated_at", since);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  const rows = (data || []).map(mapper);
  const watermark = rows.length ? rows[rows.length - 1].updated_at : since;
  await logSync(db, { direction: "outbound", entity, status: "success", http_status: 200, response_body: { count: rows.length }, duration_ms: Date.now() - started });
  return json({ entity, count: rows.length, since: since || null, next_offset: rows.length === limit ? offset + limit : null, watermark, data: rows });
}

async function stockBalance(db: any, code: string) {
  if (!code) return json({ error: "item code required" }, 400);
  const { data: prod } = await db.from("products").select("id, code").eq("code", code).is("deleted_at", null).maybeSingle();
  if (!prod) return json({ error: `Item ${code} not found` }, 404);
  const { data: rows } = await db.from("inventory_stock").select("branch_id, quantity, branches:branch_id(code, name)").eq("product_id", prod.id);
  const byWarehouse = (rows || []).map((r: any) => ({ warehouse: r.branches?.code || r.branches?.name || r.branch_id, qty: Number(r.quantity) || 0 }));
  const total = byWarehouse.reduce((s: number, r: any) => s + r.qty, 0);
  return json({ item_code: code, total_qty: total, by_warehouse: byWarehouse });
}

// ---------------------------------------------------------------------------
// Documents IN
// ---------------------------------------------------------------------------

// Next sequential ERP doc number, fiscal-year (Apr–Mar) scoped: PREFIX/YY-YY/NNNNN
async function nextDocNo(db: any, table: string, col: string, prefix: string, dateStr: string): Promise<string> {
  const d = new Date(dateStr + "T00:00:00Z");
  const y = d.getUTCFullYear();
  const fyStart = d.getUTCMonth() >= 3 ? y : y - 1; // Apr = month 3
  const fy = `${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`;
  const { count } = await db.from(table).select(col, { count: "exact", head: true });
  const seq = String((count || 0) + 1).padStart(5, "0");
  return `${prefix}/${fy}/${seq}`;
}

async function resolveCustomerId(db: any, code: string | null): Promise<string | null> {
  if (!code) return null;
  const { data } = await db.from("clients2").select("id").eq("ClientCode", code).maybeSingle();
  return data?.id || null;
}
async function resolveSupplierId(db: any, code: string | null): Promise<string | null> {
  if (!code) return null;
  const { data } = await db.from("vendors_data").select("id").eq("Vendor Code", code).maybeSingle();
  return data?.id || null;
}

// POST /invoices (spec §3.2.3 / §4.2.2)
async function postInvoice(db: any, body: any) {
  if (!body.ppc_so) throw new ApiError(400, "ppc_so is required");
  if (!Array.isArray(body.lines) || body.lines.length === 0) throw new ApiError(400, "lines[] is required");
  const invoiceDate = body.invoice_date || new Date().toISOString().slice(0, 10);

  let total = 0, tax = 0;
  for (const l of body.lines) {
    const base = (Number(l.qty) || 0) * (Number(l.unit_price) || 0);
    const lineTax = base * (Number(l.tax_rate_pct) || 0) / 100;
    total += base + lineTax;
    tax += lineTax;
  }
  const customerId = await resolveCustomerId(db, body.customer_code || null);
  const erpInvoiceNo = await nextDocNo(db, "ppc_invoices", "id", "INV", invoiceDate);

  const { data, error } = await db.from("ppc_invoices").insert({
    erp_invoice_no: erpInvoiceNo,
    ppc_so: body.ppc_so,
    customer_code: body.customer_code || null,
    customer_id: customerId,
    invoice_date: invoiceDate,
    vehicle_no: body.vehicle_no || null,
    lr_no: body.lr_no || null,
    remarks: body.remarks || null,
    lines: body.lines,
    total_amount: round2(total),
    tax_amount: round2(tax),
  }).select("id").single();
  if (error) throw new ApiError(500, error.message);

  return {
    entity: "invoice", ppcRef: body.ppc_so,
    result: {
      invoice_id: data.id,
      invoice_no: erpInvoiceNo,
      invoice_date: invoiceDate,
      total_amount: round2(total),
      tax_amount: round2(tax),
      pdf_url: null,
    },
  };
}

// POST /purchase-orders (spec §3.2.4)
async function postPurchaseOrder(db: any, body: any) {
  if (!body.ppc_indent_no) throw new ApiError(400, "ppc_indent_no is required");
  if (!Array.isArray(body.lines) || body.lines.length === 0) throw new ApiError(400, "lines[] is required");
  const poDate = body.po_date || new Date().toISOString().slice(0, 10);
  const total = body.lines.reduce((s: number, l: any) => s + (Number(l.qty) || 0) * (Number(l.rate ?? l.unit_price) || 0), 0);
  const supplierId = await resolveSupplierId(db, body.supplier_code || null);
  const erpPoNo = await nextDocNo(db, "ppc_purchase_orders", "id", "PO", poDate);

  const { data, error } = await db.from("ppc_purchase_orders").insert({
    erp_po_no: erpPoNo,
    ppc_indent_no: body.ppc_indent_no,
    supplier_code: body.supplier_code || null,
    supplier_id: supplierId,
    po_date: poDate,
    required_by: body.required_by || null,
    lines: body.lines,
    total_amount: round2(total),
  }).select("id").single();
  if (error) throw new ApiError(500, error.message);

  return { entity: "po", ppcRef: body.ppc_indent_no, result: { po_id: data.id, po_no: erpPoNo, po_date: poDate, total_amount: round2(total) } };
}

// POST /stock-journals (spec §3.2.5-7) — also applies lines to real inventory.
async function postStockJournal(db: any, body: any) {
  if (!body.voucher_type || !body.ppc_ref) throw new ApiError(400, "voucher_type and ppc_ref are required");
  if (!Array.isArray(body.lines) || body.lines.length === 0) throw new ApiError(400, "lines[] is required");
  const voucherDate = body.voucher_date || new Date().toISOString().slice(0, 10);

  // Resolve a default branch once (fallback when a warehouse code doesn't map).
  const { data: branches } = await db.from("branches").select("id, code, name");
  const branchByKey = new Map<string, string>();
  for (const b of branches || []) {
    if (b.code) branchByKey.set(String(b.code).toUpperCase(), b.id);
    if (b.name) branchByKey.set(String(b.name).toUpperCase(), b.id);
  }
  const defaultBranch = (branches || [])[0]?.id || null;

  const warnings: string[] = [];
  let applied = 0, skipped = 0;
  for (const l of body.lines) {
    const { data: prod } = await db.from("products").select("id").eq("code", l.item_code).is("deleted_at", null).maybeSingle();
    const branchId = branchByKey.get(String(l.warehouse || "").toUpperCase()) || defaultBranch;
    if (!prod || !branchId) {
      skipped++;
      warnings.push(`Line ${l.item_code}@${l.warehouse}: ${!prod ? "item not found" : "no branch"} — skipped`);
      continue;
    }
    const qty = Number(l.qty) || 0;
    const txType = qty < 0 ? "out" : "in";
    const { error } = await db.rpc("update_inventory_transaction", {
      p_branch_id: branchId,
      p_product_id: prod.id,
      p_quantity_delta: qty,
      p_transaction_type: txType,
      p_reference_id: `${body.voucher_type}:${body.ppc_ref}`,
      p_notes: `PPC ${body.voucher_type} ${body.ppc_ref}`,
    });
    if (error) { skipped++; warnings.push(`Line ${l.item_code}: ${error.message}`); }
    else applied++;
  }

  const erpVoucherNo = await nextDocNo(db, "ppc_stock_journals", "id", voucherTypePrefix(body.voucher_type), voucherDate);
  const { data, error } = await db.from("ppc_stock_journals").insert({
    erp_voucher_no: erpVoucherNo,
    voucher_type: body.voucher_type,
    voucher_date: voucherDate,
    ppc_ref: body.ppc_ref,
    supplier_code: body.supplier_code || null,
    po_no: body.po_no || null,
    lines: body.lines,
    applied_lines: applied,
    skipped_lines: skipped,
  }).select("id").single();
  if (error) throw new ApiError(500, error.message);

  return { entity: stockEntity(body.voucher_type), ppcRef: body.ppc_ref, result: { voucher_id: data.id, voucher_no: erpVoucherNo, applied, skipped, warnings } };
}

function voucherTypePrefix(t: string): string {
  const s = String(t).toLowerCase();
  if (s.includes("grn")) return "GRN";
  if (s.includes("fg")) return "FGR";
  return "STJ";
}
function stockEntity(t: string): string {
  const s = String(t).toLowerCase();
  if (s.includes("grn")) return "grn";
  if (s.includes("fg")) return "fg_receipt";
  return "stock_issue";
}
function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }
