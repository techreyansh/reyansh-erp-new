import { supabase } from '../lib/supabaseClient';

/**
 * MES service — Power Cord Manufacturing Execution & Planning.
 * Phase 1: the Assembly Operation Master (the catalogue of operations that
 * configurable routings are built from).
 */

export const OPERATION_CATEGORIES = ['cutting', 'assembly', 'molding', 'testing', 'packing', 'other'];

function throwIf(error, ctx) { if (error) throw new Error(`${ctx ? ctx + ': ' : ''}${error.message}`); }

export async function listOperations({ includeInactive = true } = {}) {
  let q = supabase.from('assembly_operation').select('*').order('category').order('name');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  throwIf(error, 'List operations');
  return data || [];
}

export async function saveOperation(op) {
  const row = {
    operation_code: op.operation_code || null, name: op.name, category: op.category || 'assembly',
    std_time_sec: op.std_time_sec === '' ? null : op.std_time_sec,
    uph: op.uph === '' ? null : op.uph,
    manpower_reqd: op.manpower_reqd === '' ? null : op.manpower_reqd,
    tools_reqd: op.tools_reqd || null, quality_critical: !!op.quality_critical,
    is_active: op.is_active !== false, notes: op.notes || null, updated_at: new Date().toISOString(),
  };
  if (op.id) {
    const { data, error } = await supabase.from('assembly_operation').update(row).eq('id', op.id).select('*').single();
    throwIf(error, 'Update operation'); return data;
  }
  const { data, error } = await supabase.from('assembly_operation').insert(row).select('*').single();
  throwIf(error, 'Create operation'); return data;
}

export async function deleteOperation(id) {
  const { error } = await supabase.from('assembly_operation').delete().eq('id', id);
  throwIf(error, 'Delete operation');
}

const mesService = { OPERATION_CATEGORIES, listOperations, saveOperation, deleteOperation };
export default mesService;
