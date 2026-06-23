// Customer portal — public data fetch (token) + staff admin for access links.
import { supabase } from '../lib/supabaseClient';

/** Public: resolve a portal token to that customer's data (orders/invoices/dispatch). */
export async function getPortalData(token) {
  const { data, error } = await supabase.rpc('portal_get_data', { p_token: token });
  if (error) throw error;
  return data; // { error } or { customer, orders, invoices, dispatches }
}

/** Staff: list all portal access links. */
export async function listAccess() {
  const { data, error } = await supabase.from('customer_portal_access').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Staff: create (or re-activate) a portal link for a customer. */
export async function createAccess(customerCode, companyName) {
  if (!customerCode) throw new Error('Customer code is required.');
  let email = null;
  try { email = (await supabase.auth.getUser()).data?.user?.email || null; } catch { /* ignore */ }
  const { data, error } = await supabase.from('customer_portal_access')
    .upsert({ customer_code: customerCode, company_name: companyName || null, is_active: true, created_by_email: email }, { onConflict: 'customer_code' })
    .select().single();
  if (error) throw error;
  return data;
}

export async function setActive(id, isActive) {
  const { error } = await supabase.from('customer_portal_access').update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
}

export function portalUrl(token) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/portal/${token}`;
}

const portalService = { getPortalData, listAccess, createAccess, setActive, portalUrl };
export default portalService;
