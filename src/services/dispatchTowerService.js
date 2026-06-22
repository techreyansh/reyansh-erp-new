// Dispatch Control Tower service — dispatch plans driven by released sales
// orders. Backward schedule is computed client-side via dispatchPlanner.
// (Separate from the legacy dispatchService.js.)
import { supabase } from '../lib/supabaseClient';

async function currentEmail() {
  try { return (await supabase.auth.getUser()).data?.user?.email || null; } catch { return null; }
}

export async function listDispatchPlans() {
  const { data, error } = await supabase.from('dispatch_plan').select('*').order('dispatch_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Released-or-later sales orders that don't yet have a dispatch plan. */
export async function listPlannableOrders() {
  const [{ data: orders }, { data: plans }] = await Promise.all([
    supabase.from('sales_order').select('*').in('status', ['approved', 'released', 'in_planning', 'in_production']),
    supabase.from('dispatch_plan').select('so_id'),
  ]);
  const planned = new Set((plans || []).map((p) => p.so_id));
  return (orders || []).filter((o) => !planned.has(o.id));
}

export async function createPlan(order, { dispatch_date, committed_date, priority }) {
  const email = await currentEmail();
  const { data, error } = await supabase.from('dispatch_plan').insert({
    so_id: order.id, so_number: order.so_number, customer_code: order.customer_code, company_name: order.company_name,
    dispatch_date, committed_date: committed_date || dispatch_date, priority: priority || order.priority || 'medium',
    total_qty: order.total_qty, total_value: order.total_value,
    created_by_email: email, owner_email: order.owner_email || email,
  }).select('*').single();
  if (error) throw error;
  return data;
}

export async function updatePlan(id, patch) {
  const { data, error } = await supabase.from('dispatch_plan')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

const dispatchTowerService = { listDispatchPlans, listPlannableOrders, createPlan, updatePlan };
export default dispatchTowerService;
