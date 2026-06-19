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

/**
 * The caller's planned CRM next-actions, for the home "My Follow-ups" widget.
 *
 * Pulls two sources, both already RLS-scoped to the caller:
 *  - crm_pipeline.next_action / next_action_date (a card's planned next step)
 *  - crm_pipeline_activity.next_follow_up_date (a logged activity's follow-up)
 *
 * Rows owned by the caller OR unassigned (owner_email IS NULL) are kept — the
 * owner filter is applied in JS (case-insensitive) so RLS + ownership stay in
 * sync with how the pipeline board scopes "My" rows.
 *
 * @param {string} email  the current user's email
 * @returns {{ overdue:Array, today:Array, upcoming:Array,
 *             counts:{ overdue:number, today:number, upcoming:number, total:number } }}
 */
export async function getMyFollowups(email) {
  const mine = (ownerEmail) =>
    ownerEmail == null ||
    (email && String(ownerEmail).toLowerCase() === String(email).toLowerCase());

  // 1) Pipeline cards with a planned next action.
  const { data: pipeRows, error: pErr } = await supabase
    .from("crm_pipeline")
    .select("id,company_name,stage,next_action,next_action_date,owner_email")
    .not("next_action_date", "is", null);
  throwIf(pErr);

  // 2) Activities with a planned follow-up. Company name comes from the joined
  //    pipeline row (foreign-table select on the pipeline_id relationship).
  const { data: actRows, error: aErr } = await supabase
    .from("crm_pipeline_activity")
    .select(
      "id,pipeline_id,subject,activity_type,next_follow_up_date,owner_email,crm_pipeline(company_name)",
    )
    .not("next_follow_up_date", "is", null);
  throwIf(aErr);

  const items = [];

  (pipeRows || []).filter((r) => mine(r.owner_email)).forEach((r) => {
    items.push({
      kind: "action",
      id: r.id,
      pipelineId: r.id,
      company: r.company_name || "Untitled",
      label: r.next_action || "Next action",
      date: r.next_action_date,
      stage: r.stage,
    });
  });

  (actRows || []).filter((r) => mine(r.owner_email)).forEach((r) => {
    const company =
      (r.crm_pipeline && r.crm_pipeline.company_name) || "Untitled";
    const typeLabel =
      (ACTIVITY_TYPES.find((t) => t.key === r.activity_type) || {}).label ||
      r.activity_type ||
      "Activity";
    items.push({
      kind: "activity",
      id: r.id,
      pipelineId: r.pipeline_id,
      company,
      label: r.subject || typeLabel,
      date: r.next_follow_up_date,
      stage: null,
    });
  });

  // Categorize relative to local today.
  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const today = startOfDay(new Date());
  const weekAhead = startOfDay(new Date());
  weekAhead.setDate(weekAhead.getDate() + 7);

  const overdue = [];
  const dueToday = [];
  const upcoming = [];

  items.forEach((it) => {
    if (!it.date) return;
    const d = startOfDay(it.date);
    if (d < today) overdue.push(it);
    else if (d.getTime() === today.getTime()) dueToday.push(it);
    else if (d <= weekAhead) upcoming.push(it);
  });

  const byDateAsc = (a, b) => new Date(a.date) - new Date(b.date);
  overdue.sort(byDateAsc);
  dueToday.sort(byDateAsc);
  upcoming.sort(byDateAsc);

  return {
    overdue,
    today: dueToday,
    upcoming,
    counts: {
      overdue: overdue.length,
      today: dueToday.length,
      upcoming: upcoming.length,
      total: overdue.length + dueToday.length + upcoming.length,
    },
  };
}

/**
 * Reschedule a follow-up to a new date (YYYY-MM-DD string).
 * Writes back to whichever table the item originated from.
 */
export async function rescheduleFollowup(item, newDateStr) {
  if (item.kind === "action") {
    const { error } = await supabase
      .from("crm_pipeline")
      .update({ next_action_date: newDateStr })
      .eq("id", item.id);
    throwIf(error);
  } else {
    const { error } = await supabase
      .from("crm_pipeline_activity")
      .update({ next_follow_up_date: newDateStr })
      .eq("id", item.id);
    throwIf(error);
  }
  return true;
}

/**
 * Mark a follow-up done by clearing its reminder date, so it drops out of the
 * widget. Operates on the originating row.
 */
export async function completeFollowup(item) {
  if (item.kind === "action") {
    const { error } = await supabase
      .from("crm_pipeline")
      .update({ next_action_date: null })
      .eq("id", item.id);
    throwIf(error);
  } else {
    const { error } = await supabase
      .from("crm_pipeline_activity")
      .update({ next_follow_up_date: null })
      .eq("id", item.id);
    throwIf(error);
  }
  return true;
}

/** Move the follow-up's parent pipeline card to another stage. */
export async function moveFollowupStage(item, toStage) {
  const pid = item.kind === "action" ? item.id : item.pipelineId;
  const { data, error } = await supabase.rpc("crm_move_stage", {
    p_pipeline_id: pid,
    p_to_stage: toStage,
    p_note: null,
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
  getMyFollowups,
  rescheduleFollowup,
  completeFollowup,
  moveFollowupStage,
  getCurrentUserEmail,
};

export default crmPipelineService;
