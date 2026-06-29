-- Restrict CRM account deletion to CEO/admins (is_super_admin), and scrub the
-- one ZZGEN→ZZTARGET row left in the merge audit log by the Merge-tool live test.
BEGIN;

-- crm_delete_account: same cascade, now admin-gated. Covers both the prospect-board
-- card delete and the account-drawer delete (both call this RPC).
create or replace function public.crm_delete_account(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.is_super_admin() then
    raise exception 'not_authorized';
  end if;
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

-- Remove the merge-tool live-test audit row (RLS blocks REST deletes on this log).
delete from public.inv_item_merge_log where from_code = 'ZZGEN' and to_code = 'ZZTARGET';

COMMIT;
