#!/usr/bin/env node
/* eslint-disable no-console */
//
// Order-to-Dispatch Workflow Engine — end-to-end smoke test.
//
// Drives a dummy CABLE_ONLY sales order from `released` through the whole
// spine by simulating each real-world signal (dispatch plan created, work
// order released + kit issued, WO run to done + FG stocked, dispatched,
// closed) and asserting the engine auto-advances stages, spawns the right
// department tasks, enqueues notifications, and enforces dependency gating.
//
// PREREQUISITES
//   1. The two Phase-0 migrations applied to the target DB:
//        supabase/migrations/20260701100000_o2d_workflow_engine_schema.sql
//        supabase/migrations/20260701100100_o2d_workflow_engine_rpcs.sql
//   2. Env (a SERVICE ROLE key is required — the wf_* RPCs are granted to
//      authenticated/service_role and anon cannot call them):
//        SUPABASE_URL=...                 (or REACT_APP_SUPABASE_URL)
//        SUPABASE_SERVICE_ROLE_KEY=...    (service_role secret)
//
// USAGE
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/wf_smoke.js
//   add --keep to leave the dummy rows in place for inspection.
//
// SAFETY: every row it creates is tagged and removed in a finally block
// (unless --keep). It never touches real orders.

const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KEEP = process.argv.includes('--keep');

if (!URL || !KEY) {
  console.error('FATAL: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role).');
  process.exit(2);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const TAG = `WFSMOKE-${Math.floor(Math.random() * 1e9).toString(36)}`;
const OWNER = 'wf-smoke@example.com';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}
async function die(label, error) { console.error(`FATAL @ ${label}:`, error?.message || error); throw error; }

async function stages(instId) {
  const { data, error } = await sb.from('wf_stage_run').select('*').eq('instance_id', instId).order('sequence');
  if (error) await die('read stages', error);
  return Object.fromEntries((data || []).map((s) => [s.stage_key, s]));
}
async function reconcile(instId) {
  const { error } = await sb.rpc('wf_reconcile', { p_instance: instId });
  if (error) await die('wf_reconcile', error);
}

// state captured for cleanup
const made = { soId: null, instId: null, woId: null, itemId: null, planId: null, taskIds: [] };

async function main() {
  console.log(`\n=== O2D workflow smoke (${TAG}) ===\n`);

  // 1) Released dummy sales order ------------------------------------------------
  const so_number = `SO-${TAG}`;
  const { data: so, error: soErr } = await sb.from('sales_order').insert({
    so_number, customer_code: TAG, company_name: `${TAG} Pvt Ltd`,
    status: 'released', owner_email: OWNER, released_at: new Date().toISOString(),
    expected_dispatch_date: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
  }).select('*').single();
  if (soErr) await die('create sales_order', soErr);
  made.soId = so.id;

  // 2) Create the workflow instance (CABLE_ONLY → short chain) -------------------
  console.log('Step: wf_create_instance (CABLE_ONLY)');
  const { data: instId, error: ciErr } = await sb.rpc('wf_create_instance', { p_so: so.id, p_order_type: 'CABLE_ONLY' });
  if (ciErr) await die('wf_create_instance', ciErr);
  made.instId = instId;
  let st = await stages(instId);
  assert(Object.keys(st).length === 9, `9 CABLE_ONLY stages seeded (got ${Object.keys(st).length})`);
  assert(st.sales_order?.status === 'done', 'sales_order stage done at creation');
  assert(st.dispatch_planning?.status === 'in_progress', 'dispatch_planning unblocked + task spawned');
  assert(st.production_planning?.status === 'in_progress', 'production_planning unblocked + task spawned');
  assert(st.store_issue?.status === 'blocked', 'store_issue still blocked (gating holds)');
  assert(st.cable?.status === 'blocked', 'cable still blocked (gating holds)');
  assert(!!st.dispatch_planning?.task_id && !!st.production_planning?.task_id, 'tasks linked to spawned stages');
  // task content correctness
  const { data: dpTask } = await sb.from('tasks').select('*').eq('id', st.dispatch_planning.task_id).single();
  assert(dpTask?.assigned_email === OWNER, 'spawned task assigned to SO owner email');
  assert(dpTask?.department === 'Dispatch', 'dispatch_planning task department = Dispatch');
  assert(dpTask?.stage_run_id === st.dispatch_planning.id, 'task back-links to its stage_run');
  for (const k of Object.values(st)) if (k.task_id) made.taskIds.push(k.task_id);
  // notifications enqueued (soft — table may not exist in all envs)
  const { count: notif } = await sb.from('task_notifications')
    .select('*', { count: 'exact', head: true }).eq('task_id', st.dispatch_planning.task_id);
  assert((notif ?? 0) > 0, `notification(s) enqueued for spawned task (got ${notif ?? 0})`);

  // 3) Dispatch planning done: a dispatch_plan exists ---------------------------
  console.log('Step: create dispatch_plan → reconcile');
  const { data: plan, error: dpErr } = await sb.from('dispatch_plan').insert({
    so_id: so.id, so_number, customer_code: TAG, status: 'planned',
    dispatch_date: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), owner_email: OWNER,
  }).select('*').single();
  if (dpErr) await die('create dispatch_plan', dpErr);
  made.planId = plan.id;
  await reconcile(instId);
  st = await stages(instId);
  assert(st.dispatch_planning?.status === 'done', 'dispatch_planning completes on plan creation');

  // 4) Production planning = release to floor: make a WO + link it ---------------
  console.log('Step: simulate release-to-floor (WO + wf_link_wo) + complete planning task');
  const { data: item, error: itErr } = await sb.from('ppc_items').insert({
    code: `${TAG}-ITM`, name: `${TAG} cable`, item_type: 'cable',
  }).select('*').single();
  if (itErr) await die('create ppc_items', itErr);
  made.itemId = item.id;
  const { data: wo, error: woErr } = await sb.from('ppc_wo').insert({
    wo_number: `WO-${TAG}`, item_id: item.id, qty: 10, status: 'released',
    customer_code: TAG, source_order_number: so_number, source_kind: 'cable_plan',
  }).select('*').single();
  if (woErr) await die('create ppc_wo', woErr);
  made.woId = wo.id;
  const { error: matErr } = await sb.from('ppc_wo_material').insert({
    work_order_id: wo.id, item_id: item.id, qty_required: 10, qty_issued: 0,
  });
  if (matErr) await die('create ppc_wo_material', matErr);
  // link the WO under the production_planning stage_run
  const { error: linkErr } = await sb.rpc('wf_link_wo', {
    p_stage_run_id: st.production_planning.id, p_wo_id: wo.id, p_link_kind: 'cable', p_demand_id: null, p_plan_id: null,
  });
  if (linkErr) await die('wf_link_wo', linkErr);
  // complete the production_planning (manual) task
  await sb.from('tasks').update({ task_status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', st.production_planning.task_id);
  await reconcile(instId);
  st = await stages(instId);
  assert(st.production_planning?.status === 'done', 'production_planning completes when task done');
  assert(st.store_issue?.status === 'in_progress', 'store_issue unblocks + task spawned');
  if (st.store_issue?.task_id) made.taskIds.push(st.store_issue.task_id);
  assert(st.cable?.status === 'blocked', 'cable still blocked until store issue');

  // 5) Store issue: kit fully issued -------------------------------------------
  console.log('Step: issue kit (qty_issued = qty_required) → reconcile');
  await sb.from('ppc_wo_material').update({ qty_issued: 10 }).eq('work_order_id', wo.id);
  await reconcile(instId);
  st = await stages(instId);
  assert(st.store_issue?.status === 'done', 'store_issue completes on kit_issued signal');
  assert(st.cable?.status === 'in_progress', 'cable unblocks + task spawned');
  if (st.cable?.task_id) made.taskIds.push(st.cable.task_id);

  // 6) Cable run to done (WO done) ---------------------------------------------
  console.log('Step: WO status = done → reconcile');
  await sb.from('ppc_wo').update({ status: 'done' }).eq('id', wo.id);
  await reconcile(instId);
  st = await stages(instId);
  assert(st.cable?.status === 'done', 'cable completes on wo_status_done');
  assert(st.packing?.status === 'done', 'packing auto-completes (wo at qc/done) after unblock');
  assert(st.fg?.status === 'in_progress', 'fg unblocks but waits (not fg-stocked yet)');
  if (st.fg?.task_id) made.taskIds.push(st.fg.task_id);
  assert(st.dispatch?.status === 'blocked', 'dispatch still blocked until FG');

  // 7) FG stocked ---------------------------------------------------------------
  console.log('Step: WO fg_stocked_at set → reconcile');
  await sb.from('ppc_wo').update({ fg_stocked_at: new Date().toISOString(), fg_stocked_qty: 10 }).eq('id', wo.id);
  await reconcile(instId);
  st = await stages(instId);
  assert(st.fg?.status === 'done', 'fg completes on fg_stocked signal');
  assert(st.dispatch?.status === 'in_progress', 'dispatch unblocks + task spawned');
  if (st.dispatch?.task_id) made.taskIds.push(st.dispatch.task_id);

  // 8) Dispatched ---------------------------------------------------------------
  console.log('Step: dispatch_plan status = dispatched → reconcile');
  await sb.from('dispatch_plan').update({ status: 'dispatched', actual_dispatch_date: new Date().toISOString().slice(0, 10) }).eq('id', plan.id);
  await reconcile(instId);
  st = await stages(instId);
  assert(st.dispatch?.status === 'done', 'dispatch completes on dispatch_status=dispatched');
  assert(st.closure?.status === 'in_progress', 'closure unblocks + task spawned');
  if (st.closure?.task_id) made.taskIds.push(st.closure.task_id);

  // 9) Closure ------------------------------------------------------------------
  console.log('Step: complete closure task → reconcile');
  await sb.from('tasks').update({ task_status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', st.closure.task_id);
  await reconcile(instId);
  st = await stages(instId);
  const { data: inst } = await sb.from('wf_instance').select('*').eq('id', instId).single();
  const { data: soFinal } = await sb.from('sales_order').select('status').eq('id', so.id).single();
  assert(st.closure?.status === 'done', 'closure completes when task done');
  assert(inst?.status === 'completed', 'instance rolls up to completed');
  assert(soFinal?.status === 'closed', 'sales_order closed by workflow closure');

  // idempotency: a second create returns the same instance, reconcile no-ops
  const { data: again } = await sb.rpc('wf_create_instance', { p_so: so.id, p_order_type: 'CABLE_ONLY' });
  assert(again === instId, 'wf_create_instance is idempotent (same instance id)');

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
}

async function cleanup() {
  if (KEEP) { console.log('--keep set: leaving dummy rows in place.'); return; }
  try {
    if (made.taskIds.length) await sb.from('tasks').delete().in('id', made.taskIds);
    if (made.instId) await sb.from('wf_instance').delete().eq('id', made.instId); // cascades wf_*
    if (made.woId) { await sb.from('ppc_wo_material').delete().eq('work_order_id', made.woId); await sb.from('ppc_wo').delete().eq('id', made.woId); }
    if (made.itemId) await sb.from('ppc_items').delete().eq('id', made.itemId);
    if (made.planId) await sb.from('dispatch_plan').delete().eq('id', made.planId);
    if (made.soId) { await sb.from('production_demand').delete().eq('so_id', made.soId); await sb.from('sales_order').delete().eq('id', made.soId); }
    console.log('Cleanup done.');
  } catch (e) { console.error('Cleanup warning:', e?.message || e); }
}

main()
  .then(cleanup)
  .then(() => process.exit(fail ? 1 : 0))
  .catch(async (e) => { await cleanup(); console.error(e); process.exit(1); });
