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

// ── registry ────────────────────────────────────────────────────────────────
export const DATASETS = {
  [crmProspects.key]: crmProspects,
  [crmClients.key]: crmClients,
};

export const getDataset = (key) => DATASETS[key] || null;

export const DATASETS_BY_MODULE = Object.values(DATASETS).reduce((acc, d) => {
  (acc[d.module] = acc[d.module] || []).push(d);
  return acc;
}, {});
