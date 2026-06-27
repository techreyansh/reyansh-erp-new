// PURE intent mapper for the Quality module. NO supabase/React/IDB. Returns a raw
// RPC intent { rpc, args } matching the LIVE signature:
//   ppc_record_qc(p_wo_id, p_stage_id, p_check_type, p_result, p_value)
// result ∈ 'pass' | 'fail' | 'pending'. stage + value are optional (WO-level QC
// allowed). The idempotencyKey is added by api.submit — mappers never touch it.

/** Record a QC inspection against a work order (optionally a specific stage). */
export function recordQcIntent({ wo = {}, stage = null, checkType, result, value } = {}) {
  return {
    rpc: 'ppc_record_qc',
    args: {
      p_wo_id: wo.id || null,
      p_stage_id: stage ? (stage.id || stage.stage_id || null) : null,
      p_check_type: checkType || 'in_process',
      p_result: result || 'pending',
      p_value: value && String(value).trim() ? String(value).trim() : null,
    },
  };
}
