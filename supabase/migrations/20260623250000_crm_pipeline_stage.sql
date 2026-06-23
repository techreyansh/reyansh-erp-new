-- A Phase 3: operational Client Kanban. ADDITIVE — a new pipeline_stage field
-- (operational progression) that is independent of client_stage (lifecycle
-- segment). Existing data untouched; clients default to 'active'.
alter table public.crm_pipeline add column if not exists pipeline_stage text;
update public.crm_pipeline set pipeline_stage = 'active'
  where account_type = 'client' and (pipeline_stage is null or pipeline_stage = '');
