-- Payment Follow-Up: notify the collections owner when an invoice is assigned to
-- them (mirrors the next-action accountability loop). Additive CREATE OR REPLACE
-- of ar_update_collection: same signature + behavior, plus a crm_notification
-- insert when collection_owner_email is newly set by someone else.
BEGIN;

create or replace function public.ar_update_collection(
  p_invoice uuid, p_commitment date default null, p_status text default null,
  p_owner text default null, p_notes text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_actor     text := public.rbac_current_email();
  v_new_owner text := lower(nullif(btrim(coalesce(p_owner,'')), ''));
  v_old_owner text;
  v_inv       text;
  v_cust      text;
begin
  select lower(coalesce(collection_owner_email,'')), invoice_number, customer_code
    into v_old_owner, v_inv, v_cust
  from public.finance_invoices where id = p_invoice;

  update public.finance_invoices set
    payment_commitment_date = coalesce(p_commitment, payment_commitment_date),
    collection_status       = coalesce(p_status, collection_status),
    collection_owner_email  = coalesce(p_owner, collection_owner_email),
    collection_notes        = coalesce(p_notes, collection_notes),
    updated_at              = now()
  where id = p_invoice;

  -- Notify the collections owner only when they're newly assigned by someone else.
  if v_new_owner is not null and v_new_owner <> coalesce(v_old_owner,'') and v_new_owner <> v_actor then
    insert into public.crm_notification (recipient_email, type, pipeline_id, title, body)
    values (
      v_new_owner, 'collection_assigned', null,
      'Collection assigned: invoice ' || coalesce(v_inv, '?'),
      'Follow up payment for ' || coalesce(v_cust, 'a customer') || ' (invoice ' || coalesce(v_inv, '?') || ').'
    );
  end if;
end $function$;
grant execute on function public.ar_update_collection(uuid,date,text,text,text) to authenticated;

COMMIT;
