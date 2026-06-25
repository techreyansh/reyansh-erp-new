-- Manual delete of a CRM account (prospect/client) + its CRM-side children.
-- Does NOT touch ERP records (orders/invoices keyed by customer_code) — only
-- the CRM pipeline entry and its activities/history/contacts/etc.
create or replace function public.crm_delete_account(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  delete from public.crm_pipeline_activity where pipeline_id = p_id;
  delete from public.crm_pipeline_history where pipeline_id = p_id;
  delete from public.crm_pipeline_collaborators where pipeline_id = p_id;
  delete from public.crm_account_contacts where account_id = p_id;
  delete from public.crm_account_addresses where account_id = p_id;
  delete from public.crm_account_documents where account_id = p_id;
  delete from public.crm_quotations where account_id = p_id;
  delete from public.crm_complaints where account_id = p_id;
  delete from public.crm_pipeline where id = p_id;
end $function$;
grant execute on function public.crm_delete_account(uuid) to authenticated;
