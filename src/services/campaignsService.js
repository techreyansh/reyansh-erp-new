// Data layer for the Email Campaigns module (under CRM).
// Talks to Supabase directly (RLS-gated) for the email_* tables, calls the
// email_upsert_contact / email_enroll_contacts RPCs, and invokes the
// email-generate / email-send / email-scheduler Edge Functions.
import { supabase } from '../lib/supabaseClient';

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

const campaignsService = {
  // ===================== CONTACTS / AUDIENCE =====================
  async listContacts({ search = '', status = null, tag = null, limit = 500 } = {}) {
    let q = supabase.from('email_contacts').select('*').order('created_at', { ascending: false }).limit(limit);
    if (status) q = q.eq('status', status);
    if (tag) q = q.contains('tags', [tag]);
    if (search) q = q.or(`email.ilike.%${search}%,full_name.ilike.%${search}%,company.ilike.%${search}%`);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  // Upsert one contact (dedupes on email) via the SECURITY DEFINER RPC.
  async upsertContact(c) {
    const { data, error } = await supabase.rpc('email_upsert_contact', {
      p_email: c.email,
      p_first_name: c.first_name ?? null,
      p_last_name: c.last_name ?? null,
      p_company: c.company ?? null,
      p_title: c.title ?? null,
      p_phone: c.phone ?? null,
      p_source: c.source ?? 'manual',
      p_crm_lead_id: c.crm_lead_id ?? null,
      p_attributes: c.attributes ?? {},
      p_tags: c.tags ?? [],
      p_import_batch_id: c.import_batch_id ?? null,
    });
    if (error) throw error;
    return data; // contact id
  },

  // Bulk import rows from a parsed CSV/XLSX. `rows` already mapped to contact fields.
  async bulkImport(rows, { name, filename } = {}) {
    const created_by = await currentUserId();
    const { data: batch, error: bErr } = await supabase
      .from('email_import_batches')
      .insert({ name, filename, total_rows: rows.length, created_by })
      .select('id')
      .single();
    if (bErr) throw bErr;

    let imported = 0;
    let skipped = 0;
    const errors = [];
    for (const r of rows) {
      const email = (r.email || '').trim();
      if (!email || !email.includes('@')) { skipped++; continue; }
      try {
        await this.upsertContact({ ...r, source: 'import', import_batch_id: batch.id });
        imported++;
      } catch (e) {
        skipped++;
        errors.push({ email, error: e.message });
      }
    }
    await supabase.from('email_import_batches')
      .update({ imported_rows: imported, skipped_rows: skipped })
      .eq('id', batch.id);
    return { batchId: batch.id, imported, skipped, errors };
  },

  // Pull contacts that exist in CRM leads (with an email) into the audience.
  async pullFromCrm() {
    const { data: leads, error } = await supabase
      .from('crm_leads')
      .select('id, company_name, contact_person, email, phone')
      .not('email', 'is', null);
    if (error) throw error;

    let imported = 0;
    for (const l of (leads || [])) {
      const email = (l.email || '').trim();
      if (!email || !email.includes('@')) continue;
      const [first, ...rest] = (l.contact_person || '').split(' ');
      await this.upsertContact({
        email,
        first_name: first || null,
        last_name: rest.join(' ') || null,
        company: l.company_name || null,
        phone: l.phone || null,
        source: 'crm',
        crm_lead_id: l.id,
      });
      imported++;
    }
    return { imported };
  },

  async setContactStatus(id, status) {
    const patch = { status };
    if (status === 'unsubscribed') patch.unsubscribed_at = new Date().toISOString();
    const { error } = await supabase.from('email_contacts').update(patch).eq('id', id);
    if (error) throw error;
  },

  async deleteContact(id) {
    const { error } = await supabase.from('email_contacts').delete().eq('id', id);
    if (error) throw error;
  },

  // ===================== CAMPAIGNS =====================
  async listCampaigns() {
    const { data, error } = await supabase.from('email_campaigns').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getCampaign(id) {
    const { data, error } = await supabase.from('email_campaigns').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  async createCampaign(payload) {
    const created_by = await currentUserId();
    const { data, error } = await supabase.from('email_campaigns')
      .insert({ ...payload, created_by }).select('*').single();
    if (error) throw error;
    return data;
  },

  async updateCampaign(id, patch) {
    const { data, error } = await supabase.from('email_campaigns').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    return data;
  },

  async setCampaignStatus(id, status) {
    return this.updateCampaign(id, { status });
  },

  async deleteCampaign(id) {
    const { error } = await supabase.from('email_campaigns').delete().eq('id', id);
    if (error) throw error;
  },

  // ===================== STEPS =====================
  async listSteps(campaignId) {
    const { data, error } = await supabase.from('email_campaign_steps')
      .select('*').eq('campaign_id', campaignId).order('step_order', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async upsertStep(step) {
    const { data, error } = await supabase.from('email_campaign_steps')
      .upsert(step, { onConflict: 'campaign_id,step_order' }).select('*').single();
    if (error) throw error;
    return data;
  },

  async deleteStep(id) {
    const { error } = await supabase.from('email_campaign_steps').delete().eq('id', id);
    if (error) throw error;
  },

  // ===================== ENROLLMENTS =====================
  async enroll(campaignId, contactIds) {
    const { data, error } = await supabase.rpc('email_enroll_contacts', {
      p_campaign_id: campaignId,
      p_contact_ids: contactIds,
    });
    if (error) throw error;
    return data; // number enrolled
  },

  async listEnrollments(campaignId) {
    const { data, error } = await supabase.from('email_enrollments')
      .select('*, contact:email_contacts(email, full_name, company)')
      .eq('campaign_id', campaignId)
      .order('enrolled_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async pauseEnrollment(id) {
    const { error } = await supabase.from('email_enrollments').update({ status: 'paused', next_send_at: null }).eq('id', id);
    if (error) throw error;
  },

  async resumeEnrollment(id) {
    const { error } = await supabase.from('email_enrollments').update({ status: 'active', next_send_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  },

  // ===================== MESSAGES / REVIEW QUEUE =====================
  async listReviewQueue(campaignId = null) {
    let q = supabase.from('email_messages')
      .select('*, contact:email_contacts(email, full_name, company), campaign:email_campaigns(name)')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: true });
    if (campaignId) q = q.eq('campaign_id', campaignId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async listMessages({ campaignId = null, status = null, limit = 200 } = {}) {
    let q = supabase.from('email_messages')
      .select('*, contact:email_contacts(email, full_name, company)')
      .order('created_at', { ascending: false }).limit(limit);
    if (campaignId) q = q.eq('campaign_id', campaignId);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async updateMessage(id, patch) {
    const editor = await currentUserId();
    const { error } = await supabase.from('email_messages')
      .update({ ...patch, edited_by: editor }).eq('id', id);
    if (error) throw error;
  },

  // Approve a reviewed draft and send it now. The DB trigger advances the enrollment.
  async approveAndSend(messageId) {
    const approver = await currentUserId();
    await supabase.from('email_messages')
      .update({ status: 'approved', approved_by: approver, approved_at: new Date().toISOString() })
      .eq('id', messageId);
    const { data, error } = await supabase.functions.invoke('email-send', { body: { message_id: messageId } });
    if (error) throw new Error(this._fnError(error, 'email-send'));
    if (data?.error) throw new Error(data.error);
    return data;
  },

  async skipMessage(id) {
    const { error } = await supabase.from('email_messages').update({ status: 'skipped' }).eq('id', id);
    if (error) throw error;
  },

  // Regenerate a draft (keeps it in review).
  async regenerate(message, campaign, step, contact) {
    const draft = await this.generateDraft({ contact, campaign, step });
    await this.updateMessage(message.id, { subject: draft.subject, body: draft.body, ai_model: draft.model });
    return draft;
  },

  // ===================== EDGE FUNCTIONS =====================
  async generateDraft({ contact, campaign, step, priorMessages = [] }) {
    const { data, error } = await supabase.functions.invoke('email-generate', {
      body: { contact, campaign, step, priorMessages },
    });
    if (error) throw new Error(this._fnError(error, 'email-generate'));
    if (data?.error) throw new Error(data.error);
    return data; // { subject, body, preview_text, model }
  },

  async runSchedulerNow() {
    const { data, error } = await supabase.functions.invoke('email-scheduler', { body: {} });
    if (error) throw new Error(this._fnError(error, 'email-scheduler'));
    if (data?.error) throw new Error(data.error);
    return data;
  },

  async runReplyPollNow() {
    const { data, error } = await supabase.functions.invoke('email-poll-replies', { body: {} });
    if (error) throw new Error(this._fnError(error, 'email-poll-replies'));
    if (data?.error) throw new Error(data.error);
    return data;
  },

  // ===================== STATS =====================
  async getCampaignStats(campaignId) {
    const { data: events } = await supabase.from('email_events')
      .select('type').eq('campaign_id', campaignId);
    const counts = { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
    for (const e of (events || [])) { if (counts[e.type] != null) counts[e.type]++; }
    const { count: enrolled } = await supabase.from('email_enrollments')
      .select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId);
    return { ...counts, enrolled: enrolled || 0 };
  },

  _fnError(error, name) {
    const msg = error?.message || String(error);
    if (/Failed to fetch|not found|404/i.test(msg)) {
      return `${name} not reachable. Deploy it: supabase functions deploy ${name}`;
    }
    return msg;
  },
};

export default campaignsService;
