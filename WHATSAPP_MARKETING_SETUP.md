# WhatsApp Marketing — Setup & Activation (Task 5: wa-scheduler + cron)

Outbound WhatsApp drip campaigns, modeled on the Email Campaigns module (see
`EMAIL_CAMPAIGNS_SETUP.md`) but sent through a WhatsApp BSP (Meta Cloud API in
V1) instead of Gmail.

## Architecture at a glance

| Piece | Where |
|---|---|
| Schema (9 tables + triggers + RPCs) | `supabase/migrations/20260701140000_whatsapp_marketing_schema.sql` |
| RBAC module + RLS | `supabase/migrations/20260701150000_whatsapp_marketing_rbac.sql` |
| Provider adapters | `supabase/functions/_shared/wa/registry.ts`, `meta.ts`, `types.ts` |
| Personalization | `supabase/functions/_shared/wa/personalize.ts` |
| Core send logic (shared) | `supabase/functions/_shared/wa/send.ts` — `sendOneWaMessage`, `composeMessagesForStep`, `recordEvent` |
| Business-hours/working-days window | `supabase/functions/_shared/wa/schedule.ts` — `evaluateWaWindow` (IST, fixed +05:30) |
| Send one message / step (HTTP) | `supabase/functions/wa-send` — thin wrapper around `_shared/wa/send.ts` |
| Scheduler (cron tick) | `supabase/functions/wa-scheduler` — the heartbeat; see its header comment for the full tick algorithm |

Sequence progression is driven by a DB trigger (`trg_wa_message_sent` /
`wa_advance_enrollment_on_send`): whenever a `wa_messages` row flips to `sent`
— by the scheduler's auto-send, a manual `wa-send` call, or the stale-`sending`
recovery sweep — the enrollment advances to the next active step (or
completes). Neither `wa-send` nor `wa-scheduler` reimplements this.

## 1. Apply the database migrations

```bash
cd ~/Desktop/reyansh-erp-new
supabase db push        # or run the two migration files' SQL against your linked project
```

Confirms: 9 `wa_*` tables, RLS + `marketing` module registration, and the
`trg_wa_message_sent` trigger.

## 2. Deploy the Edge Functions

```bash
supabase functions deploy wa-send
supabase functions deploy wa-scheduler
```

## 3. Set Edge Function secrets

```bash
# Meta WhatsApp Cloud API credentials live per-row in wa_provider_settings.credentials
# (set via the WhatsApp Marketing UI's Provider Settings screen, not an env var) —
# nothing WhatsApp-specific needs a secret here.

# Optional: lock the scheduler endpoint (recommended — same pattern as
# email-scheduler / task-notify)
supabase secrets set SCHEDULER_SECRET=$(openssl rand -hex 16)
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions
automatically — no need to set them.

## 4. Schedule the scheduler (pg_cron + pg_net)

Following this repo's established convention (see `EMAIL_CAMPAIGNS_SETUP.md`
§5 and `O2D_CUSTOMER_COMMS_SETUP.md` §3): cron scheduling is **not** committed
as a migration because the `cron.schedule(...)` call embeds the service-role
key in plaintext SQL. Run this once in the Supabase SQL editor, substituting
your project ref, service-role key, and the `SCHEDULER_SECRET` from step 3:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- tick every 5 minutes
select cron.schedule(
  'wa-scheduler-tick',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://azwdxgahmdgccfimhtmm.supabase.co/functions/v1/wa-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>',
      'x-scheduler-secret', '<SCHEDULER_SECRET or remove this line>'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

To change cadence or stop it: `select cron.unschedule('wa-scheduler-tick');`
then re-create if needed. You can also invoke it manually to force a tick:

```bash
curl -s -X POST 'https://azwdxgahmdgccfimhtmm.supabase.co/functions/v1/wa-scheduler' \
  -H 'Content-Type: application/json' \
  -H 'x-scheduler-secret: <SCHEDULER_SECRET>'
```

## 5. What one tick does

See the header comment in `supabase/functions/wa-scheduler/index.ts` for the
full algorithm; summary:

1. Loads up to 50 `wa_enrollments` where `status='active' and next_send_at <= now()`,
   joined to `campaign` and `contact`.
2. Skips enrollments whose campaign isn't `status='running'`; flips the
   enrollment to `opted_out` if the contact has `opt_out=true`.
3. Evaluates the campaign's business-hours/working-days window
   (`_shared/wa/schedule.ts`, IST). If outside the window, pushes
   `next_send_at` forward to the next open instant and does **not** send.
4. Resolves the next active step (smallest `step_order > current_step` with
   `is_active=true` — the same rule the DB trigger uses) and, if found,
   composes + sends via the shared `_shared/wa/send.ts` functions in-process
   (no HTTP hop). If no next step exists, marks the enrollment `completed`.
5. **Stale-`sending` sweep**: any `wa_messages` row stuck at `status='sending'`
   for more than 5 minutes (a crashed mid-flight send) is re-driven through
   `sendOneWaMessage`, which reloads the row fresh and is a no-op if it
   already reached a terminal sent/delivered/read state.
6. **Sandbox progression**: `wa_provider_settings.mode='sandbox'` sends are
   synthesized as `sent` synchronously (with a `sandbox-<uuid>`
   `provider_message_id`) but never reach `delivered`/`read` on their own.
   This tick progresses them `sent -> delivered -> read` with a small
   per-message randomized delay (15-90s then +30-240s) so the Live Monitor
   demo looks realistic across ticks instead of jumping to a terminal state.

Enrollment advancement after a real send success is handled entirely by the
`wa_advance_enrollment_on_send` DB trigger — the scheduler does not set
`current_step`/`next_send_at` on a successful send itself.

## 6. Manual verification recipe (no live deploy required to read; needs one to run)

`scripts/wa_scheduler_smoke.js` builds a disposable sandbox provider +
contact + 2-step campaign + enrollment with `next_send_at` in the past,
invokes the deployed `wa-scheduler` function once, and asserts:

- the first step's message sends (sandbox mode, so synchronously `sent`)
- the enrollment's `current_step`/`next_send_at` advance to the second step
  (proving the trigger + scheduler interplay works)
- a campaign with a business-hours window that excludes "now" gets its
  `next_send_at` pushed forward instead of sending

Run it (requires the functions to be deployed and env vars set):

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
WA_SCHEDULER_URL=https://azwdxgahmdgccfimhtmm.supabase.co/functions/v1/wa-scheduler \
SCHEDULER_SECRET=... \
node scripts/wa_scheduler_smoke.js
```

Add `--keep` to leave the dummy rows in place for inspection. All rows are
tagged and cleaned up in a `finally` block otherwise.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Enrollments never advance | Campaign must be `status='running'`, contact must not be `opt_out`, and "now" (IST) must be inside `business_hours_start`/`end` and (if `working_days_only`) a weekday. |
| Messages stuck at `sending` | Should self-heal within ~1-2 ticks via the stale-`sending` sweep (5 min threshold); check the target provider (`meta_cloud`) isn't erroring/timing out on every attempt. |
| Sandbox messages never reach `read` | Confirm `wa-scheduler` is actually being ticked by cron (`select * from cron.job;` / `cron.job_run_details`) — progression only happens on a tick, there's no background timer. |
| 401 from `wa-scheduler` | `SCHEDULER_SECRET` is set on the function but the caller (cron SQL or curl) isn't sending the matching `x-scheduler-secret` header. |
