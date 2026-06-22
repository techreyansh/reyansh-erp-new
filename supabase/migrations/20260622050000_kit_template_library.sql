-- KIT relationship-marketing template library (Phase 1).
-- Curated, human, industry-specific B2B copy for wires/cables/cords/harnesses
-- and the appliance/EV/solar/pump/OEM/distributor segments. Variables:
-- {company} {contact} {industry} {city} {me}. No "just following up".
-- Additive seed + cleans %0A out of any existing template bodies.

-- 1) Clean URL-encoded newlines left in older templates.
UPDATE public.kit_templates
SET body = replace(replace(body, '%0A', E'\n'), '%0D', '')
WHERE body LIKE '%\%0A%' ESCAPE '\';

-- 2) Seed the library (skip if a same-name template already exists).
INSERT INTO public.kit_templates (channel, category, name, subject, body, is_active, created_by_email)
SELECT v.channel, v.category, v.name, v.subject, v.body, true, 'system@reyansh'
FROM (VALUES

-- ============ WHATSAPP · RELATIONSHIP ============
('whatsapp','relationship','Quarter check-in', NULL,
 E'Hi {contact}, hope the {industry} line is running well at {company} this quarter. No agenda here — just keeping in touch. If anything comes up on the wire or cord side, you know where to find us.'),
('whatsapp','relationship','Smooth production wish', NULL,
 E'{contact}, hope production is steady at your end and the season is treating {company} well. Always glad to be a sounding board on sourcing whenever useful.'),
('whatsapp','relationship','Genuine well-wishing', NULL,
 E'Hi {contact}, thinking of {company} as the new quarter kicks off — wishing your team a strong run on the current projects. Here if you ever want a second opinion on cable or harness specs.'),
('whatsapp','relationship','Post-festival restart', NULL,
 E'{contact}, hope you and the {company} team had a good break. As things ramp back up, happy to help line up anything on wires, cords or harnesses so it doesn''t sit on the critical path.'),
('whatsapp','relationship','Light touch, no ask', NULL,
 E'Hi {contact} — no requirement, just a hello. We''ve enjoyed working alongside {company} and wanted to stay in touch. Reach out anytime, even if it''s just to think something through.'),
('whatsapp','relationship','Team appreciation', NULL,
 E'{contact}, quick note to say it''s a pleasure working with the {company} team — your specs are always clear, which makes our job easy. Looking forward to more good work together.'),
('whatsapp','relationship','Milestone nod', NULL,
 E'Hi {contact}, saw {company} is busy on the {industry} front — looks like things are moving. Wishing you a smooth scale-up. Shout if extra cable/cord capacity would help de-risk timelines.'),
('whatsapp','relationship','Year-start hello', NULL,
 E'{contact}, wishing you and {company} a strong year ahead. Our side''s geared up on capacity and testing — but mostly just glad to keep the relationship warm. Talk soon.'),

-- ============ WHATSAPP · INDUSTRY INSIGHT ============
('whatsapp','industry_insight','Copper move heads-up', NULL,
 E'{contact}, quick heads-up — LME copper has moved a fair bit this week and most cord makers are revising quotes. If a buy is coming up for {company}, worth locking specs early. Happy to share our read on where it''s heading.'),
('whatsapp','industry_insight','PVC compound trend', NULL,
 E'Hi {contact}, PVC compound prices have been firming up with the season. If {company} has volumes planned, might be worth confirming grades now. I can send a short note on what we''re seeing across suppliers.'),
('whatsapp','industry_insight','BIS update', NULL,
 E'{contact}, there''s a BIS revision relevant to {industry} cabling doing the rounds — wanted you to hear it from a partner, not a surprise audit. Happy to forward the gist so {company} stays ahead of it.'),
('whatsapp','industry_insight','Supply-chain note', NULL,
 E'Hi {contact}, lead times on a few conductor grades are stretching again. Nothing alarming, but if {company} runs lean on stock it''s worth a buffer. Glad to flag which items to watch.'),
('whatsapp','industry_insight','Demand signal', NULL,
 E'{contact}, we''re seeing a clear uptick in {industry} orders this quarter — usually a sign buyers are planning ahead. If {company} wants to get ahead of the rush on cords/harnesses, now''s a good window.'),
('whatsapp','industry_insight','Forex impact', NULL,
 E'Hi {contact}, the rupee move is nudging imported-resin costs, which tends to flow into cable pricing in a few weeks. Sharing early so {company} can plan, not react. Want the details?'),
('whatsapp','industry_insight','Standards shift', NULL,
 E'{contact}, a couple of OEMs in {industry} are tightening flammability specs on internal wiring. Worth a glance before your next build. I can send what we''re hearing so {company} isn''t caught out.'),
('whatsapp','industry_insight','Market snapshot offer', NULL,
 E'Hi {contact}, I put together a quick one-pager on where copper, PVC and lead times are sitting this month. Useful for {company}''s planning? Say the word and I''ll send it across — no strings.'),

-- ============ WHATSAPP · EDUCATIONAL ============
('whatsapp','educational','Cable selection tip', NULL,
 E'{contact}, one thing that saves {industry} teams a lot of grief: matching conductor cross-section to actual current + ambient temp, not just the nameplate. Happy to share a one-page selection guide if it''s handy for {company}.'),
('whatsapp','educational','Power-cord safety', NULL,
 E'Hi {contact}, a quick field note — most cord failures we see trace back to flex fatigue at the strain relief, not the conductor. Small design tweak, big reliability gain. I can send our checklist if useful for {company}.'),
('whatsapp','educational','Common failure cause', NULL,
 E'{contact}, sharing something we''ve learned the hard way: insulation cracking in {industry} apps is usually a compound/temperature mismatch, not a process fault. Worth a look at your spec — happy to walk through it.'),
('whatsapp','educational','Harness design tip', NULL,
 E'Hi {contact}, on wiring harnesses, bundling and bend-radius decisions early save rework later. We''ve got a short design-for-assembly checklist that {company}''s team might find handy. Want it?'),
('whatsapp','educational','QC insight', NULL,
 E'{contact}, a QC tip that catches issues before they ship: a quick spark-test + elongation check on every batch. Cheap insurance. I can share how we''ve set it up if it helps {company}.'),
('whatsapp','educational','Storage/handling', NULL,
 E'Hi {contact}, small thing that extends cable life on the shop floor at {company}: drum storage off concrete + away from direct heat. Prevents a lot of early ageing. Happy to send our handling do''s and don''ts.'),
('whatsapp','educational','Spec-reading help', NULL,
 E'{contact}, if a customer drawing ever feels ambiguous on conductor/strand or sheath, send it over — I''m glad to help {company} decode it so nothing gets lost in translation before production.'),
('whatsapp','educational','Knowledge-series invite', NULL,
 E'Hi {contact}, we''re putting together short, no-pitch technical notes for {industry} teams — cable selection, cord safety, harness design. Want me to add {company} to the list? Pure knowledge, unsubscribe anytime.'),

-- ============ WHATSAPP · PRODUCT AWARENESS ============
('whatsapp','product_awareness','New capability', NULL,
 E'{contact}, wanted you to be among the first to know — we''ve added capacity that''s a good fit for {industry} work. Not a pitch, just so {company} has the option in your back pocket when a need shows up.'),
('whatsapp','product_awareness','New certification', NULL,
 E'Hi {contact}, quick update from our side: we''ve cleared a new certification relevant to {industry} supply. Mentioning it only because it might simplify approvals on {company}''s end down the line.'),
('whatsapp','product_awareness','Testing facility', NULL,
 E'{contact}, we''ve expanded our in-house testing (spark, tensile, ageing). Translation for {company}: tighter consistency and faster first-article sign-off. Happy to show you the setup sometime.'),
('whatsapp','product_awareness','Factory expansion', NULL,
 E'Hi {contact}, we''ve brought a new line online — more headroom for {industry} volumes and shorter lead times. Sharing so {company} knows the capacity is there when timelines get tight.'),
('whatsapp','product_awareness','New product range', NULL,
 E'{contact}, we''ve introduced a range that suits {industry} applications well. No hard sell — just want {company} to know it exists so it''s an option when the requirement comes up.'),
('whatsapp','product_awareness','Custom capability', NULL,
 E'Hi {contact}, we''ve been doing more custom cord/harness builds lately. If {company} ever has a non-standard requirement that''s been hard to source, that''s exactly the kind of thing we enjoy.'),
('whatsapp','product_awareness','Quality-system upgrade', NULL,
 E'{contact}, we''ve tightened our quality system end-to-end — full traceability per batch now. Mentioning it because it tends to make life easier for {industry} buyers like {company} at audit time.'),
('whatsapp','product_awareness','Sustainability note', NULL,
 E'Hi {contact}, we''ve moved more of our range to compliant, cleaner compounds. If {company} is fielding ESG/RoHS questions from your customers, happy to share what we''ve done.'),

-- ============ WHATSAPP · FESTIVAL ============
('whatsapp','festival','Diwali', NULL,
 E'Hi {contact}, wishing you, your family and the entire {company} team a very Happy Diwali. May the year ahead bring light, good health and strong business. Grateful for the relationship.'),
('whatsapp','festival','Holi', NULL,
 E'{contact}, a very Happy Holi to you and everyone at {company}! Wishing you a year as bright and colourful as the festival. Always a pleasure working together.'),
('whatsapp','festival','New Year', NULL,
 E'Hi {contact}, Happy New Year to you and the {company} team! Thank you for a great year of working together — here''s to an even stronger one ahead.'),
('whatsapp','festival','Independence Day', NULL,
 E'{contact}, wishing you and {company} a proud Happy Independence Day. Here''s to building strong, made-in-India manufacturing together.'),
('whatsapp','festival','Dussehra', NULL,
 E'Hi {contact}, Happy Dussehra to you and the {company} family. May the festival bring fresh energy and success to all your projects.'),
('whatsapp','festival','Ganesh Chaturthi', NULL,
 E'{contact}, Ganpati Bappa Morya! Wishing you, your family and {company} prosperity and smooth sailing on every new venture this year.'),
('whatsapp','festival','Makar Sankranti', NULL,
 E'Hi {contact}, Happy Makar Sankranti to you and the {company} team — may the year ahead bring upward momentum and good harvests in every sense.'),
('whatsapp','festival','Generic occasion', NULL,
 E'{contact}, warm wishes to you and everyone at {company} on the occasion. Grateful for the partnership and looking forward to more good work together.'),

-- ============ WHATSAPP · RE-ENGAGEMENT ============
('whatsapp','reengagement','Warm reconnect 30d', NULL,
 E'Hi {contact}, it''s been a little while — hope all''s well at {company}. No particular reason, just didn''t want the line to go quiet. If there''s anything on the {industry} side I can help line up, I''m here.'),
('whatsapp','reengagement','Value-first restart', NULL,
 E'{contact}, been a bit since we spoke. We''ve since added capacity and testing that''s relevant to {company}''s kind of work — thought it worth a quick hello rather than letting things drift. How are things your end?'),
('whatsapp','reengagement','Dormant, no pressure', NULL,
 E'Hi {contact}, we haven''t worked together in a while and I wanted to reconnect — genuinely, no pressure. If {company}''s needs have shifted, I''d love to understand how, even if it''s not a fit right now.'),
('whatsapp','reengagement','Check what changed', NULL,
 E'{contact}, circling back after a quiet stretch. Sometimes requirements move and a supplier just falls off the radar — if that''s the case for {company}, totally understand. Either way, good to stay in touch.'),
('whatsapp','reengagement','Offer help, not ask', NULL,
 E'Hi {contact}, rather than chase an order, I''d rather just be useful — if {company} is wrestling with any sourcing, lead-time or spec headache on cables/cords, happy to lend a view. No obligation at all.'),
('whatsapp','reengagement','Re-introduce briefly', NULL,
 E'{contact}, it''s been long enough that a quick re-intro feels right — we manufacture wires, cords and harnesses for {industry} OEMs. If {company} is ever reviewing suppliers, we''d value a place on the list.'),
('whatsapp','reengagement','Seasonal nudge', NULL,
 E'Hi {contact}, with the season picking up, thought of {company}. If you''re planning {industry} builds and want capacity reserved early, glad to help — and if not, just good to reconnect.'),
('whatsapp','reengagement','Honest one-liner', NULL,
 E'{contact}, I''ll be honest — I don''t want {company} to forget we''re here. We''ve done good work before and I''d love the chance again whenever the timing''s right. Hope you''re keeping well.'),

-- ============ WHATSAPP · OPPORTUNITY ============
('whatsapp','opportunity','Quotation follow', NULL,
 E'Hi {contact}, following our quote for {company} — wanted to check it lands right on specs and commercials. If anything needs tweaking to fit your project, I''d rather adjust than have it sit. What''s your read?'),
('whatsapp','opportunity','Sample follow', NULL,
 E'{contact}, hope the samples reached {company} in good shape. Keen to hear how they performed against your bench/spec — and if there''s any tweak that would make them a perfect fit, just say.'),
('whatsapp','opportunity','Meeting follow', NULL,
 E'Hi {contact}, good speaking earlier — thanks for the time. As discussed, I''ll line up the next step for {company}. Anything you''d like me to prioritise so it maps cleanly to your timeline?'),
('whatsapp','opportunity','Project follow', NULL,
 E'{contact}, checking in on the {industry} project we''d discussed — any movement on timelines or volumes at {company}? Happy to hold capacity or re-sample as it firms up so you''re never waiting on us.'),
('whatsapp','opportunity','Trial-order nudge', NULL,
 E'Hi {contact}, if it helps de-risk things, we''re glad to run a small trial batch for {company} before any commitment. Lets your team validate quality on the floor first. Worth setting up?'),
('whatsapp','opportunity','Spec confirmation', NULL,
 E'{contact}, before we proceed for {company}, I want to lock specs so there are no surprises — conductor, strand, insulation, sheath, length. Can you confirm, or shall I propose a draft for your sign-off?'),
('whatsapp','opportunity','Decision support', NULL,
 E'Hi {contact}, if a decision on {company}''s side is waiting on data — test reports, references, costing breakdowns — tell me what would help and I''ll get it over. Want to make this easy to say yes to.'),
('whatsapp','opportunity','Gentle close', NULL,
 E'{contact}, no pressure at all — just want to make sure {company}''s requirement doesn''t stall on our account. If you''re ready, we can start; if you need time, that''s fine too. Where would you like to take it?'),

-- ============ EMAIL ============
('email','newsletter','Monthly Newsletter','Reyansh Monthly — {industry} notes, market & a tip',
 E'Dear {contact},\n\nA quick monthly note for {company} — no pitch, just what we''re seeing.\n\n• Market: where copper, PVC and lead times are sitting this month.\n• One technical tip for {industry} teams.\n• What''s new on our side (capacity, testing, certifications).\n\nIf any of it is useful for a project, I''m a reply away.\n\nWarm regards,\n{me}\nReyansh International — Wires, Cords & Harnesses'),
('email','industry_update','Industry Update','{industry} sourcing update from Reyansh',
 E'Dear {contact},\n\nSharing a short update relevant to {company}''s {industry} sourcing:\n\n• Copper & compound prices — recent moves and likely direction.\n• Lead-time watch — grades worth buffering.\n• Standards/BIS — anything new to plan around.\n\nNothing to action — just so your planning has the full picture. Happy to go deeper on any point.\n\nBest,\n{me}'),
('email','product_intro','Product Introduction','Range relevant to {company}''s {industry} work',
 E'Dear {contact},\n\nA brief introduction to where we can help {company}. We manufacture wires, power cords and wiring harnesses for {industry} OEMs — with in-house compounding and full batch testing.\n\nNo immediate ask; I''d simply like {company} to have us as an option when a requirement comes up. Glad to send specs, samples or references whenever useful.\n\nRegards,\n{me}'),
('email','capability_intro','Capability Introduction','What Reyansh can take off your plate',
 E'Dear {contact},\n\nWanted to give {company} a clear picture of our capabilities — flexible & multi-core cables, custom power cords, and wiring harnesses, backed by spark/tensile/ageing testing and full traceability.\n\nIf {company} ever has a non-standard or hard-to-source requirement, that''s exactly where we add the most value. Happy to discuss whenever it''s relevant.\n\nBest regards,\n{me}'),
('email','factory_tour','Factory Tour Invitation','An open invitation to visit our facility',
 E'Dear {contact},\n\nAn open invitation — we''d be glad to host you and the {company} team for a walkthrough of our facility: compounding, drawing, extrusion, harness assembly and our test lab.\n\nThe best way to judge a manufacturing partner is to see the floor. No agenda beyond that. Let me know a week that suits and we''ll arrange it.\n\nWarm regards,\n{me}'),
('email','quotation_follow','Quotation Follow-up','Your quotation — {company}',
 E'Dear {contact},\n\nFollowing up on the quotation we shared for {company} — I want to make sure it fits your specs and commercials cleanly. If anything needs adjusting to suit the project, I''d rather refine it than have it sit.\n\nHappy to jump on a quick call if that''s easier. What''s your view?\n\nBest,\n{me}'),
('email','sample_follow','Sample Follow-up','How did our samples perform?','
Dear {contact},

Hope the samples reached {company} safely. I''d value your team''s honest feedback against your bench and spec — including anything that would make them a better fit.

If a revised sample would help, just say the word and we''ll turn it around quickly.

Regards,
{me}'),
('email','reengagement','Dormant Customer Re-engagement','Reconnecting with {company}',
 E'Dear {contact},\n\nIt''s been a while since we worked together, and I wanted to reconnect — genuinely, with no pressure.\n\nSince then we''ve added capacity, testing and a few certifications relevant to {industry}. If {company}''s requirements have evolved, I''d love to understand how, even if the timing isn''t right today.\n\nEither way, I''d like to keep the relationship warm.\n\nWarm regards,\n{me}'),
('email','product_launch','New Product Launch','New from Reyansh — relevant to {industry}',
 E'Dear {contact},\n\nWe''ve introduced a new range built for {industry} applications. I''m sharing it with {company} early — not as a hard sell, but so it''s on your radar when a need arises.\n\nHappy to send full specifications, test data or a sample for evaluation. Just reply and I''ll arrange it.\n\nBest regards,\n{me}'),
('email','technical_series','Technical Knowledge Series','Reyansh Technical Notes — issue for {company}',
 E'Dear {contact},\n\nWelcome to our technical series — short, practical, no pitch. This issue for {industry} teams:\n\n• Selecting the right conductor cross-section\n• Designing out the most common cord/harness failures\n• A simple batch-QC routine that catches issues early\n\nIf {company}''s engineers would find these useful, I''m glad to keep them coming. Reply anytime with topics you''d like covered.\n\nRegards,\n{me}')

) AS v(channel, category, name, subject, body)
WHERE NOT EXISTS (
  SELECT 1 FROM public.kit_templates k
  WHERE k.channel = v.channel AND k.name = v.name
);
