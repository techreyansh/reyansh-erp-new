import { supabase } from '../lib/supabaseClient';

/**
 * Data layer for wa_provider_settings (BSP configuration: Meta Cloud API,
 * Twilio, ...). CEO/true-admin only at the RLS layer (single FOR ALL
 * is_super_admin() policy — see 20260701150000_whatsapp_marketing_rbac.sql).
 *
 * Provider-abstraction rule (Global Constraints): nothing outside
 * supabase/functions/_shared/wa/* and supabase/functions/wa-send may ever call
 * a WhatsApp provider's HTTP API directly. testConnection() below is a
 * client-side pseudo-check ONLY — it never reaches out to Meta/Twilio/etc.
 */

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

export async function listProviders() {
  const { data, error } = await supabase
    .from('wa_provider_settings')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getActiveProvider() {
  const { data, error } = await supabase
    .from('wa_provider_settings')
    .select('*')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Insert a new provider row, or patch an existing one if `fields.id` is set. */
export async function upsertProvider(fields) {
  if (fields.id) {
    const { id, ...patch } = fields;
    const { data, error } = await supabase.from('wa_provider_settings').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    return data;
  }
  const created_by = await currentUserId();
  const { data, error } = await supabase
    .from('wa_provider_settings')
    .insert({ ...fields, created_by })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Make one provider the active one.
 *
 * wa_provider_settings has NO partial-unique constraint enforcing a single
 * is_active row (confirmed by reading the Task 1 schema migration — no such
 * index was added there). Enforced here client-side per the brief's fallback:
 * clear every other row, then set this one. This is two round trips, not
 * atomic against a concurrent racing call from another tab/session — flagging
 * this to the controller in the Task 3 report as something a follow-up
 * migration (partial unique index on is_active) or a small SECURITY DEFINER
 * RPC could close more robustly later.
 */
export async function setActive(providerId) {
  const { error: clearErr } = await supabase
    .from('wa_provider_settings')
    .update({ is_active: false })
    .neq('id', providerId);
  if (clearErr) throw clearErr;
  const { data, error } = await supabase
    .from('wa_provider_settings')
    .update({ is_active: true })
    .eq('id', providerId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** Pure readiness check over a provider row's shape — no network call. Unit-tested. */
export function evaluateProviderReadiness(provider) {
  if (!provider) return { ok: false, reason: 'Provider not found.' };
  const creds = provider.credentials || {};
  if (provider.provider_key === 'meta_cloud') {
    if (!creds.access_token) return { ok: false, reason: 'Missing access_token.' };
    if (!creds.phone_number_id) return { ok: false, reason: 'Missing phone_number_id.' };
  } else if (!Object.keys(creds).length) {
    return { ok: false, reason: 'No credentials configured for this provider.' };
  }
  if (!provider.sender_number) return { ok: false, reason: 'Missing sender_number.' };
  return { ok: true, reason: null };
}

/**
 * Lightweight client-side connection "test" for V1: validates the row has the
 * fields a real send would need and records the result — it does NOT call
 * Meta's (or any BSP's) API. The real connectivity test happens server-side
 * via the wa-send adapter (Task 4), the only place allowed to talk to a
 * provider's HTTP API directly.
 */
export async function testConnection(providerId) {
  const { data: provider, error } = await supabase
    .from('wa_provider_settings')
    .select('*')
    .eq('id', providerId)
    .single();
  if (error) throw error;

  const result = evaluateProviderReadiness(provider);
  const patch = {
    last_health_check_at: new Date().toISOString(),
    health_status: result.ok ? 'ok' : 'error',
    health_reason: result.reason,
  };
  const { data: updated, error: uErr } = await supabase
    .from('wa_provider_settings')
    .update(patch)
    .eq('id', providerId)
    .select('*')
    .single();
  if (uErr) throw uErr;
  return { ...result, provider: updated };
}

const waProviderService = {
  listProviders,
  getActiveProvider,
  upsertProvider,
  setActive,
  evaluateProviderReadiness,
  testConnection,
};

export default waProviderService;
