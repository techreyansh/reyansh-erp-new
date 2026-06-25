import { supabase } from "../lib/supabaseClient";

/**
 * KIT (Keep In Touch) marketing-automation service.
 *
 * KIT is a communications engine that sits on top of the unified CRM master —
 * the CRM (`crm_pipeline`) is the single source of truth for contacts; KIT never
 * duplicates them. This service reads the reachable-contact view, KIT's dashboard
 * RPC, templates and workflows, and logs every outbound message back into the CRM
 * activity timeline via `kit_log_message`.
 *
 * Unlike crmPipelineService (which throws so the global Snackbar can surface the
 * error), KIT is a "nice to have" engagement layer — it MUST degrade gracefully.
 * Every method is defensive and returns [] / null on error so the UI keeps
 * rendering even if a table/RPC is missing.
 */

/** KIT communication channels. */
export const CHANNELS = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
  { key: "push", label: "Push" },
  { key: "portal", label: "Portal" },
];

export const CHANNEL_LABELS = CHANNELS.reduce((acc, c) => {
  acc[c.key] = c.label;
  return acc;
}, {});

/** Engagement colour scale buckets (score 0-100). */
export function engagementTier(score) {
  const n = Number(score) || 0;
  if (n >= 66) return "high";
  if (n >= 33) return "medium";
  return "low";
}

/**
 * KIT dashboard KPIs via the `kit_dashboard` RPC.
 * @returns {object|null}
 *   { total_contacts, whatsapp_enabled, email_enabled, no_communication,
 *     messages_this_month, open_followups, needs_attention, at_risk,
 *     avg_engagement } or null on error.
 */
export async function dashboard() {
  try {
    const { data, error } = await supabase.rpc("kit_dashboard");
    if (error) return null;
    // RPCs returning a single composite row may arrive as an array of one.
    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  } catch {
    return null;
  }
}

/**
 * Reachable CRM contacts from `v_kit_contacts`.
 *
 * Server-side `.eq` filters are applied for the columns the view indexes well
 * (account_type / industry / city / customer_category / owner_email). The
 * derived boolean / channel flags (needs_followup, at_risk, no_communication,
 * channel) are filtered client-side so the UI's quick chips stay snappy without
 * extra round-trips.
 *
 * @param {object} [filters]
 * @returns {Promise<Array>} contact rows ([] on error)
 */
export async function listContacts(filters = {}) {
  try {
    let q = supabase.from("v_kit_contacts").select("*");

    const eqMap = {
      account_type: filters.account_type,
      industry: filters.industry,
      city: filters.city,
      customer_category: filters.customer_category,
      owner_email: filters.owner_email,
    };
    Object.entries(eqMap).forEach(([col, val]) => {
      if (val != null && val !== "" && val !== "all") q = q.eq(col, val);
    });

    const { data, error } = await q.order("days_since_touch", {
      ascending: false,
      nullsFirst: false,
    });
    if (error) return [];
    let rows = data || [];

    // Client-side derived filters.
    if (filters.needs_followup) rows = rows.filter((r) => r.needs_followup);
    if (filters.at_risk) rows = rows.filter((r) => r.at_risk);
    if (filters.no_communication) {
      rows = rows.filter(
        (r) => !r.interactions || Number(r.interactions) === 0,
      );
    }
    if (filters.whatsapp_enabled) rows = rows.filter((r) => r.whatsapp_enabled);
    if (filters.email_enabled) rows = rows.filter((r) => r.email_enabled);
    if (filters.channel === "whatsapp") {
      rows = rows.filter((r) => r.whatsapp_enabled);
    } else if (filters.channel === "email") {
      rows = rows.filter((r) => r.email_enabled);
    }

    return rows;
  } catch {
    return [];
  }
}

/**
 * KIT message templates from `kit_templates`, optionally scoped to a channel.
 * @param {string} [channel]
 * @returns {Promise<Array>} ([] on error)
 */
export async function listTemplates(channel) {
  try {
    let q = supabase.from("kit_templates").select("*");
    if (channel) q = q.eq("channel", channel);
    const { data, error } = await q
      .order("channel", { ascending: true })
      .order("name", { ascending: true });
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/** Insert or update (upsert by id) a template. Returns the row or null. */
export async function saveTemplate(t) {
  try {
    const payload = {
      channel: t.channel,
      category: t.category || null,
      name: t.name,
      subject: t.subject || null,
      body: t.body || null,
      is_active: t.is_active !== false,
    };
    if (t.id) payload.id = t.id;
    const { data, error } = await supabase
      .from("kit_templates")
      .upsert(payload)
      .select("*")
      .single();
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

/** Delete a template by id. Returns true on success, false on error. */
export async function deleteTemplate(id) {
  try {
    const { error } = await supabase.from("kit_templates").delete().eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Log (and optionally schedule) an outbound message via `kit_log_message`.
 * This writes a `kit_message` row AND mirrors the touch into the CRM activity
 * timeline — call it for EVERY send or schedule.
 *
 * @param {object} p
 * @param {string} p.accountId   crm_pipeline account id (required)
 * @param {string} p.channel     'whatsapp'|'email'|'sms'|'push'|'portal'
 * @param {string} [p.subject]
 * @param {string} [p.body]
 * @param {string} [p.contactId]
 * @param {string} [p.templateId]
 * @param {string} [p.recipient]    phone / email actually used
 * @param {string} [p.scheduledFor] ISO timestamp; null = send now
 * @returns {Promise<*|null>} RPC result or null on error.
 */
export async function logMessage({
  accountId,
  channel,
  subject,
  body,
  contactId,
  templateId,
  recipient,
  scheduledFor,
} = {}) {
  try {
    const { data, error } = await supabase.rpc("kit_log_message", {
      p_account_id: accountId,
      p_channel: channel,
      p_subject: subject || null,
      p_body: body || null,
      p_contact_id: contactId || null,
      p_template_id: templateId || null,
      p_recipient: recipient || null,
      p_scheduled_for: scheduledFor || null,
    });
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Create a CRM follow-up note for an account. Inserts a `crm_pipeline_activity`
 * row so the follow-up shows up in the rep's CRM "My Follow-ups" widget.
 *
 * @param {string} accountId  crm_pipeline id (pipeline_id)
 * @param {{subject:string, date:string, owner:string}} payload
 * @returns {Promise<*|null>}
 */
export async function createFollowup(accountId, { subject, date, owner } = {}) {
  try {
    const { data, error } = await supabase
      .from("crm_pipeline_activity")
      .insert({
        pipeline_id: accountId,
        activity_type: "note",
        subject: subject || "Follow-up",
        next_follow_up_date: date || null,
        status: "open",
        owner_email: owner || null,
      })
      .select("*")
      .single();
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

/**
 * Assign / reassign a salesperson (owner) on the CRM master. The KIT contact's
 * account_id is the crm_pipeline row id.
 */
export async function assignOwner(accountId, email) {
  try {
    const { data, error } = await supabase
      .from("crm_pipeline")
      .update({ owner_email: email })
      .eq("id", accountId)
      .select("*")
      .single();
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

/** KIT automation workflows from `kit_workflows`. ([] on error.) */
export async function listWorkflows() {
  try {
    const { data, error } = await supabase
      .from("kit_workflows")
      .select("*")
      .order("name", { ascending: true });
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/** Insert or update (upsert by id) a workflow. Returns the row or null. */
export async function saveWorkflow(w) {
  try {
    const payload = {
      name: w.name,
      description: w.description || null,
      trigger_type: w.trigger_type || null,
      trigger_config: w.trigger_config || {},
      steps: w.steps || [],
      is_active: w.is_active !== false,
    };
    if (w.id) payload.id = w.id;
    const { data, error } = await supabase
      .from("kit_workflows")
      .upsert(payload)
      .select("*")
      .single();
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

const kitService = {
  CHANNELS,
  CHANNEL_LABELS,
  engagementTier,
  dashboard,
  listContacts,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  logMessage,
  createFollowup,
  assignOwner,
  listWorkflows,
  saveWorkflow,
};

export default kitService;
