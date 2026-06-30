-- Profitability V1.2 Phase C: a durable material-type tag on items so ACTUAL
-- consumption can be split copper/PVC/component (the Merge-Items tool dissolves
-- the generic codes, so a column is the honest mechanism). Plus a material_code
-- → group map used on both the expected (costing_line) and actual (item) sides.
BEGIN;

alter table public.ppc_items add column if not exists material_group text;

-- Canonical material_code → group map (used by backfill + the variance engine).
create or replace function public.prof_material_group(p_code text)
returns text language sql immutable as $$
  select case
    when upper(coalesce(p_code,'')) = 'COPPER' then 'copper'
    when upper(p_code) in ('PVC_INS','PVC_SHEATH','PVC') then 'pvc'
    when upper(p_code) in ('SLEEVE','LABEL','PACKING') then 'packing'
    when upper(p_code) like 'PIN%' or upper(p_code) in ('TERMINAL','CONNECTOR','PLUG') then 'component'
    when coalesce(p_code,'') = '' then null
    else 'other'
  end;
$$;

-- Backfill from the generic-code items (code-identity with the rate master).
update public.ppc_items i
   set material_group = public.prof_material_group(i.code)
 where i.material_group is null
   and exists (select 1 from public.material_rate mr
               where lower(mr.material_code) = lower(i.code) and mr.rate_type = 'material');

-- Preserve material_group when Merge-Items folds a generic into a SKU.
create or replace function public.inv_merge_item(p_from_code text, p_to_code text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_from uuid; v_to uuid; v_mid uuid; v_affected jsonb;
begin
  if not public.is_super_admin() then raise exception 'not_authorized'; end if;
  select id into v_from from public.ppc_items where code = p_from_code;
  select id into v_to   from public.ppc_items where code = p_to_code;
  if v_from is null or v_to is null then raise exception 'item_not_found'; end if;
  if v_from = v_to then raise exception 'same_item'; end if;

  if exists (select 1 from public.inv_ledger where item_id = v_from)
     and exists (select 1 from public.inv_ledger where item_id = v_to) then
    raise exception 'both_items_have_stock';
  end if;

  v_affected := jsonb_build_object(
    'bom',     (select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) from public.ppc_bom b
                 where b.component_item_id = v_from or b.parent_item_id = v_from),
    'balance', (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.inv_balance x where x.item_id = v_from),
    'ledger_rows', (select count(*) from public.inv_ledger where item_id = v_from),
    'material_rate_codes', (select count(*) from public.material_rate where material_code = p_from_code));

  update public.ppc_bom tb set qty_per = tb.qty_per + fb.qty_per from public.ppc_bom fb
    where fb.component_item_id = v_from and tb.parent_item_id = fb.parent_item_id and tb.component_item_id = v_to;
  delete from public.ppc_bom fb where fb.component_item_id = v_from
    and exists (select 1 from public.ppc_bom tb where tb.parent_item_id = fb.parent_item_id and tb.component_item_id = v_to);
  update public.ppc_bom set component_item_id = v_to where component_item_id = v_from;

  update public.ppc_bom tb set qty_per = tb.qty_per + fb.qty_per from public.ppc_bom fb
    where fb.parent_item_id = v_from and tb.parent_item_id = v_to and tb.component_item_id = fb.component_item_id;
  delete from public.ppc_bom fb where fb.parent_item_id = v_from
    and exists (select 1 from public.ppc_bom tb where tb.parent_item_id = v_to and tb.component_item_id = fb.component_item_id);
  update public.ppc_bom set parent_item_id = v_to where parent_item_id = v_from;

  delete from public.ppc_bom where parent_item_id = component_item_id;

  update public.material_rate   set material_code = p_to_code where material_code = p_from_code;
  update public.costing_line    set material_code = p_to_code where material_code = p_from_code;
  update public.rate_change_log set rate_code      = p_to_code where rate_code      = p_from_code;

  update public.inv_ledger  set item_id = v_to where item_id = v_from;
  update public.inv_balance set item_id = v_to where item_id = v_from;

  -- preserve the material grouping: the SKU keeps the generic's copper/PVC tag
  update public.ppc_items t set material_group = coalesce(t.material_group, f.material_group)
    from public.ppc_items f where t.id = v_to and f.id = v_from and f.material_group is not null;

  delete from public.ppc_items where id = v_from;

  insert into public.inv_item_merge_log(from_id, from_code, to_id, to_code, affected, merged_by)
    values (v_from, p_from_code, v_to, p_to_code, v_affected, public.rbac_current_email())
    returning merge_id into v_mid;
  return jsonb_build_object('ok', true, 'merge_id', v_mid, 'from_code', p_from_code, 'to_code', p_to_code);
end $$;
revoke all on function public.inv_merge_item(text,text) from public, anon;
grant execute on function public.inv_merge_item(text,text) to authenticated;

COMMIT;
