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

/**
 * Ordered prospect lifecycle stages (the new 8-stage prospect kanban).
 * Backed by crm_pipeline.prospect_stage on the unified master.
 */
export const PROSPECT_STAGES = [
  { key: "lead", label: "Lead" },
  { key: "contacted", label: "Contacted" },
  { key: "meeting_scheduled", label: "Meeting Scheduled" },
  { key: "qualified", label: "Qualified" },
  { key: "sample_sent", label: "Sample Sent" },
  { key: "quotation_sent", label: "Quotation Sent" },
  { key: "negotiation", label: "Negotiation" },
  { key: "converted", label: "Converted" },
];

/** Client lifecycle stages, backed by crm_pipeline.client_stage. */
export const CLIENT_STAGES = [
  { key: "active", label: "Active Client" },
  { key: "repeat_business", label: "Repeat Business" },
  { key: "key_account", label: "Key Account" },
  { key: "growth_account", label: "Growth Account" },
  { key: "dormant", label: "Dormant" },
  { key: "inactive", label: "Inactive" },
];

/** Ordered recurring-customer order-cycle stages. */
export const CYCLE_STAGES = [
  { key: "order_taking", label: "Order Taking" },
  { key: "order_received", label: "Order Received" },
  { key: "production", label: "Production / Batches" },
  { key: "dispatch", label: "Dispatch & Invoicing" },
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

export const PROSPECT_STAGE_LABELS = PROSPECT_STAGES.reduce((acc, s) => {
  acc[s.key] = s.label;
  return acc;
}, {});

export const CLIENT_STAGE_LABELS = CLIENT_STAGES.reduce((acc, s) => {
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

/** Prospects on the unified master (account_type = 'prospect'). */
export async function listProspects() {
  const { data, error } = await supabase
    .from("crm_pipeline")
    .select("*")
    .eq("account_type", "prospect")
    .order("stage_entered_at", { ascending: true });
  throwIf(error);
  return data ?? [];
}

/** Clients on the unified master (account_type = 'client'). */
export async function listClients() {
  const { data, error } = await supabase
    .from("crm_pipeline")
    .select("*")
    .eq("account_type", "client")
    .order("company_name", { ascending: true });
  throwIf(error);
  return data ?? [];
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

/**
 * Move a prospect to another prospect_stage on the master. Direct table update
 * (RLS covers it); there is no dedicated prospect_stage RPC yet.
 */
export async function moveProspectStage(id, stageKey) {
  const { data, error } = await supabase
    .from("crm_pipeline")
    .update({ prospect_stage: stageKey, stage_entered_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  throwIf(error);
  return data;
}

/** Update a client's client_stage on the master. Direct table update (RLS covers it). */
export async function updateClientStage(id, stageKey) {
  const { data, error } = await supabase
    .from("crm_pipeline")
    .update({ client_stage: stageKey, stage_entered_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
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

/** Patch an existing activity row (subject/body/type/follow-up/outcome…). */
export async function updateActivity(id, patch) {
  const { data, error } = await supabase
    .from("crm_pipeline_activity")
    .update(patch || {})
    .eq("id", id)
    .select("*")
    .single();
  throwIf(error);
  return data;
}

/** Delete an activity row (DB trigger writes the audit history). */
export async function deleteActivity(id) {
  const { error } = await supabase
    .from("crm_pipeline_activity")
    .delete()
    .eq("id", id);
  throwIf(error);
  return true;
}

/** Toggle an activity's completion state. */
export async function markActivityComplete(id, done = true) {
  const { data, error } = await supabase
    .from("crm_pipeline_activity")
    .update({
      status: done ? "completed" : "open",
      completed_at: done ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select("*")
    .single();
  throwIf(error);
  return data;
}

/**
 * Insert a fresh copy of an activity (new id, status 'open', activity_at = now).
 * Only the user-meaningful columns are copied so DB-managed fields stay clean.
 */
export async function duplicateActivity(activity) {
  if (!activity) return null;
  const payload = {
    pipeline_id: activity.pipeline_id,
    activity_type: activity.activity_type || "note",
    subject: activity.subject ?? null,
    body: activity.body ?? null,
    owner_email: activity.owner_email ?? null,
    next_follow_up_date: activity.next_follow_up_date ?? null,
    outcome: activity.outcome ?? null,
    status: "open",
    activity_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("crm_pipeline_activity")
    .insert(payload)
    .select("*")
    .single();
  throwIf(error);
  return data;
}

/** Change history for a single activity (most recent first). */
export async function listActivityAudit(activityId) {
  try {
    const { data, error } = await supabase
      .from("crm_activity_audit")
      .select("*")
      .eq("activity_id", activityId)
      .order("changed_at", { ascending: false });
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

/** Contacts attached to an account (primary contact first). Degrades to []. */
export async function listContacts(accountId) {
  try {
    const { data, error } = await supabase
      .from("crm_account_contacts")
      .select("*")
      .eq("account_id", accountId)
      .order("is_primary", { ascending: false });
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

/** Create a contact under an account. */
export async function addContact(accountId, c) {
  const { data, error } = await supabase
    .from("crm_account_contacts")
    .insert({
      account_id: accountId,
      full_name: c.full_name || null,
      designation: c.designation || null,
      department: c.department || null,
      phone: c.phone || null,
      email: c.email || null,
      is_primary: !!c.is_primary,
      notes: c.notes || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Patch an existing contact row. */
export async function updateContact(id, patch) {
  const { data, error } = await supabase
    .from("crm_account_contacts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Delete a contact row. */
export async function deleteContact(id) {
  const { error } = await supabase
    .from("crm_account_contacts")
    .delete()
    .eq("id", id);
  if (error) throw error;
  return true;
}

/** Addresses (billing/shipping) attached to an account. Degrades to []. */
export async function listAddresses(accountId) {
  try {
    const { data, error } = await supabase
      .from("crm_account_addresses")
      .select("*")
      .eq("account_id", accountId)
      .order("address_type", { ascending: true });
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

/** Convert a prospect into a client in place via the server-side RPC. */
export async function convertToClient(accountId, clientCode) {
  const { data, error } = await supabase.rpc("crm_convert_to_client", {
    p_account_id: accountId,
    p_client_code: clientCode || null,
  });
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
/**
 * Collapse follow-ups to ONE row per account so the same company never repeats.
 * Keeps the most urgent (soonest-due) item; on a tie, prefers the pipeline
 * "action" over an activity follow-up. Pure — unit-tested.
 */
export function consolidateFollowups(items) {
  const byAccount = new Map();
  for (const it of items || []) {
    if (!it || !it.date) continue;
    const key = it.pipelineId || it.id;
    const prev = byAccount.get(key);
    if (!prev) { byAccount.set(key, it); continue; }
    const a = new Date(it.date).getTime();
    const b = new Date(prev.date).getTime();
    if (a < b || (a === b && it.kind === "action" && prev.kind !== "action")) {
      byAccount.set(key, it);
    }
  }
  return [...byAccount.values()];
}

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
  //    Exclude COMPLETED activities — a finished follow-up must not linger in
  //    the widget (this was the source of stale/repeated rows).
  const { data: actRows, error: aErr } = await supabase
    .from("crm_pipeline_activity")
    .select(
      "id,pipeline_id,subject,activity_type,next_follow_up_date,owner_email,status,crm_pipeline(company_name)",
    )
    .not("next_follow_up_date", "is", null)
    .neq("status", "completed");
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

  // One row per account (drops duplicate same-company follow-ups).
  consolidateFollowups(items).forEach((it) => {
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

/**
 * Repeat-customer reorder & retention analytics (one row per recurring customer).
 *
 * Backed by the `crm_customer_analytics` RPC (RLS-scoped server-side). Each row:
 *   { client_code, company_name, owner_email, order_count, last_order, first_order,
 *     total_value, value_12mo, cadence_days, recency_days, next_expected,
 *     due_status (new|ok|due_soon|due|overdue), churn_score }
 *
 * Never throws — returns [] on error so the dashboard widget degrades gracefully.
 */
export async function getCustomerAnalytics() {
  try {
    const { data, error } = await supabase.rpc("crm_customer_analytics");
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Prospect CRM dashboard aggregates (server-side, RLS-scoped).
 *
 * Backed by the `crm_prospect_dashboard` RPC. Returns a single jsonb object:
 *   { total_prospects, new_this_month, followups_due, followups_open,
 *     pipeline_value, weighted_pipeline, converted, conversion_rate,
 *     funnel:{ lead, contacted, meeting_scheduled, qualified, sample_sent,
 *              quotation_sent, negotiation, converted },
 *     by_owner:[{ owner_email, n }] }
 *
 * Never throws — returns null on error so the dashboard tab degrades gracefully.
 */
export async function prospectDashboard() {
  try {
    const { data, error } = await supabase.rpc("crm_prospect_dashboard");
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Client CRM dashboard aggregates (server-side, RLS-scoped).
 *
 * Backed by the `crm_client_dashboard` RPC. Returns a single jsonb object:
 *   { total_clients, by_stage:{ active, repeat_business, key_account, dormant },
 *     key_accounts, dormant, revenue_total,
 *     top_customers:[{ company_name, customer_code, revenue, owner_email }],
 *     outstanding, overdue }
 *
 * Never throws — returns null on error so the dashboard tab degrades gracefully.
 */
export async function clientDashboard() {
  try {
    const { data, error } = await supabase.rpc("crm_client_dashboard");
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Active users assignable as pipeline owners, with resolved display name.
 *
 * Backed by the `crm_assignable_users` RPC. Returns a jsonb array of
 *   { email, full_name, department, role }
 * Never throws — returns [] on error so the owner picker degrades gracefully
 * (falls back to the raw email prefix for display).
 */
export async function listAssignableUsers() {
  try {
    const { data, error } = await supabase.rpc("crm_assignable_users");
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Prioritised "who to contact today" worklist for a sales rep (or all reps).
 *
 * Backed by the `crm_rep_worklist(p_owner_email text)` RPC, which returns a
 * jsonb array of account objects already sorted by priority_score DESC. Pass
 * `null` for CEO/managers (see all accounts) or the rep's email to scope to
 * their own accounts. Each object carries the account's RFM/segment scores,
 * reorder/payment/follow-up status and a `reasons` array explaining the "why".
 *
 * Throws on error so the caller can surface it via the global Snackbar handler.
 *
 * @param {string|null} ownerEmail  rep email, or null for all accounts
 * @returns {Promise<Array<object>>}
 */
export async function repWorklist(ownerEmail = null) {
  const { data, error } = await supabase.rpc("crm_rep_worklist", {
    p_owner_email: ownerEmail || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/**
 * RFM & retention dashboard for the client base (server-side, RLS-scoped).
 *
 * Backed by the `crm_rfm_dashboard(p_owner_email text)` RPC. Pass `null` for
 * CEO/managers (all clients) or the rep's email to scope to their own accounts —
 * mirror how the dashboard already decides the owner scope. Returns a single
 * jsonb object:
 *   { total_clients,
 *     segments:[{ segment, count, total_value, avg_recency, avg_frequency, avg_value }],
 *     grid:[{ r_score, f_score, count, value }],   // sparse — non-empty cells only
 *     stats:{ repeat_rate, on_time_rate, avg_cadence_days, at_risk_value,
 *             with_orders, champions_value_pct } }
 *
 * Throws on error so the caller can surface it via the global Snackbar handler.
 *
 * @param {string|null} ownerEmail  rep email, or null for all clients
 * @returns {Promise<object|null>}
 */
export async function rfmDashboard(ownerEmail = null) {
  const { data, error } = await supabase.rpc('crm_rfm_dashboard', {
    p_owner_email: ownerEmail || null,
  });
  if (error) throw error;
  return data || null;
}

/**
 * Monthly rep target-vs-actual scorecard (server-side, RLS-scoped).
 *
 * Backed by the `crm_rep_scorecard(p_month date)` RPC. `month` may be a Date or a
 * 'YYYY-MM-01' string; it is normalized to a 'YYYY-MM-DD' date string. Returns an
 * array (sorted by achievement desc) of:
 *   { email, full_name, department, role, target_value, target_new_accounts,
 *     target_orders, notes, actual_value, actual_orders, actual_new_accounts,
 *     achievement_pct (null when no target set) }
 *
 * Throws on error so the caller can surface it via the global Snackbar handler.
 *
 * @param {Date|string} month  a Date or 'YYYY-MM-01' string
 * @returns {Promise<Array<object>>}
 */
export async function repScorecard(month) {
  const p_month = typeof month === 'string' ? month : month.toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc('crm_rep_scorecard', { p_month });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/**
 * Upsert one rep's target for a given month (managers only — RLS enforced).
 *
 * Backed by the `crm_set_rep_target` RPC. `month` may be a Date or any date string
 * in the month (server normalizes to month-first). Returns the upserted row.
 *
 * Throws on error so the caller can surface it via the global Snackbar handler.
 */
export async function setRepTarget({ ownerEmail, month, value = 0, newAccounts = 0, orders = 0, notes = null }) {
  const p_month = typeof month === 'string' ? month : month.toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc('crm_set_rep_target', {
    p_owner_email: ownerEmail,
    p_month,
    p_value: value,
    p_new_accounts: newAccounts,
    p_orders: orders,
    p_notes: notes,
  });
  if (error) throw error;
  return data;
}

/**
 * Share-of-Wallet dashboard for the client base (server-side, RLS-scoped).
 *
 * Backed by the `crm_wallet_dashboard(p_owner_email text)` RPC. Pass `null` for
 * CEO/managers (all clients) or the rep's email to scope to their own accounts —
 * mirror how the dashboard already decides the owner scope. Returns a single
 * jsonb object:
 *   { total_clients, accounts_with_potential, total_potential, captured_value,
 *     capture_rate, total_untapped,
 *     top_untapped:[{ company_name, customer_code, owner_email, industry, city,
 *                     value_12mo, annual_potential, untapped, capture_pct }] }
 *
 * Throws on error so the caller can surface it via the global Snackbar handler.
 *
 * @param {string|null} ownerEmail  rep email, or null for all clients
 * @returns {Promise<object|null>}
 */
export async function walletDashboard(ownerEmail = null) {
  const { data, error } = await supabase.rpc('crm_wallet_dashboard', {
    p_owner_email: ownerEmail || null,
  });
  if (error) throw error;
  return data || null;
}

/** Current authenticated user's email (for the My / All toggle). */
export async function getCurrentUserEmail() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data?.user?.email || null;
}

/**
 * All lead collaborators (co-working) across the pipeline.
 *
 * Returns a flat list of { pipeline_id, email } rows so the board can build a
 * pipeline_id → [emails] map. Never throws — returns [] on error so the board
 * degrades gracefully (chips simply don't render).
 */
export async function listAllCollaborators() {
  try {
    const { data, error } = await supabase
      .from("crm_pipeline_collaborators")
      .select("pipeline_id, email");
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Add a collaborator to a lead. Email is lowercased to match the table's unique
 * index on (pipeline_id, lower(email)). A duplicate insert is treated as success
 * (the collaborator is already there). Other errors are thrown.
 */
export async function addCollaborator(pipelineId, email) {
  let addedBy = null;
  try {
    addedBy = await getCurrentUserEmail();
  } catch {
    addedBy = null;
  }
  const { error } = await supabase.from("crm_pipeline_collaborators").insert({
    pipeline_id: pipelineId,
    email: String(email || "").toLowerCase(),
    added_by_email: addedBy,
  });
  // 23505 = unique_violation: collaborator already present, treat as success.
  if (error && error.code !== "23505") throw error;
  return true;
}

/** Remove a collaborator from a lead (case-insensitive email match). */
export async function removeCollaborator(pipelineId, email) {
  const { error } = await supabase
    .from("crm_pipeline_collaborators")
    .delete()
    .eq("pipeline_id", pipelineId)
    .eq("email", String(email || "").toLowerCase());
  throwIf(error);
  return true;
}

const crmPipelineService = {
  STAGES,
  PROSPECT_STAGES,
  CLIENT_STAGES,
  CYCLE_STAGES,
  STAGE_LABELS,
  PROSPECT_STAGE_LABELS,
  CLIENT_STAGE_LABELS,
  CYCLE_STAGE_LABELS,
  ACTIVITY_TYPES,
  SOURCES,
  listPipeline,
  listProspects,
  listClients,
  listRecurring,
  getCompany,
  moveStage,
  moveProspectStage,
  updateClientStage,
  addActivity,
  updateActivity,
  deleteActivity,
  markActivityComplete,
  duplicateActivity,
  listActivityAudit,
  listContacts,
  addContact,
  updateContact,
  deleteContact,
  listAddresses,
  convertToClient,
  assignOwner,
  addCompany,
  updateCompany,
  listOrderCycles,
  moveOrderCycle,
  getMyFollowups,
  rescheduleFollowup,
  completeFollowup,
  moveFollowupStage,
  getCustomerAnalytics,
  prospectDashboard,
  clientDashboard,
  listAssignableUsers,
  repWorklist,
  rfmDashboard,
  clientHealth,
  repScorecard,
  setRepTarget,
  walletDashboard,
  getCurrentUserEmail,
  listAllCollaborators,
  addCollaborator,
  removeCollaborator,
};

export default crmPipelineService;

/** Client health scores (0-100 + band) for all clients — see crm_client_health RPC. */
export async function clientHealth() {
  try {
    const { data, error } = await supabase.rpc("crm_client_health");
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("[crmPipelineService.clientHealth]", e);
    return [];
  }
}
