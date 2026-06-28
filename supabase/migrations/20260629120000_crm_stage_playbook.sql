-- CRM stage coaching playbook: per-stage "what to say & when" for the sales team.
-- Each (scope, stage_key) carries a recommended next step, a follow-up SLA, a
-- talk-track, and a common objection + response. Surfaced as a Coaching Card on
-- the account 360 / pipeline drawer, and used to pre-fill the Next Action SLA.
-- Read-open to authenticated; writes gated to CEO/super via crm_save_playbook.
-- Additive; seed is idempotent (ON CONFLICT DO NOTHING).
BEGIN;

CREATE TABLE IF NOT EXISTS public.crm_stage_playbook (
  scope              text NOT NULL CHECK (scope IN ('prospect','client')),
  stage_key          text NOT NULL,
  recommended_action text,
  sla_days           int,
  talk_track         text,
  objection_prompt   text,
  channel            text,
  updated_by_email   text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, stage_key)
);

ALTER TABLE public.crm_stage_playbook ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.crm_stage_playbook TO authenticated;

DO $rls$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crm_stage_playbook' AND policyname='crm_playbook_read') THEN
    CREATE POLICY crm_playbook_read ON public.crm_stage_playbook FOR SELECT TO authenticated USING (true);
  END IF;
END $rls$;

-- Writes only via the definer RPC (CEO/super), so no INSERT/UPDATE grant to clients.
CREATE OR REPLACE FUNCTION public.crm_save_playbook(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; n int := 0;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) LOOP
    INSERT INTO public.crm_stage_playbook
      (scope, stage_key, recommended_action, sla_days, talk_track, objection_prompt, channel, updated_by_email, updated_at)
    VALUES (
      lower(r->>'scope'), r->>'stage_key', r->>'recommended_action',
      nullif(r->>'sla_days','')::int, r->>'talk_track', r->>'objection_prompt', r->>'channel',
      public.rbac_current_email(), now())
    ON CONFLICT (scope, stage_key) DO UPDATE SET
      recommended_action = excluded.recommended_action,
      sla_days = excluded.sla_days,
      talk_track = excluded.talk_track,
      objection_prompt = excluded.objection_prompt,
      channel = excluded.channel,
      updated_by_email = excluded.updated_by_email,
      updated_at = now();
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('saved', n);
END;
$$;
GRANT EXECUTE ON FUNCTION public.crm_save_playbook(jsonb) TO authenticated;

-- ── Seed (idempotent) ───────────────────────────────────────────────────────
INSERT INTO public.crm_stage_playbook (scope, stage_key, recommended_action, sla_days, talk_track, objection_prompt, channel) VALUES
-- Prospect lifecycle
('prospect','lead','Qualify the need and find the decision-maker',2,
 'Introduce Reyansh International (wires, cords, harnesses). Ask what they currently buy, from whom, and the one thing they wish was better (lead time, QC, price).',
 '“We already have a supplier.” → “Makes sense — many clients keep us as a benchmark. Can I quote your top 1–2 SKUs so you have a comparison on file?”','call'),
('prospect','contacted','Book a discovery meeting',3,
 'Thank them for the chat. Propose a 20-min call to understand specs and volumes. Offer two time slots.',
 '“Send details on email.” → “Happy to — I’ll send a 1-pager, and a quick call will let me tailor it to your exact spec. Does Thursday 11am work?”','whatsapp'),
('prospect','meeting_scheduled','Run discovery, capture exact specs',1,
 'Confirm the meeting. Prepare: their SKUs, cores, copper area, length, volumes, target price, current pain.',
 '“We’re just exploring.” → “Perfect time to set a baseline. Even a sample order tells us if we’re a fit.”','call'),
('prospect','qualified','Send samples or an RFQ',2,
 'Recap their need in one line, confirm the spec, and send samples/quote. Set the next checkpoint date.',
 '“Let me check internally.” → “Of course — shall I send a sample so you have something physical to evaluate while you align?”','email'),
('prospect','sample_sent','Follow up on sample feedback',4,
 'Ask if the sample arrived and how it tested vs their current part. Offer a plant visit / video of QC.',
 '“Still testing.” → “No rush — any early read? If it passes, I’ll line up commercials so you’re not waiting.”','call'),
('prospect','quotation_sent','Follow up on the quote and handle price',3,
 'Confirm they received the quote. Walk through value (copper purity, QC, on-time). Ask what would make this a yes.',
 '“Your price is high.” → “Let’s align spec-for-spec — I can show the cost breakdown. Where do you need to land, and on what volume?”','call'),
('prospect','negotiation','Lock terms and confirm the PO',2,
 'Summarise agreed price, terms, lead time. Ask for the PO and a start date. Offer a small first lot to de-risk.',
 '“Need better terms.” → “I can do X on a 3-month commitment, or Y on this order. Which helps you move today?”','call'),
('prospect','converted','Onboard and secure the first order',1,
 'Welcome them. Confirm specs, delivery, payment. Introduce the account owner and set the reorder reminder.',
 NULL,'call'),
-- Legacy prospect tags (still used on some cards)
('prospect','cold_call','Open the conversation and qualify',2,
 'Lead with a relevant proof point (a similar customer/segment). Ask one sharp question about their current supply.',
 '“Not interested.” → “Totally fair — can I leave you a quote on your top SKU so you have us on file when timing’s better?”','call'),
('prospect','data_shared','Confirm fit and push to RFQ',2,
 'Check they reviewed the data. Ask which SKUs to quote first.',NULL,'whatsapp'),
('prospect','rfq_samples','Submit commercials and samples',2,
 'Send the RFQ response + samples. Confirm the evaluation timeline.',NULL,'email'),
('prospect','quotation','Follow up on quotation',3,
 'Confirm receipt, restate value, ask for the decision date.',
 '“Comparing quotes.” → “Smart — make sure you compare the same spec/QC. I can annotate ours so it’s apples-to-apples.”','call'),
('prospect','counter_samples','Resolve counter-sample feedback',3,
 'Acknowledge feedback, confirm changes, resend.',NULL,'call'),
-- Client lifecycle
('client','active','Confirm the reorder cadence',7,
 'Check stock/consumption and confirm the next order. Flag any upcoming price/lead-time changes early.',
 NULL,'whatsapp'),
('client','repeat_business','Upsell adjacent SKUs',14,
 'They trust the core product — introduce one adjacent SKU or a value-add (custom length, branding).',NULL,'call'),
('client','key_account','Run a quarterly business review',30,
 'Review volumes, service levels, and roadmap. Align on next-quarter forecast and a joint improvement.',NULL,'call'),
('client','growth_account','Expand share of wallet',14,
 'Map what they still buy elsewhere. Propose a trial on one of those SKUs.',NULL,'call'),
('client','dormant','Re-engage and find out why they stopped',3,
 'Reach out warmly. Ask directly what changed. Offer to fix it and earn a trial order.',
 '“We had delays last time.” → “I owe you that — here’s exactly what we changed on lead time. Can we prove it on one order?”','call'),
('client','inactive','Win-back attempt',5,
 'One clear, low-friction offer to restart. If no traction, agree a check-back date.',NULL,'whatsapp')
ON CONFLICT (scope, stage_key) DO NOTHING;

COMMIT;
