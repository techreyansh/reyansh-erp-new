// AI Sales Copilot — context engine + tool runner. gatherContext is
// LLM-independent (pulls live CRM/ERP data); runTool sends it to the
// ai-sales-copilot Edge Function (needs GEMINI_API_KEY to be set to respond).
import { supabase } from '../lib/supabaseClient';
import client360Service from './client360Service';
import { getCompany, teamPerformance, clientHealth } from './crmPipelineService';

// Tool catalogue. scope: 'account' = needs a selected account; 'base' = whole
// pipeline; 'input' = free-form text. needsInput adds a text box.
export const COPILOT_TOOLS = [
  { key: 'icp', label: 'Ideal Customer Profile', button: 'Find Similar Customers', scope: 'base', cat: 'Targeting' },
  { key: 'discovery', label: 'Discovery Questions', button: 'Generate Discovery Questions', scope: 'input', inputLabel: 'Industry / customer type / product category', cat: 'Engage' },
  { key: 'objection', label: 'Objection Handling', button: 'Handle Objection', scope: 'input', inputLabel: 'The objection (e.g. price too high)', cat: 'Engage' },
  { key: 'outreach', label: 'Cold Outreach', button: 'Generate Outreach', scope: 'account', cat: 'Engage' },
  { key: 'followup', label: 'Follow-Up Sequence', button: 'Create Follow-Up Plan', scope: 'account', cat: 'Engage' },
  { key: 'proposal', label: 'Proposal Builder', button: 'Generate Proposal', scope: 'account', cat: 'Close' },
  { key: 'debrief', label: 'Sales Call Debrief', button: 'Analyze Meeting Notes', scope: 'input', inputLabel: 'Paste meeting notes / call transcript', cat: 'Engage' },
  { key: 'pipeline', label: 'Pipeline Prioritization', button: 'Prioritize Pipeline', scope: 'base', cat: 'Manage' },
  { key: 'quotation', label: 'Quotation Strategy', button: 'Quotation Intelligence', scope: 'account', cat: 'Close' },
  { key: 'relationship', label: 'Relationship Advisor', button: 'Relationship Insights', scope: 'account', cat: 'Grow' },
  { key: 'oem_research', label: 'OEM Account Researcher', button: 'Analyze Account', scope: 'account', needsInput: true, inputLabel: 'Extra notes / website (optional)', cat: 'Targeting' },
  { key: 'persona', label: 'Decision-Maker Analyzer', button: 'Analyze Decision Maker', scope: 'input', needsAccount: true, inputLabel: 'Designation / department / notes', cat: 'Engage' },
  { key: 'recovery', label: 'Lost / Dormant Recovery', button: 'Recover Opportunity', scope: 'account', cat: 'Recover' },
];

function compactAccount(company) {
  if (!company) return null;
  const f = ['company_name', 'customer_code', 'account_type', 'prospect_stage', 'client_stage', 'industry', 'city',
    'product_category', 'business_type', 'payment_terms', 'owner_email', 'annual_potential', 'value', 'last_contact_date',
    'next_action', 'next_action_date', 'lead_source', 'rating'];
  const o = {}; f.forEach((k) => { if (company[k] != null && company[k] !== '') o[k] = company[k]; });
  return o;
}

/** Build the CRM context payload for a tool. account-scoped or base-wide. */
export async function gatherContext(account) {
  if (account?.id) {
    const [bundle, company] = await Promise.all([
      client360Service.getClient360(account).catch(() => ({})),
      getCompany(account.id).catch(() => ({})),
    ]);
    const c = company?.company || account;
    return {
      account: compactAccount(c),
      contacts: (company?.contacts || []).map((x) => ({ name: x.contact_person, designation: x.designation, phone: x.phone })),
      products: (bundle.products || []).map((p) => p.product_name),
      quotations: (bundle.quotations || []).map((q) => ({ no: q.quote_number, total: q.total, status: q.status, date: q.quote_date })),
      sales_orders: (bundle.orders || []).map((o) => ({ no: o.so_number, value: o.total_value, status: o.status })),
      outstanding: bundle.summary?.outstanding, total_orders: bundle.summary?.totalOrders,
      complaints: (bundle.complaints || []).map((x) => ({ subject: x.subject, status: x.status })),
      recent_activities: (company?.activities || []).slice(0, 12).map((a) => ({ type: a.activity_type, subject: a.subject, note: a.body, when: a.activity_at || a.created_at })),
      kit_history: (bundle.kit || []).slice(0, 10).map((k) => ({ channel: k.channel, dir: k.direction, subject: k.subject, when: k.sent_at || k.created_at })),
      health: bundle.health,
    };
  }
  // base-wide context (ICP / pipeline)
  const [team, health] = await Promise.all([teamPerformance().catch(() => []), clientHealth().catch(() => [])]);
  return {
    team_performance: team,
    clients: (health || []).map((h) => ({ name: h.company_name, health: h.health_score, band: h.band, orders: h.order_count, days_since_order: h.recency_days, value_12mo: h.value_12mo, overdue: h.overdue_balance })),
  };
}

/** Run a copilot tool: gather context + invoke the AI edge function. */
export async function runTool(toolKey, { account = null, input = '' } = {}) {
  const tool = COPILOT_TOOLS.find((t) => t.key === toolKey);
  const context = await gatherContext(tool?.scope === 'account' || tool?.needsAccount ? account : null);
  const { data, error } = await supabase.functions.invoke('ai-sales-copilot', { body: { tool: toolKey, context, input } });
  if (error) {
    // Edge function not deployed / not configured → graceful message.
    let msg = error.message || 'AI request failed';
    try { const ctx = await error.context?.json?.(); if (ctx?.error) msg = ctx.error; } catch { /* ignore */ }
    return { error: msg, context };
  }
  if (data?.error) return { error: data.error, context };
  return { sections: data?.sections || [], context };
}

/** Save an AI output back to the account's CRM timeline as a note. */
export async function saveToCRM(accountId, title, sections) {
  const body = (sections || []).map((s) => `${s.heading}\n${s.body}`).join('\n\n');
  const { error } = await supabase.from('crm_pipeline_activity').insert({
    pipeline_id: accountId, activity_type: 'note', subject: `AI: ${title}`, body: body.slice(0, 8000),
  });
  if (error) throw error;
}

const aiCopilotService = { COPILOT_TOOLS, gatherContext, runTool, saveToCRM };
export default aiCopilotService;
