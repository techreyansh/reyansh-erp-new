# O2D Customer Milestone Comms — Setup (Phase 4b)

The DB + sender code ships in the app/migrations. These steps light it up. **Until
they're done, milestone rows enqueue into `wf_customer_comms` and just sit `pending`
(nothing sends).** Do them in order; email can go live before WhatsApp.

## What's already built
- `wf_customer_comms` outbox + `wf_event` enqueue trigger (migration `20260701130000`).
  New orders enqueue email + WhatsApp rows at **Order confirmed**, **In production**,
  **Dispatched**. Idempotent and forward-only (existing orders are not back-filled).
- The `task-notify` edge function now drains any allow-listed outbox: POST it
  `{"table":"wf_customer_comms"}`. WhatsApp rows with a `template_name` are sent as
  Meta templates.

## 1. Deploy the function
```bash
supabase functions deploy task-notify --project-ref azwdxgahmdgccfimhtmm
```

## 2. Set function secrets
```bash
supabase secrets set --project-ref azwdxgahmdgccfimhtmm \
  RESEND_API_KEY="re_xxx" \
  RESEND_FROM="Reyansh International <orders@yourdomain.com>" \
  SCHEDULER_SECRET="<long-random-string>" \
  WHATSAPP_TOKEN="<meta-cloud-api-token>" \
  WHATSAPP_PHONE_NUMBER_ID="<meta-phone-number-id>"
```
- **Email needs only** `RESEND_API_KEY` + `RESEND_FROM` (the from-domain must be
  verified in Resend). With these set, email goes live.
- WhatsApp needs `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` **and** the templates
  in step 4. Until then WhatsApp rows drain to `skipped` ("whatsapp not configured").

## 3. Schedule the drain (run ONCE in the Supabase SQL editor)
Not committed as a migration — it embeds the service-role key. Paste your real
service-role key and the SCHEDULER_SECRET from step 2:
```sql
select cron.schedule('wf-customer-comms-drain', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://azwdxgahmdgccfimhtmm.supabase.co/functions/v1/task-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'x-scheduler-secret', '<SCHEDULER_SECRET>'),
    body    := '{"table":"wf_customer_comms"}'::jsonb
  );
$$);
```
This drains **only** `wf_customer_comms`. The dormant employee `task_notifications`
outbox stays off (add a second `cron.schedule` line with body `{"table":"task_notifications"}`
only when you decide to turn that on). Unschedule with
`select cron.unschedule('wf-customer-comms-drain');`.

## 4. WhatsApp templates (Meta — the long pole, days for approval)
Create + submit these 3 templates in the Meta WhatsApp Manager (category: utility).
Names must match exactly; each takes 2 body params `{{1}}=contact name`, `{{2}}=SO number`:
- `order_order_confirmed` — e.g. "Hi {{1}}, your order {{2}} is confirmed. — Reyansh International"
- `order_in_production` — "Hi {{1}}, your order {{2}} is now in production."
- `order_dispatched` — "Hi {{1}}, your order {{2}} has been dispatched."

## 5. Test BEFORE going wide (audience = all customers with a contact)
1. After step 1+2, manually fire one drain and watch a test row:
   ```bash
   curl -s -X POST 'https://azwdxgahmdgccfimhtmm.supabase.co/functions/v1/task-notify' \
     -H 'Content-Type: application/json' -H 'x-scheduler-secret: <SCHEDULER_SECRET>' \
     -d '{"table":"wf_customer_comms"}'
   ```
   (Seed a single test row addressed to your own email first.) Confirm it flips
   `pending → sent` and the email arrives.
2. Release one real test sales order and drive it to dispatch; confirm one message
   per milestone in `wf_customer_comms` (and on the **Workflow Control Tower → Customer
   comms** card) before enabling the cron for real traffic.

## Rollback
- `select cron.unschedule('wf-customer-comms-drain');` stops all sends instantly.
- `drop trigger trg_wf_customer_comms_enqueue on public.wf_event;` stops enqueuing.
