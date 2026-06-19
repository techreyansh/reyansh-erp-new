import { supabase } from "../lib/supabaseClient";

/**
 * Pipeline-driven CRM service.
 *
 * Talks directly to the live Supabase tables/RPCs. RLS auto-filters rows to the
 * caller (CEO sees all; others see their own + unassigned). Errors are thrown so
 * callers can surface them via the global Snackbar error handler.
 */

/** Ordered prospect pipeline stages. */
export const STAGES = [
  { key: "cold_call", label: "Cold Call" },
  { key: "data_shared", label: "Data Shared" },
  { key: "rfq_samples", label: "RFQ / Samples" },
  { key: "quotation", label: "Quotation" },
  { key: "counter_samples", label: "Counter Samples" },
  { key: "sample_approval", label: "Sample Approval" },
  { key: "qc_audit", label: "QC Audit" },
  { key: "pilot_lot", label: "Pilot Lot" },
  { key: "recurring_client", label: "Recurring Client" },
];

/** Ordered recurring-customer order-cycle stages. */
export const CYCLE_STAGES = [
  { key: "order_taking", label: "Order Taking" },
  { key: "order_received", label: "Order Received" },
  { key: "dispatch", label: "Dispatch" },
  { key: "keep_informed", label: "Keep Informed" },
  { key: "invoicing", label: "Invoicing" },
  { key: "payment_followup", label: "Payment Follow-up" },
  { key: "closed", label: "Closed" },
];

/** key → label maps for quick lookups. */
export const STAGE_LABELS = STAGES.reduce((acc, s) => {
  acc[s.key] = s.label;
  return acc;
}, {});

export const CYCLE_STAGE_LABELS = CYCLE_STAGES.reduce((acc, s) => {
  acc[s.key] = s.label;
  return acc;
}, {});

/** Activity types supported by crm_pipeline_activity. */
export const ACTIVITY_TYPES = [
  { key: "call", label: "Call" },
  { key: "email", label: "Email" },
  { key: "meeting", label: "Meeting" },
  { key: "note", label: "Note" },
  { key: "sample", label: "Sample" },
  { key: "quotation", label: "Quotation" },
  { key: "whatsapp", label: "WhatsApp" },
];

export const SOURCES = [
  "Cold Call",
  "Reference",
  "Website",
  "Exhibition",
  "IndiaMART",
  "WhatsApp",
  "Existing Customer",
  "Other",
];

const throwIf = (error) => {
  if (error) throw error;
};

/** Full active pipeline (RLS filters to the caller). */
export async function listPipeline() {
  const { data, error } = await supabase
    .from("crm_pipeline")
    .select("*")
    .eq("is_active", true)
    .order("stage_entered_at", { ascending: true });
  throwIf(error);
  return data || [];
}

export async function listProspects() {
  const { data, error } = await supabase
    .from("crm_pipeline")
    .select("*")
    .eq("is_active", true)
    .eq("kind", "prospect")
    .order("stage_entered_at", { ascending: true });
  throwIf(error);
  return data || [];
}

export async function listRecurring() {
  const { data, error } = await supabase
    .from("crm_pipeline")
    .select("*")
    .eq("is_active", true)
    .eq("kind", "recurring")
    .order("company_name", { ascending: true });
  throwIf(error);
  return data || [];
}

/**
 * Company detail: the pipeline row + its stage history + activities, and (if a
 * recurring customer) its order cycles.
 */
export async function getCompany(id) {
  const { data: company, error: cErr } = await supabase
    .from("crm_pipeline")
    .select("*")
    .eq("id", id)
    .single();
  throwIf(cErr);

  const { data: history, error: hErr } = await supabase
    .from("crm_pipeline_history")
    .select("*")
    .eq("pipeline_id", id)
    .order("moved_at", { ascending: false });
  throwIf(hErr);

  const { data: activities, error: aErr } = await supabase
    .from("crm_pipeline_activity")
    .select("*")
    .eq("pipeline_id", id)
    .order("activity_at", { ascending: false });
  throwIf(aErr);

  let orderCycles = [];
  if (company?.kind === "recurring" && company?.customer_code) {
    const { data: cycles, error: ocErr } = await supabase
      .from("crm_order_cycle")
      .select("*")
      .eq("customer_code", company.customer_code)
      .order("stage_entered_at", { ascending: false });
    throwIf(ocErr);
    orderCycles = cycles || [];
  }

  return {
    company,
    history: history || [],
    activities: activities || [],
    orderCycles,
  };
}

/** Move a pipeline card to another stage (logs history server-side). */
export async function moveStage(id, toStage, note) {
  const { data, error } = await supabase.rpc("crm_move_stage", {
    p_pipeline_id: id,
    p_to_stage: toStage,
    p_note: note || null,
  });
  throwIf(error);
  return data;
}

/** Insert an activity row. owner_email is set by the caller or DB default. */
export async function addActivity(payload) {
  const { data, error } = await supabase
    .from("crm_pipeline_activity")
    .insert(payload)
    .select("*")
    .single();
  throwIf(error);
  return data;
}

/** Assign / reassign an owner. */
export async function assignOwner(id, email) {
  const { data, error } = await supabase.rpc("crm_assign_owner", {
    p_pipeline_id: id,
    p_owner_email: email,
  });
  throwIf(error);
  return data;
}

/** Create a new pipeline company. */
export async function addCompany(payload) {
  const { data, error } = await supabase
    .from("crm_pipeline")
    .insert(payload)
    .select("*")
    .single();
  throwIf(error);
  return data;
}

/** Patch an existing pipeline company. */
export async function updateCompany(id, patch) {
  const { data, error } = await supabase
    .from("crm_pipeline")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  throwIf(error);
  return data;
}

/** All order cycles (RLS filters to the caller). */
export async function listOrderCycles() {
  const { data, error } = await supabase
    .from("crm_order_cycle")
    .select("*")
    .order("stage_entered_at", { ascending: false });
  throwIf(error);
  return data || [];
}

/** Move an order cycle to another cycle stage. */
export async function moveOrderCycle(id, toStage, note) {
  const { data, error } = await supabase.rpc("crm_move_order_cycle", {
    p_id: id,
    p_to_stage: toStage,
    p_note: note || null,
  });
  throwIf(error);
  return data;
}

/** Current authenticated user's email (for the My / All toggle). */
export async function getCurrentUserEmail() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data?.user?.email || null;
}

const crmPipelineService = {
  STAGES,
  CYCLE_STAGES,
  STAGE_LABELS,
  CYCLE_STAGE_LABELS,
  ACTIVITY_TYPES,
  SOURCES,
  listPipeline,
  listProspects,
  listRecurring,
  getCompany,
  moveStage,
  addActivity,
  assignOwner,
  addCompany,
  updateCompany,
  listOrderCycles,
  moveOrderCycle,
  getCurrentUserEmail,
};

export default crmPipelineService;
