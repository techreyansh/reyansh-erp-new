#!/usr/bin/env node
/* eslint-disable no-console */
//
// WhatsApp Marketing — wa-scheduler end-to-end smoke test (Task 5).
//
// Builds a disposable sandbox provider + contact + two campaigns
// (a normal 2-step drip, and one whose business-hours window deliberately
// excludes "now") + enrollments with next_send_at in the past, invokes the
// DEPLOYED wa-scheduler function twice (simulating two cron ticks), and
// asserts:
//   1. Tick 1 sends the 2-step campaign's first message (sandbox mode, so
//      synchronous) and the wa_advance_enrollment_on_send trigger advances
//      the enrollment to step 2 (current_step=1, next_send_at set).
//   2. Tick 1 does NOT send the business-hours-blocked campaign's message —
//      instead next_send_at is pushed forward past "now".
//   3. Tick 2 sends the 2-step campaign's second (final) message, and the
//      enrollment completes (status='completed', next_send_at=null).
//
// PREREQUISITES
//   - supabase/migrations/20260701140000_whatsapp_marketing_schema.sql applied.
//   - wa-scheduler deployed (supabase functions deploy wa-scheduler).
//   - Env:
//       SUPABASE_URL / REACT_APP_SUPABASE_URL   (project URL)
//       SUPABASE_SERVICE_ROLE_KEY               (service_role secret — RLS bypass)
//       WA_SCHEDULER_URL                        (the deployed function's URL,
//                                                 e.g. https://<ref>.supabase.co/functions/v1/wa-scheduler)
//       SCHEDULER_SECRET                        (optional — only if set on the function)
//
// USAGE
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... WA_SCHEDULER_URL=... \
//     SCHEDULER_SECRET=... node scripts/wa_scheduler_smoke.js
//   add --keep to leave the dummy rows in place for inspection.
//
// NOTE: this script requires a live, deployed wa-scheduler function to
// invoke over HTTP — it cannot be run from a sandboxed dev environment
// without network egress to the Supabase project. It has been written and
// reviewed but NOT executed live as of Task 5 (see task-5-report.md).
//
// SAFETY: every row it creates is tagged and removed in a finally block
// (unless --keep). It never touches real campaigns/contacts/providers — the
// test provider row is created with is_active=false so it can never become
// the accidental fallback provider for real campaigns mid-test.

const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SCHEDULER_URL = process.env.WA_SCHEDULER_URL;
const SCHEDULER_SECRET = process.env.SCHEDULER_SECRET || '';
const KEEP = process.argv.includes('--keep');

if (!URL || !KEY || !SCHEDULER_URL) {
  console.error('FATAL: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and WA_SCHEDULER_URL.');
  process.exit(2);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const TAG = `WASMOKE-${Math.floor(Math.random() * 1e9).toString(36)}`;

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}
async function die(label, error) { console.error(`FATAL @ ${label}:`, error?.message || error); throw error; }

async function tick() {
  const headers = { 'Content-Type': 'application/json' };
  if (SCHEDULER_SECRET) headers['x-scheduler-secret'] = SCHEDULER_SECRET;
  const res = await fetch(SCHEDULER_URL, { method: 'POST', headers, body: '{}' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`wa-scheduler returned ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

// state captured for cleanup
const made = { providerId: null, contactId: null, campaignRunId: null, campaignBlockedId: null };

async function main() {
  console.log(`\n=== wa-scheduler smoke (${TAG}) ===\n`);

  // 1) Disposable sandbox provider (is_active=false — never a fallback for real sends)
  const { data: provider, error: provErr } = await sb.from('wa_provider_settings').insert({
    provider_key: 'meta_cloud', label: TAG, is_active: false, mode: 'sandbox', credentials: {},
  }).select('*').single();
  if (provErr) await die('create wa_provider_settings', provErr);
  made.providerId = provider.id;

  // 2) One contact
  const { data: contact, error: contactErr } = await sb.from('wa_contacts').insert({
    contact_name: `${TAG} Contact`,
    whatsapp_number: `9990${Math.floor(Math.random() * 900000 + 100000)}`,
    source: 'manual',
  }).select('*').single();
  if (contactErr) await die('create wa_contacts', contactErr);
  made.contactId = contact.id;

  const now = new Date();
  const past = new Date(now.getTime() - 60_000).toISOString(); // 1 minute ago

  // 3) A normal running 2-step campaign, business hours open all day/week so
  //    the window never blocks it regardless of when this script runs.
  const { data: campaignRun, error: cErr } = await sb.from('wa_campaigns').insert({
    name: `${TAG} run`, status: 'running', provider_id: provider.id,
    business_hours_start: 0, business_hours_end: 23, working_days_only: false,
  }).select('*').single();
  if (cErr) await die('create wa_campaigns (running)', cErr);
  made.campaignRunId = campaignRun.id;

  const { error: s1Err } = await sb.from('wa_campaign_steps').insert([
    { campaign_id: campaignRun.id, step_order: 1, delay_type: 'immediate', body_text: 'Hi {{CustomerName}}, step 1.' },
    { campaign_id: campaignRun.id, step_order: 2, delay_type: 'immediate', body_text: 'Hi {{CustomerName}}, step 2 (final).' },
  ]);
  if (s1Err) await die('create wa_campaign_steps (running)', s1Err);

  const { data: enrRun, error: eErr } = await sb.from('wa_enrollments').insert({
    campaign_id: campaignRun.id, contact_id: contact.id, status: 'active', current_step: 0, next_send_at: past,
  }).select('*').single();
  if (eErr) await die('create wa_enrollments (running)', eErr);

  // 4) A campaign whose business-hours window can NEVER be open (start=end=0
  //    means "h >= 0 && h < 0" is always false), to exercise the window gate
  //    deterministically regardless of the wall-clock time this script runs at.
  const { data: campaignBlocked, error: cbErr } = await sb.from('wa_campaigns').insert({
    name: `${TAG} blocked`, status: 'running', provider_id: provider.id,
    business_hours_start: 0, business_hours_end: 0, working_days_only: false,
  }).select('*').single();
  if (cbErr) await die('create wa_campaigns (blocked)', cbErr);
  made.campaignBlockedId = campaignBlocked.id;

  const { error: s2Err } = await sb.from('wa_campaign_steps').insert([
    { campaign_id: campaignBlocked.id, step_order: 1, delay_type: 'immediate', body_text: 'Should never send.' },
  ]);
  if (s2Err) await die('create wa_campaign_steps (blocked)', s2Err);

  const { data: enrBlocked, error: ebErr } = await sb.from('wa_enrollments').insert({
    campaign_id: campaignBlocked.id, contact_id: contact.id, status: 'active', current_step: 0, next_send_at: past,
  }).select('*').single();
  if (ebErr) await die('create wa_enrollments (blocked)', ebErr);

  // ---- Tick 1 ---------------------------------------------------------------
  console.log('Invoking wa-scheduler (tick 1)...');
  const t1 = await tick();
  console.log('  tick 1 summary:', JSON.stringify(t1));

  {
    const { data: enr } = await sb.from('wa_enrollments').select('*').eq('id', enrRun.id).single();
    assert(enr.current_step === 1, `running-campaign enrollment advanced to step 1 (got ${enr.current_step})`);
    assert(enr.status === 'active', `running-campaign enrollment still active (got ${enr.status})`);
    assert(!!enr.next_send_at, 'running-campaign enrollment has a next_send_at for step 2');

    const { data: msgs } = await sb.from('wa_messages').select('*').eq('enrollment_id', enrRun.id).order('step_order');
    assert(msgs.length === 1, `exactly one message sent so far (got ${msgs.length})`);
    assert(msgs[0]?.status === 'sent', `step-1 message status is 'sent' (got ${msgs[0]?.status})`);
    assert(!!msgs[0]?.provider_message_id?.startsWith('sandbox-'), 'step-1 message got a sandbox- provider_message_id');
  }
  {
    const { data: enr } = await sb.from('wa_enrollments').select('*').eq('id', enrBlocked.id).single();
    assert(enr.current_step === 0, `blocked-campaign enrollment did NOT advance (got ${enr.current_step})`);
    assert(new Date(enr.next_send_at).getTime() > new Date(past).getTime(), 'blocked-campaign next_send_at was pushed forward past the original due time');

    const { count } = await sb.from('wa_messages').select('*', { count: 'exact', head: true }).eq('enrollment_id', enrBlocked.id);
    assert((count ?? 0) === 0, `no message was sent for the business-hours-blocked campaign (got ${count})`);
  }

  // ---- Tick 2 (advance the 2-step campaign to completion) --------------------
  // next_send_at for step 2 was set to "now" by the trigger (immediate delay),
  // so it's already due for this second tick.
  console.log('Invoking wa-scheduler (tick 2)...');
  const t2 = await tick();
  console.log('  tick 2 summary:', JSON.stringify(t2));

  {
    const { data: enr } = await sb.from('wa_enrollments').select('*').eq('id', enrRun.id).single();
    assert(enr.current_step === 2, `running-campaign enrollment advanced to step 2 (got ${enr.current_step})`);
    assert(enr.status === 'completed', `running-campaign enrollment completed (got ${enr.status})`);
    assert(enr.next_send_at === null, 'running-campaign enrollment next_send_at cleared on completion');

    const { data: msgs } = await sb.from('wa_messages').select('*').eq('enrollment_id', enrRun.id).order('step_order');
    assert(msgs.length === 2, `both messages exist (got ${msgs.length})`);
    assert(msgs.every((m) => m.status === 'sent'), 'both messages are status=sent');
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
}

async function cleanup() {
  if (KEEP) { console.log('--keep set: leaving dummy rows in place.'); return; }
  try {
    // wa_campaigns cascades to wa_campaign_steps / wa_enrollments / wa_messages / wa_campaign_media.
    if (made.campaignRunId) await sb.from('wa_campaigns').delete().eq('id', made.campaignRunId);
    if (made.campaignBlockedId) await sb.from('wa_campaigns').delete().eq('id', made.campaignBlockedId);
    if (made.contactId) await sb.from('wa_contacts').delete().eq('id', made.contactId);
    if (made.providerId) await sb.from('wa_provider_settings').delete().eq('id', made.providerId);
    console.log('Cleanup done.');
  } catch (e) { console.error('Cleanup warning:', e?.message || e); }
}

main()
  .then(cleanup)
  .then(() => process.exit(fail ? 1 : 0))
  .catch(async (e) => { await cleanup(); console.error(e); process.exit(1); });
