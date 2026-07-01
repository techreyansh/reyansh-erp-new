import { supabase } from '../lib/supabaseClient';

/**
 * Data layer for the WhatsApp Marketing Live Monitor + dashboard (wa_messages,
 * wa_events) and the two read-only dashboard RPCs.
 */

/** Messages, most recent first — backs the Live Monitor. */
export async function listMessages({ campaignId = null, status = null, contactId = null, limit = 200 } = {}) {
  let q = supabase.from('wa_messages').select('*').order('created_at', { ascending: false }).limit(limit);
  if (campaignId) q = q.eq('campaign_id', campaignId);
  if (status) q = q.eq('status', status);
  if (contactId) q = q.eq('contact_id', contactId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Headline dashboard counts — wraps the wa_dashboard_counts SECURITY DEFINER RPC. */
export async function dashboardCounts() {
  const { data, error } = await supabase.rpc('wa_dashboard_counts');
  if (error) throw error;
  return data || {};
}

/** Active provider's connection status — wraps the wa_provider_status SECURITY DEFINER RPC. Never carries credentials (enforced server-side). */
export async function providerStatus() {
  const { data, error } = await supabase.rpc('wa_provider_status');
  if (error) throw error;
  return data || { connected: false };
}

/**
 * Reduce a flat list of wa_messages rows into campaign analytics. Pure —
 * unit-tested. `replies` is always 0 here (messages carry no reply info);
 * campaignAnalytics() below fills it in from wa_events.
 */
export function reduceCampaignAnalytics(messages) {
  const list = messages || [];
  const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

  const totalContacts = new Set(list.map((m) => m.contact_id).filter(Boolean)).size;
  const sent = list.filter((m) => !!m.sent_at).length;
  const delivered = list.filter((m) => !!m.delivered_at).length;
  const read = list.filter((m) => !!m.read_at).length;
  const failed = list.filter((m) => m.status === 'failed').length;
  const completed = list.filter((m) => ['sent', 'delivered', 'read'].includes(m.status)).length;

  return {
    totalContacts,
    totalMessages: list.length,
    sent,
    delivered,
    read,
    failed,
    replies: 0,
    deliveryRate: pct(delivered, sent),
    readRate: pct(read, sent),
    completionRate: pct(completed, list.length),
  };
}

/** Full campaign analytics: message-derived stats + inbound reply count from wa_events. */
export async function campaignAnalytics(campaignId) {
  const messages = await listMessages({ campaignId, limit: 10000 });
  const { count: replies, error: rErr } = await supabase
    .from('wa_events')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('direction', 'inbound');
  if (rErr) throw rErr;
  return { ...reduceCampaignAnalytics(messages), replies: replies || 0 };
}

const waMessagesService = {
  listMessages,
  dashboardCounts,
  providerStatus,
  reduceCampaignAnalytics,
  campaignAnalytics,
};

export default waMessagesService;
