// PURE intent mappers for the Production module. NO supabase/React/IDB — unit-tests
// trivially. Returns a raw RPC intent { rpc, args } matching the LIVE signature:
//   ppc_post_jobcard(p_stage_id, p_output, p_reject, p_downtime, p_downtime_reason,
//                    p_defect, p_operator, p_machine, p_note, p_mold)
// The idempotencyKey is added by api.submit — mappers never touch it.

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Log a stage's production output (good + reject) from the shop floor. */
export function logOutputIntent(stage = {}, fields = {}) {
  return {
    rpc: 'ppc_post_jobcard',
    args: {
      p_stage_id: stage.id || stage.stage_id || null,
      p_output: num(fields.output),
      p_reject: num(fields.reject),
      p_downtime: num(fields.downtime),
      p_downtime_reason: fields.downtimeReason || null,
      p_defect: fields.defect || null,
      p_operator: fields.operator || null,
      p_machine: fields.machine || null,
      p_note: fields.note || null,
      p_mold: fields.mold || null,
    },
  };
}
