import { supabase } from '../lib/supabaseClient';

/**
 * Generic master-data CRUD for the MES setup screens. One service + one UI
 * component drive every master (molding, packing, shift, department,
 * workstation, A/B-side config), so all masters behave identically.
 */
function throwIf(error, ctx) { if (error) throw new Error(`${ctx ? ctx + ': ' : ''}${error.message}`); }

export async function listRows(table, { orderBy = 'created_at', ascending = true } = {}) {
  const { data, error } = await supabase.from(table).select('*').order(orderBy, { ascending });
  throwIf(error, `Load ${table}`);
  return data || [];
}

export async function saveRow(table, row) {
  const clean = { ...row };
  delete clean.created_at;
  if (clean.id) {
    const id = clean.id; delete clean.id;
    const { data, error } = await supabase.from(table).update(clean).eq('id', id).select('*').single();
    throwIf(error, `Update ${table}`); return data;
  }
  delete clean.id;
  const { data, error } = await supabase.from(table).insert(clean).select('*').single();
  throwIf(error, `Create ${table}`); return data;
}

export async function deleteRow(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  throwIf(error, `Delete ${table}`);
}

/** Options for FK-ish select fields (products, departments, machines). */
export async function options(table, labelCol = 'name', valueCol = 'id', extra = '') {
  const sel = extra ? `${valueCol}, ${labelCol}, ${extra}` : `${valueCol}, ${labelCol}`;
  const { data, error } = await supabase.from(table).select(sel).limit(500);
  throwIf(error, `Options ${table}`);
  return (data || []).map((r) => ({ value: r[valueCol], label: r[labelCol] || r[valueCol] }));
}

const mesMasterService = { listRows, saveRow, deleteRow, options };
export default mesMasterService;
