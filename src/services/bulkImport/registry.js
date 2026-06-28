// Dataset registry for the bulk-import framework. Each entry describes a bulk-
// importable area: its columns (label/required/type/enum/example/help), the key
// used to match existing records (upsert), how to fetch current data (for the
// "download with data" round-trip), how to map a sheet row to a DB record, how
// to validate, and how to apply. Adding a new importable area = adding one
// object here. UI/template/parse are all generic.
import { supabase } from "../../lib/supabaseClient";
import {
  addCompany,
  listProspects,
  listClients,
  SOURCES,
  PROSPECT_STAGES,
  CLIENT_STAGES,
} from "../crmPipelineService";
import ppcService from "../ppcService";
import { listProducts, createProduct, updateProduct, saveProcess } from "../plmProductService";
import { listCables, saveCable } from "../cableMasterService";
import { listOperations } from "../mesService";
import { norm } from "./parse";

// ── small shared helpers ────────────────────────────────────────────────────
const str = (v) => (v == null ? "" : String(v).trim());
const numOrNull = (v) => {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
};
/** Coerce a cell to an enum KEY, accepting either the key or the label. */
const toEnumKey = (v, options) => {
  const n = norm(v);
  if (!n) return null;
  const hit = options.find((o) => norm(o.key) === n || norm(o.label) === n);
  return hit ? hit.key : null;
};
const enumKeys = (options) => options.map((o) => o.key);

// Extra crm_pipeline columns the crm_add_company RPC does NOT set — applied as a
// follow-up update once the record exists.
const CRM_EXTRA_KEYS = ["city", "industry", "product_category", "gstin", "pan", "payment_terms", "credit_limit", "rating", "notes"];

async function applyCrm(accountType, items, onProgress) {
  let created = 0;
  let updated = 0;
  const errors = [];
  for (let i = 0; i < items.length; i += 1) {
    const { rec, match } = items[i];
    try {
      const payload = {
        account_type: accountType,
        company_name: rec.company_name,
        contact_person: rec.contact_person || null,
        phone: rec.phone || null,
        email: rec.email || null,
        source: rec.source || null,
        value: rec.value ?? null,
        owner_email: rec.owner_email || null,
      };
      if (rec.customer_code) payload.customer_code = rec.customer_code;
      if (accountType === "prospect" && rec.prospect_stage) payload.prospect_stage = rec.prospect_stage;
      if (accountType === "client" && rec.client_stage) payload.client_stage = rec.client_stage;

      const res = await addCompany(payload);
      const id = Array.isArray(res) ? res[0]?.id : res?.id || res;

      // Fields the RPC doesn't handle → follow-up update (best-effort).
      const extras = {};
      CRM_EXTRA_KEYS.forEach((k) => {
        if (rec[k] != null && rec[k] !== "") extras[k] = rec[k];
      });
      if (id && Object.keys(extras).length) {
        const { error } = await supabase.from("crm_pipeline").update(extras).eq("id", id);
        if (error) errors.push({ label: rec.company_name, message: `saved, but extra fields failed: ${error.message}` });
      }
      if (match) updated += 1;
      else created += 1;
    } catch (e) {
      errors.push({ label: rec.company_name || `row ${i + 1}`, message: e?.message || String(e) });
    }
    onProgress && onProgress(i + 1, items.length);
  }
  return { created, updated, errors };
}

// ── CRM Prospects ───────────────────────────────────────────────────────────
const crmProspects = {
  key: "crm_prospects",
  label: "CRM Prospects",
  module: "crm",
  matchKey: "company_name",
  columns: [
    { key: "company_name", label: "Company name", required: true, type: "text", example: "Acme Cables Pvt Ltd", help: "Used to match existing — a match updates it." },
    { key: "contact_person", label: "Contact person", type: "text", example: "Ravi Sharma" },
    { key: "phone", label: "Phone", type: "text", example: "9000000001" },
    { key: "email", label: "Email", type: "text", example: "ravi@acme.com" },
    { key: "city", label: "City", type: "text", example: "Pune" },
    { key: "industry", label: "Industry", type: "text", example: "Auto components" },
    { key: "source", label: "Source", type: "enum", enum: SOURCES, example: "Cold Call" },
    { key: "prospect_stage", label: "Prospect stage", type: "enum", enum: enumKeys(PROSPECT_STAGES), example: "lead", help: PROSPECT_STAGES.map((s) => s.key).join(", ") },
    { key: "owner_email", label: "Owner email", type: "text", example: "", help: "Leave blank to keep unassigned/claimable." },
    { key: "value", label: "Est. value (₹)", type: "number", example: 50000 },
  ],
  fetchExisting: () => listProspects(),
  recordToCell: (row, key) => row[key],
  rowToRecord: (raw) => ({
    company_name: str(raw.company_name),
    contact_person: str(raw.contact_person),
    phone: str(raw.phone),
    email: str(raw.email),
    city: str(raw.city),
    industry: str(raw.industry),
    source: str(raw.source) || null,
    prospect_stage: toEnumKey(raw.prospect_stage, PROSPECT_STAGES) || (str(raw.prospect_stage) ? "__invalid__" : null),
    owner_email: str(raw.owner_email).toLowerCase() || null,
    value: numOrNull(raw.value),
  }),
  validateRow: (rec) => {
    const errors = [];
    const warnings = [];
    if (!rec.company_name) errors.push("Company name is required");
    if (rec.prospect_stage === "__invalid__") errors.push("Prospect stage not recognised");
    if (rec.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.email)) warnings.push("Email looks malformed");
    return { errors, warnings };
  },
  apply: (items, onProgress) => applyCrm("prospect", items, onProgress),
};

// ── CRM Clients ─────────────────────────────────────────────────────────────
const crmClients = {
  key: "crm_clients",
  label: "CRM Clients",
  module: "crm",
  matchKey: "company_name",
  columns: [
    { key: "company_name", label: "Company name", required: true, type: "text", example: "Bright Industries Ltd", help: "Used to match existing — a match updates it." },
    { key: "contact_person", label: "Contact person", type: "text", example: "Sunita Rao" },
    { key: "phone", label: "Phone", type: "text", example: "9000000002" },
    { key: "email", label: "Email", type: "text", example: "sunita@bright.com" },
    { key: "city", label: "City", type: "text", example: "Mumbai" },
    { key: "industry", label: "Industry", type: "text", example: "Appliances" },
    { key: "gstin", label: "GSTIN", type: "text", example: "27ABCDE1234F1Z5" },
    { key: "pan", label: "PAN", type: "text", example: "ABCDE1234F" },
    { key: "payment_terms", label: "Payment terms", type: "text", example: "30 days" },
    { key: "credit_limit", label: "Credit limit (₹)", type: "number", example: 500000 },
    { key: "rating", label: "Rating (1-5)", type: "number", example: 4 },
    { key: "client_stage", label: "Client stage", type: "enum", enum: enumKeys(CLIENT_STAGES), example: "active", help: CLIENT_STAGES.map((s) => s.key).join(", ") },
    { key: "owner_email", label: "Owner email", type: "text", example: "" },
    { key: "value", label: "Annual value (₹)", type: "number", example: 1200000 },
  ],
  fetchExisting: () => listClients(),
  recordToCell: (row, key) => row[key],
  rowToRecord: (raw) => ({
    company_name: str(raw.company_name),
    contact_person: str(raw.contact_person),
    phone: str(raw.phone),
    email: str(raw.email),
    city: str(raw.city),
    industry: str(raw.industry),
    gstin: str(raw.gstin) || null,
    pan: str(raw.pan) || null,
    payment_terms: str(raw.payment_terms) || null,
    credit_limit: numOrNull(raw.credit_limit),
    rating: numOrNull(raw.rating),
    client_stage: toEnumKey(raw.client_stage, CLIENT_STAGES) || (str(raw.client_stage) ? "__invalid__" : null),
    owner_email: str(raw.owner_email).toLowerCase() || null,
    value: numOrNull(raw.value),
  }),
  validateRow: (rec) => {
    const errors = [];
    const warnings = [];
    if (!rec.company_name) errors.push("Company name is required");
    if (rec.client_stage === "__invalid__") errors.push("Client stage not recognised");
    if (rec.rating != null && (rec.rating < 1 || rec.rating > 5)) warnings.push("Rating should be 1-5");
    return { errors, warnings };
  },
  apply: (items, onProgress) => applyCrm("client", items, onProgress),
};

// ── Inventory items (+ opening stock) ───────────────────────────────────────
const ITEM_TYPE_KEYS = (ppcService.ITEM_TYPES || []).map((t) => t.value);
async function applyInventory(items, onProgress) {
  let created = 0;
  let updated = 0;
  const errors = [];
  const existing = await ppcService.listItems({ includeInactive: true }).catch(() => []);
  const byCode = new Map(existing.map((it) => [norm(it.code), it]));
  for (let i = 0; i < items.length; i += 1) {
    const { rec } = items[i];
    try {
      const ex = byCode.get(norm(rec.code));
      let isNew = false;
      if (ex) {
        await ppcService.updateItem(ex.id, {
          name: rec.name, item_type: rec.item_type, uom: rec.uom || "nos",
          unit_cost: rec.unit_cost ?? 0, notes: rec.notes || null,
        });
        updated += 1;
      } else {
        await ppcService.createItem({
          code: rec.code, name: rec.name, item_type: rec.item_type,
          uom: rec.uom || "nos", unit_cost: rec.unit_cost ?? 0,
        });
        created += 1;
        isNew = true;
      }
      // Opening stock only on a NEW item (append-only ledger → no double-post).
      if (isNew && rec.opening_qty != null && Number(rec.opening_qty) > 0) {
        const { error } = await supabase.rpc("inv_open", {
          p_item_code: rec.code,
          p_location_code: rec.location || "STORE",
          p_qty: Number(rec.opening_qty),
          p_rate: rec.unit_cost || 0,
        });
        if (error) errors.push({ label: rec.code, message: `item saved, opening stock failed: ${error.message}` });
      }
    } catch (e) {
      errors.push({ label: rec.code || `row ${i + 1}`, message: e?.message || String(e) });
    }
    onProgress && onProgress(i + 1, items.length);
  }
  return { created, updated, errors };
}

const inventoryItems = {
  key: "inventory_items",
  label: "Inventory Items",
  module: "inventory",
  matchKey: "code",
  columns: [
    { key: "code", label: "Item code", required: true, type: "text", example: "CO001", help: "Matches existing — a match updates it." },
    { key: "name", label: "Item name", required: true, type: "text", example: "Copper Wire 1.5sqmm" },
    { key: "item_type", label: "Item type", type: "enum", enum: ITEM_TYPE_KEYS, example: "raw_material" },
    { key: "uom", label: "UOM", type: "text", example: "kg", help: "Defaults to nos." },
    { key: "unit_cost", label: "Unit cost (₹)", type: "number", example: 720 },
    { key: "opening_qty", label: "Opening qty", type: "number", example: 100, help: "Only posted for NEW items. For existing items use the stock-adjust flow." },
    { key: "location", label: "Location", type: "text", example: "STORE", help: "Defaults to STORE." },
  ],
  fetchExisting: () => ppcService.listItems({ includeInactive: true }),
  recordToCell: (row, key) => row[key],
  rowToRecord: (raw) => ({
    code: str(raw.code),
    name: str(raw.name),
    item_type: toEnumKey(raw.item_type, (ppcService.ITEM_TYPES || []).map((t) => ({ key: t.value, label: t.label }))) || (str(raw.item_type) ? "__invalid__" : "component"),
    uom: str(raw.uom) || null,
    unit_cost: numOrNull(raw.unit_cost),
    opening_qty: numOrNull(raw.opening_qty),
    location: str(raw.location) || null,
  }),
  validateRow: (rec) => {
    const errors = [];
    if (!rec.code) errors.push("Item code is required");
    if (!rec.name) errors.push("Item name is required");
    if (rec.item_type === "__invalid__") errors.push("Item type not recognised");
    return { errors, warnings: [] };
  },
  apply: applyInventory,
};

// ── Products (PLM) ──────────────────────────────────────────────────────────
const PRODUCT_TYPES = ["cable", "power_cord", "harness", "custom"];
const PRODUCT_STATUS = ["development", "sample", "approved", "production", "inactive", "obsolete"];
async function applyProducts(items, onProgress) {
  let created = 0;
  let updated = 0;
  const errors = [];
  const existing = await listProducts({ includeArchived: true }).catch(() => []);
  const byCode = new Map(existing.map((p) => [norm(p.product_code), p]));
  for (let i = 0; i < items.length; i += 1) {
    const { rec } = items[i];
    try {
      const ex = byCode.get(norm(rec.product_code));
      const patch = {
        product_code: rec.product_code, product_name: rec.product_name,
        product_type: rec.product_type || "cable", customer_code: rec.customer_code || null,
        status: rec.status || "development",
      };
      if (ex) { await updateProduct(ex.id, patch); updated += 1; }
      else { await createProduct(patch); created += 1; }
    } catch (e) {
      errors.push({ label: rec.product_code || `row ${i + 1}`, message: e?.message || String(e) });
    }
    onProgress && onProgress(i + 1, items.length);
  }
  return { created, updated, errors };
}

const products = {
  key: "products",
  label: "Products (PLM)",
  module: "production",
  matchKey: "product_code",
  columns: [
    { key: "product_code", label: "Product code", required: true, type: "text", example: "PRD-0001" },
    { key: "product_name", label: "Product name", required: true, type: "text", example: "3-Core Power Cord 1.5sqmm" },
    { key: "product_type", label: "Product type", type: "enum", enum: PRODUCT_TYPES, example: "power_cord" },
    { key: "customer_code", label: "Customer code", type: "text", example: "C10041" },
    { key: "status", label: "Status", type: "enum", enum: PRODUCT_STATUS, example: "production" },
  ],
  fetchExisting: () => listProducts({ includeArchived: true }),
  recordToCell: (row, key) => row[key],
  rowToRecord: (raw) => ({
    product_code: str(raw.product_code),
    product_name: str(raw.product_name),
    product_type: toEnumKey(raw.product_type, PRODUCT_TYPES.map((k) => ({ key: k, label: k }))) || (str(raw.product_type) ? "__invalid__" : null),
    customer_code: str(raw.customer_code) || null,
    status: toEnumKey(raw.status, PRODUCT_STATUS.map((k) => ({ key: k, label: k }))) || (str(raw.status) ? "__invalid__" : null),
  }),
  validateRow: (rec) => {
    const errors = [];
    if (!rec.product_code) errors.push("Product code is required");
    if (!rec.product_name) errors.push("Product name is required");
    if (rec.product_type === "__invalid__") errors.push("Product type not recognised");
    if (rec.status === "__invalid__") errors.push("Status not recognised");
    return { errors, warnings: [] };
  },
  apply: applyProducts,
};

// ── Cable master ────────────────────────────────────────────────────────────
async function applyCable(items, onProgress) {
  let created = 0;
  let updated = 0;
  const errors = [];
  const existing = await listCables().catch(() => []);
  const byCode = new Map(existing.map((c) => [norm(c.cable_code), c]));
  for (let i = 0; i < items.length; i += 1) {
    const { rec } = items[i];
    try {
      const ex = byCode.get(norm(rec.cable_code));
      const row = { ...rec };
      if (ex) row.id = ex.id;
      await saveCable(row);
      if (ex) updated += 1;
      else created += 1;
    } catch (e) {
      errors.push({ label: rec.cable_code || `row ${i + 1}`, message: e?.message || String(e) });
    }
    onProgress && onProgress(i + 1, items.length);
  }
  return { created, updated, errors };
}

const cableMaster = {
  key: "cable_master",
  label: "Cable Specs",
  module: "production",
  matchKey: "cable_code",
  columns: [
    { key: "cable_code", label: "Cable code", required: true, type: "text", example: "CBL-3C-1.5" },
    { key: "cable_name", label: "Cable name", type: "text", example: "3 Core 1.5sqmm Flat" },
    { key: "cores", label: "Cores", type: "number", example: 3 },
    { key: "flat_round", label: "Shape", type: "enum", enum: ["flat", "round"], example: "round" },
    { key: "copper_area_sqmm", label: "Copper area (sqmm)", type: "number", example: 1.5 },
    { key: "strand_construction", label: "Strand construction", type: "text", example: "30/0.25" },
    { key: "colour_combination", label: "Core colours", type: "text", example: "Red, Black, Green", help: "Comma or | separated." },
    { key: "insulation_thickness", label: "Insulation thk (mm)", type: "number", example: 0.6 },
    { key: "sheath_thickness", label: "Sheath thk (mm)", type: "number", example: 0.9 },
    { key: "voltage", label: "Voltage", type: "text", example: "1100V" },
    { key: "cord_length", label: "Cord length (m)", type: "number", example: 5 },
    { key: "is_power_cord", label: "Is power cord?", type: "text", example: "yes", help: "yes/no" },
  ],
  fetchExisting: () => listCables(),
  recordToCell: (row, key) => (key === "colour_combination" && Array.isArray(row[key]) ? row[key].join(", ") : row[key]),
  rowToRecord: (raw) => ({
    cable_code: str(raw.cable_code),
    cable_name: str(raw.cable_name) || null,
    cores: numOrNull(raw.cores),
    flat_round: toEnumKey(raw.flat_round, [{ key: "flat", label: "flat" }, { key: "round", label: "round" }]),
    copper_area_sqmm: numOrNull(raw.copper_area_sqmm),
    strand_construction: str(raw.strand_construction) || null,
    colour_combination: str(raw.colour_combination) ? str(raw.colour_combination).split(/[,|]/).map((s) => s.trim()).filter(Boolean) : [],
    insulation_thickness: numOrNull(raw.insulation_thickness),
    sheath_thickness: numOrNull(raw.sheath_thickness),
    voltage: str(raw.voltage) || null,
    cord_length: numOrNull(raw.cord_length),
    is_power_cord: /^(y|yes|true|1)$/i.test(str(raw.is_power_cord)),
  }),
  validateRow: (rec) => ({ errors: rec.cable_code ? [] : ["Cable code is required"], warnings: [] }),
  apply: applyCable,
};

// ── Routings (Line Planner) — one row per product+operation, grouped on apply ─
const STAGE_FROM_CAT = { cutting: "Assembly", assembly: "Assembly", molding: "Moulding", packing: "Packing", testing: "Packing", other: "Packing" };
const STAGE_ORDER = { Assembly: 0, Moulding: 1, Packing: 2 };
async function applyRoutings(items, onProgress) {
  let created = 0;
  let updated = 0;
  const errors = [];
  const [prods, ops] = await Promise.all([
    listProducts({ includeArchived: true }).catch(() => []),
    listOperations({ includeInactive: true }).catch(() => []),
  ]);
  const prodByCode = new Map(prods.map((p) => [norm(p.product_code), p]));
  const resolveOp = (v) => ops.find((o) => norm(o.operation_code) === norm(v) || norm(o.name) === norm(v)) || null;

  const groups = new Map();
  items.forEach((it) => {
    const k = norm(it.rec.product_code);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it.rec);
  });

  let done = 0;
  const total = groups.size;
  for (const rows of groups.values()) {
    const code = rows[0].product_code;
    try {
      const prod = prodByCode.get(norm(code));
      if (!prod) {
        errors.push({ label: code, message: "unknown product_code — create the product first" });
      } else {
        const steps = rows
          .slice()
          .sort((a, b) => (STAGE_ORDER[a.stage] ?? 9) - (STAGE_ORDER[b.stage] ?? 9))
          .map((r) => {
            const op = resolveOp(r.operation);
            return {
              operation_id: op?.id || null,
              step_name: op?.name || r.operation,
              department: r.stage || (op ? STAGE_FROM_CAT[op.category] : null),
              cycle_time_sec: numOrNull(r.cycle_time_sec),
              cavities: numOrNull(r.cavities),
              parallel_machines: numOrNull(r.parallel_machines) || 1,
              min_operators: numOrNull(r.min_operators) || 1,
              max_operators: numOrNull(r.max_operators) || 1,
              oee: numOrNull(r.oee),
              scrap_pct: 0,
            };
          });
        const unresolved = [...new Set(rows.filter((r) => !resolveOp(r.operation)).map((r) => r.operation))];
        await saveProcess(prod.id, steps);
        updated += 1;
        if (unresolved.length) errors.push({ label: code, message: `routing saved; unmatched operations: ${unresolved.join(", ")}` });
      }
    } catch (e) {
      errors.push({ label: code, message: e?.message || String(e) });
    }
    done += 1;
    onProgress && onProgress(done, total);
  }
  return { created, updated, errors };
}

const routings = {
  key: "routings",
  label: "Routings (Line Planner)",
  module: "production",
  matchKey: "product_code",
  columns: [
    { key: "product_code", label: "Product code", required: true, type: "text", example: "PRD-0001", help: "Product must already exist. One row per operation; rows for the same product become its routing." },
    { key: "stage", label: "Stage", type: "enum", enum: ["Assembly", "Moulding", "Packing"], example: "Assembly" },
    { key: "operation", label: "Operation", required: true, type: "text", example: "Stripping", help: "Operation code or name from the operation master." },
    { key: "cycle_time_sec", label: "Cycle / shot time (sec)", type: "number", example: 3.75 },
    { key: "cavities", label: "Cavities (moulding)", type: "number", example: 1 },
    { key: "parallel_machines", label: "Parallel stations", type: "number", example: 1 },
    { key: "min_operators", label: "Min operators", type: "number", example: 1 },
    { key: "max_operators", label: "Max operators", type: "number", example: 9 },
    { key: "oee", label: "OEE", type: "number", example: 0.8 },
  ],
  fetchExisting: () => listProducts({ includeArchived: true }),
  recordToCell: (row, key) => row[key],
  rowToRecord: (raw) => ({
    product_code: str(raw.product_code),
    stage: toEnumKey(raw.stage, [{ key: "Assembly", label: "Assembly" }, { key: "Moulding", label: "Moulding" }, { key: "Packing", label: "Packing" }]),
    operation: str(raw.operation),
    cycle_time_sec: numOrNull(raw.cycle_time_sec),
    cavities: numOrNull(raw.cavities),
    parallel_machines: numOrNull(raw.parallel_machines),
    min_operators: numOrNull(raw.min_operators),
    max_operators: numOrNull(raw.max_operators),
    oee: numOrNull(raw.oee),
  }),
  validateRow: (rec) => {
    const errors = [];
    if (!rec.product_code) errors.push("Product code is required");
    if (!rec.operation) errors.push("Operation is required");
    return { errors, warnings: [] };
  },
  apply: applyRoutings,
};

// ── registry ────────────────────────────────────────────────────────────────
export const DATASETS = {
  [crmProspects.key]: crmProspects,
  [crmClients.key]: crmClients,
  [inventoryItems.key]: inventoryItems,
  [products.key]: products,
  [cableMaster.key]: cableMaster,
  [routings.key]: routings,
};

export const getDataset = (key) => DATASETS[key] || null;

export const DATASETS_BY_MODULE = Object.values(DATASETS).reduce((acc, d) => {
  (acc[d.module] = acc[d.module] || []).push(d);
  return acc;
}, {});
