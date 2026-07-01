import { supabase } from '../lib/supabaseClient';

/**
 * Data layer for WhatsApp Marketing campaigns/steps/enrollments
 * (wa_campaigns, wa_campaign_steps, wa_campaign_media, wa_enrollments).
 * Talks to Supabase directly (RLS-gated by the 'marketing' module), matching
 * the style of campaignsService.js (the email module's twin).
 */

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

/**
 * Allowed campaign status transitions (mirrors the plan brief exactly):
 *   draft     -> scheduled, running
 *   running   -> paused, stopped, completed
 *   paused    -> running, stopped
 * 'scheduled', 'completed', 'stopped' and 'failed' have no client-validated
 * forward transition defined here — a scheduled campaign flipping to running
 * when its start_at arrives is expected to be a server-side/scheduler concern
 * (a future edge function), not this UI-facing validator. Flagged in the
 * Task 3 report as an open question for whoever builds that scheduler.
 */
export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'running', 'paused', 'completed', 'stopped', 'failed'];

export const STATUS_TRANSITIONS = {
  draft: ['scheduled', 'running'],
  scheduled: [],
  running: ['paused', 'stopped', 'completed'],
  paused: ['running', 'stopped'],
  completed: [],
  stopped: [],
  failed: [],
};

/** Pure transition check — unit-tested. */
export function isValidStatusTransition(from, to) {
  if (!from || !to || from === to) return false;
  return (STATUS_TRANSITIONS[from] || []).includes(to);
}

/** Campaign list (RLS-scoped). */
export async function listCampaigns({ status = null, ownerEmail = null, search = '' } = {}) {
  let q = supabase.from('wa_campaigns').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (ownerEmail) q = q.eq('owner_email', ownerEmail);
  if (search) q = q.ilike('name', `%${search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** One campaign with its steps (ordered) and media joined in. */
export async function getCampaign(id) {
  const { data: campaign, error } = await supabase.from('wa_campaigns').select('*').eq('id', id).single();
  if (error) throw error;

  const { data: steps, error: sErr } = await supabase
    .from('wa_campaign_steps')
    .select('*')
    .eq('campaign_id', id)
    .order('step_order', { ascending: true });
  if (sErr) throw sErr;

  const { data: media, error: mErr } = await supabase
    .from('wa_campaign_media')
    .select('*')
    .eq('campaign_id', id)
    .order('sort_order', { ascending: true });
  if (mErr) throw mErr;

  return { ...campaign, steps: steps || [], media: media || [] };
}

export async function createCampaign(fields) {
  const created_by = await currentUserId();
  const { data, error } = await supabase.from('wa_campaigns').insert({ ...fields, created_by }).select('*').single();
  if (error) throw error;
  return data;
}

export async function updateCampaign(id, fields) {
  const { data, error } = await supabase.from('wa_campaigns').update(fields).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

/** Create a step. Auto-assigns the next step_order if not given (satisfies the (campaign_id, step_order) unique constraint). */
export async function createStep(campaignId, fields = {}) {
  let stepOrder = fields.stepOrder ?? fields.step_order;
  if (stepOrder == null) {
    const { data: existing, error: exErr } = await supabase
      .from('wa_campaign_steps')
      .select('step_order')
      .eq('campaign_id', campaignId)
      .order('step_order', { ascending: false })
      .limit(1);
    if (exErr) throw exErr;
    stepOrder = existing && existing[0]?.step_order != null ? existing[0].step_order + 1 : 0;
  }
  const { data, error } = await supabase
    .from('wa_campaign_steps')
    .insert({
      campaign_id: campaignId,
      step_order: stepOrder,
      delay_type: fields.delayType ?? fields.delay_type ?? 'immediate',
      delay_days: fields.delayDays ?? fields.delay_days ?? 0,
      body_text: fields.bodyText ?? fields.body_text ?? null,
      is_active: fields.isActive ?? fields.is_active ?? true,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateStep(stepId, fields = {}) {
  const patch = {};
  if (fields.stepOrder != null || fields.step_order != null) patch.step_order = fields.stepOrder ?? fields.step_order;
  if (fields.delayType != null || fields.delay_type != null) patch.delay_type = fields.delayType ?? fields.delay_type;
  if (fields.delayDays != null || fields.delay_days != null) patch.delay_days = fields.delayDays ?? fields.delay_days;
  if ('bodyText' in fields || 'body_text' in fields) patch.body_text = fields.bodyText ?? fields.body_text;
  if (fields.isActive != null || fields.is_active != null) patch.is_active = fields.isActive ?? fields.is_active;
  const { data, error } = await supabase.from('wa_campaign_steps').update(patch).eq('id', stepId).select('*').single();
  if (error) throw error;
  return data;
}

export async function deleteStep(stepId) {
  const { error } = await supabase.from('wa_campaign_steps').delete().eq('id', stepId);
  if (error) throw error;
  return true;
}

/**
 * Persist a new step order. Two-phase update (offset then final) avoids
 * transiently colliding with another step's current step_order under the
 * unique (campaign_id, step_order) constraint.
 */
export async function reorderSteps(campaignId, orderedStepIds) {
  const ids = orderedStepIds || [];
  const OFFSET = 100000;
  for (let i = 0; i < ids.length; i += 1) {
    const { error } = await supabase
      .from('wa_campaign_steps')
      .update({ step_order: OFFSET + i })
      .eq('id', ids[i])
      .eq('campaign_id', campaignId);
    if (error) throw error;
  }
  for (let i = 0; i < ids.length; i += 1) {
    const { error } = await supabase
      .from('wa_campaign_steps')
      .update({ step_order: i })
      .eq('id', ids[i])
      .eq('campaign_id', campaignId);
    if (error) throw error;
  }
  return true;
}

/** Copy a step to the end of its campaign's sequence. */
export async function duplicateStep(stepId) {
  const { data: step, error } = await supabase.from('wa_campaign_steps').select('*').eq('id', stepId).single();
  if (error) throw error;
  return createStep(step.campaign_id, {
    delayType: step.delay_type,
    delayDays: step.delay_days,
    bodyText: step.body_text,
    isActive: step.is_active,
  });
}

/**
 * List a campaign's enrollments with their contact joined in. Added for Task 8
 * (Campaign Wizard) — StepAudience needs to know which contacts are already
 * enrolled (to pre-check them when resuming a draft) and StepReview needs an
 * enrolled count for its summary; Task 3 exposed enrollContacts (write) but no
 * read-back. Mirrors the email module's campaignsService.listEnrollments.
 */
export async function listEnrollments(campaignId) {
  const { data, error } = await supabase
    .from('wa_enrollments')
    .select('*, wa_contacts(id, contact_name, whatsapp_number, company)')
    .eq('campaign_id', campaignId)
    .order('enrolled_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Enroll contacts into a campaign via the SECURITY DEFINER RPC. Returns the count actually inserted (dupes/opted-out skipped server-side). */
export async function enrollContacts(campaignId, contactIds) {
  const { data, error } = await supabase.rpc('wa_enroll_contacts', {
    p_campaign_id: campaignId,
    p_contact_ids: contactIds,
  });
  if (error) throw error;
  return data;
}

/**
 * wa_messages statuses that `wa_dashboard_counts`'s `pending_messages` counts
 * as still outstanding (see the RPC in
 * 20260701140000_whatsapp_marketing_schema.sql). Cancellation below moves rows
 * out of this set so a stopped campaign's un-sent messages stop being counted
 * as pending everywhere (dashboard + campaignAnalytics) the moment Stop lands.
 */
export const PENDING_MESSAGE_STATUSES = ['scheduled', 'queued', 'sending', 'retry_pending'];

/**
 * Cancel a campaign's not-yet-sent messages (called by setStatus when moving
 * to 'stopped'). Terminal state chosen: status='failed', error='cancelled',
 * failed_at=now(). Rationale: 'failed' is already the one terminal/non-sent
 * status wa_dashboard_counts and campaignAnalytics both understand — reusing
 * it (rather than inventing e.g. a 'cancelled' status not in the DB check
 * constraint) means cancelled rows automatically fall out of "pending"
 * everywhere without any new bucket the UI would need to special-case, while
 * still being distinguishable from real send failures via `error='cancelled'`.
 */
export async function cancelPendingMessages(campaignId) {
  const { data, error } = await supabase
    .from('wa_messages')
    .update({ status: 'failed', error: 'cancelled', failed_at: new Date().toISOString() })
    .eq('campaign_id', campaignId)
    .in('status', PENDING_MESSAGE_STATUSES)
    .select('id');
  if (error) throw error;
  return (data || []).length;
}

/**
 * Change a campaign's status, validated client-side (belt-and-suspenders —
 * RLS/DB don't enforce the state machine). Moving to 'stopped' additionally
 * cancels the campaign's not-yet-sent wa_messages (see cancelPendingMessages).
 */
export async function setStatus(campaignId, status) {
  const { data: current, error: curErr } = await supabase
    .from('wa_campaigns')
    .select('status')
    .eq('id', campaignId)
    .single();
  if (curErr) throw curErr;
  if (!isValidStatusTransition(current.status, status)) {
    throw new Error(`Cannot move campaign from '${current.status}' to '${status}'.`);
  }
  const { data, error } = await supabase.from('wa_campaigns').update({ status }).eq('id', campaignId).select('*').single();
  if (error) throw error;
  if (status === 'stopped') {
    await cancelPendingMessages(campaignId);
  }
  return data;
}

const waCampaignsService = {
  CAMPAIGN_STATUSES,
  STATUS_TRANSITIONS,
  isValidStatusTransition,
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  createStep,
  updateStep,
  deleteStep,
  reorderSteps,
  duplicateStep,
  listEnrollments,
  enrollContacts,
  setStatus,
  PENDING_MESSAGE_STATUSES,
  cancelPendingMessages,
};

export default waCampaignsService;
