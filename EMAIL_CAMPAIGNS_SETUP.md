# Email Campaigns — Setup & Activation

AI-personalized outbound email sequences, sent from your linked **Gmail**, built into the CRM
(`/crm/campaigns`). Emails are generated per-recipient by **Google Gemini** (2.5 Flash) and sent
through the Gmail API on a schedule, with a daily cap, send-window throttle, and an optional
human review queue.

## Architecture at a glance

| Piece | Where |
|---|---|
| Schema (8 tables + RPCs + trigger) | `supabase/migrations/20260613130000_email_campaigns.sql` |
| AI copywriter | `supabase/functions/_shared/ai.ts` + `_shared/gemini.ts` |
| Generate one draft | `supabase/functions/email-generate` |
| Send one email (Gmail) | `supabase/functions/email-send` + `_shared/gmail.ts`, `_shared/send.ts` |
| Scheduler (cron tick) | `supabase/functions/email-scheduler` + `_shared/schedule.ts` |
| Reply detection (cron) | `supabase/functions/email-poll-replies` |
| Open-tracking pixel (public) | `supabase/functions/email-track-open` |
| Frontend module | `src/components/crm/email/*`, services `campaignsService.js` / `emailAccountsService.js` |

Sequence progression is driven by a DB trigger (`trg_email_message_sent`): whenever a message flips
to `sent` — by the scheduler *or* by you approving a draft — the enrollment advances to the next step.

## 1. Apply the database migration

```bash
cd ~/Desktop/reyansh-erp-new
supabase db push        # or run the migration SQL against your linked project
```

Confirms: 8 `email_*` tables, `current_user_can_email()`, RPCs `email_upsert_contact` /
`email_enroll_contacts`, and the `trg_email_message_sent` trigger. RLS is on (CRM/admin roles).

## 2. Deploy the Edge Functions

```bash
supabase functions deploy email-generate
supabase functions deploy email-send
supabase functions deploy email-scheduler
supabase functions deploy email-poll-replies
# the open-tracking pixel must be PUBLIC (email clients can't authenticate):
supabase functions deploy email-track-open --no-verify-jwt
```

## 3. Set Edge Function secrets

```bash
# Gemini (email generation)
supabase secrets set GEMINI_API_KEY=AIza...

# Google OAuth client — the SAME web client used for app login (for Gmail token refresh)
supabase secrets set GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
supabase secrets set GOOGLE_CLIENT_SECRET=GOCSPX-...

# Optional: lock the scheduler endpoint
supabase secrets set SCHEDULER_SECRET=$(openssl rand -hex 16)
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions automatically — no
need to set them.

> Get a Gemini API key at https://aistudio.google.com/apikey. The model is `gemini-2.5-flash`
> (change `GEMINI_MODEL` in `_shared/gemini.ts` if you want a different tier).

## 4. Google OAuth — add the Gmail scopes

The "Connect Gmail" button reuses your existing Supabase Google OAuth but asks for extra scopes:

- `https://www.googleapis.com/auth/gmail.send` (required — sending)
- `https://www.googleapis.com/auth/gmail.readonly` (for v1.1 reply-detection)

Steps (Google Cloud Console → the project behind your OAuth client):

1. **Enable the Gmail API** (APIs & Services → Library → Gmail API → Enable).
2. **OAuth consent screen** → add the two scopes above. While the app is in *Testing*, add your
   Gmail as a Test user. (To send from many accounts or leave testing, you'll need verification.)
3. Ensure **offline access** is allowed — the connect flow already passes
   `access_type=offline` + `prompt=consent` so Google returns a **refresh token**.
4. In **Supabase → Auth → Providers → Google**, confirm the same Client ID/Secret are set. Supabase
   must return `provider_refresh_token`; the connect flow reads it from the session and stores it in
   `email_accounts`.

If Google does **not** return a refresh token on connect, remove the app at
https://myaccount.google.com/permissions and reconnect (consent must be re-prompted).

## 5. Schedule the scheduler (pg_cron + pg_net)

Run this once in the Supabase SQL editor, substituting your project ref and **service-role key**.
(Keep the key server-side — this runs inside Postgres, the browser never sees it.)

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- tick every 5 minutes
select cron.schedule(
  'email-scheduler-tick',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/email-scheduler',
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

Add a second cron for **reply detection** (stops sequences when a contact replies):

```sql
select cron.schedule(
  'email-reply-poll',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/email-poll-replies',
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

To change cadence: `select cron.unschedule('email-scheduler-tick');` (or `'email-reply-poll'`) then re-create.
You can also tick them manually from the UI: **Senders → Run scheduler now** / **Check replies now**.

## 6. Use it (`/crm/campaigns`)

1. **Senders** → *Connect Gmail* → approve consent. *Send test* to confirm delivery.
2. **Audience** → *Import CSV/Excel* (auto-maps email/name/company/…), *Pull from CRM leads*, or add manually.
3. **Campaigns** → *New campaign* → set the **AI brief**, tone, signature, pick the Gmail sender, and
   guardrails (daily cap, send window IST, review toggle, stop-on-reply). Add **steps** — each step's
   *goal* is what Gemini writes toward; set the delay between steps. Use *Preview step 1 draft* to sanity-check.
4. Still in the campaign, **enroll contacts**.
5. Set the campaign **Active**.
6. The scheduler generates a personalized draft per due contact:
   - **Review ON** → drafts land in **Review queue** → edit / approve & send.
   - **Review OFF** → sent automatically within the send window, under the daily cap.

## Guardrails & known limits

- **Gmail consumer cap ≈ 500/day** and deliverability risk on cold lists. The per-campaign daily cap +
  send window mitigate but don't eliminate it. For high-volume cold outreach, move to a domain +
  dedicated ESP (Resend/SendGrid) — the engine is structured to add another sender type later.
- **Reply-stop** (`email-poll-replies`, every 15 min) lists recent INBOX threads per linked Gmail and
  halts any active enrollment whose thread got a reply (records a `replied` event; honors the
  campaign's *Stop sequence on reply* toggle). Needs the `gmail.readonly` scope (already requested).
- **Open-tracking** is opt-in per campaign (*Track opens*). When on, the email is sent as HTML with a
  1×1 pixel via the public `email-track-open` function; first open stamps `opened_at` + an `opened`
  event. Off by default to preserve plain-text deliverability. Note: pixels can be blocked by some
  clients (Gmail image proxy, "block images"), so opens are a floor, not exact.
- Generation uses Gemini at `temperature: 0` for consistency; raise it in `_shared/gemini.ts` if you
  want more variation between recipients.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "GEMINI_API_KEY is not set" | `supabase secrets set GEMINI_API_KEY=…`, redeploy. |
| Connect says "no refresh token" | Revoke at myaccount.google.com/permissions, reconnect (forces consent). Confirm Supabase Google provider returns provider_refresh_token. |
| "Campaign has no linked sending account" | Pick a Gmail under the campaign's *Send from*. |
| Drafts never generate | Campaign must be **Active**, contacts **enrolled**, within the **send window**, and a sender linked. Try *Run scheduler now*. |
| Send fails "invalid_grant" | Refresh token expired/revoked — reconnect the Gmail account. |
