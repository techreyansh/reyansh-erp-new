// Production module read helpers — open work orders + their stages. Reads go
// through the foundation cache so pickers open offline from the last snapshot.
// Cache keys here line up with module.js offlineEntities (open_wos, wo_stages:*).
import { supabase } from '../../../lib/supabaseClient';
import * as cache from '../../core/sync/cache';

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/** Open work orders (planned/released/in_progress/qc). Cached as open_wos. */
export async function listOpenWOs(api) {
  return api.read('ppc_wo', {
    select: 'id, wo_number, item_id, qty, produced_qty, status',
    filters: [{ col: 'status', op: 'in', val: '(planned,released,in_progress,qc)' }],
    order: { col: 'wo_number', ascending: true },
    cacheAs: 'open_wos',
  });
}

/** Routed stages for one WO (sequence order). Cached per WO. */
export async function listStages(api, woId) {
  if (!woId) return [];
  const cacheKey = `wo_stages:${woId}`;
  if (isOnline()) {
    try {
      const { data, error } = await supabase
        .from('ppc_wo_stage')
        .select('id, stage_name, sequence, status, output_qty')
        .eq('work_order_id', woId)
        .order('sequence', { ascending: true });
      if (error) throw error;
      const rows = data || [];
      await cache.put(cacheKey, rows);
      return rows;
    } catch {
      return cache.get(cacheKey);
    }
  }
  return cache.get(cacheKey);
}
