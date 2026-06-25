-- Inventory → Material Control System, Phase 1 (ADDITIVE; consolidate onto PPC).
-- Extends PPC item types (semi-finished/FG), adds reserved/available, seeds the
-- empty PPC engine from the populated legacy stock sheet, and adds a control
-- dashboard. Legacy /inventory is left intact for now.

-- 1) Material segmentation: allow semi-finished + finished-good item types.
alter table public.ppc_items drop constraint if exists ppc_items_item_type_check;
alter table public.ppc_items add constraint ppc_items_item_type_check
  check (item_type = any (array['cable','power_cord','harness','component','raw_material','semi_finished','finished_good']));

-- 2) Reserved qty (available = on_hand - reserved).
alter table public.ppc_stock add column if not exists reserved numeric not null default 0;

-- 3) Seed ppc_items from legacy stock_data (raw materials), idempotent.
insert into public.ppc_items (code, name, item_type, uom, is_active)
select distinct on (lower(s."itemCode")) s."itemCode", coalesce(nullif(s."itemName",''), s."itemCode"),
       'raw_material', coalesce(nullif(s.unit,''), 'pcs'), true
from public.stock_data s
where s."itemCode" is not null and s."itemCode" <> ''
  and not exists (select 1 from public.ppc_items i where lower(i.code) = lower(s."itemCode"));

-- 4) Seed ppc_stock for those items (safe numeric cast — legacy values are text).
insert into public.ppc_stock (item_id, on_hand, reorder_point, safety_stock, max_qty, location)
select i.id,
  coalesce(nullif(substring(coalesce(s."currentStock"::text,'') from '[0-9]+\.?[0-9]*'),'')::numeric, 0),
  coalesce(nullif(substring(coalesce(s."reorderPoint"::text,'') from '[0-9]+\.?[0-9]*'),'')::numeric, 0),
  coalesce(nullif(substring(coalesce(s."minLevel"::text,'') from '[0-9]+\.?[0-9]*'),'')::numeric, 0),
  coalesce(nullif(substring(coalesce(s."maxLevel"::text,'') from '[0-9]+\.?[0-9]*'),'')::numeric, 0),
  s.location
from public.stock_data s join public.ppc_items i on lower(i.code) = lower(s."itemCode")
where not exists (select 1 from public.ppc_stock st where st.item_id = i.id);

-- 5) Material Control dashboard rollup.
create or replace function public.inv_control_dashboard()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'total_items', (select count(*) from ppc_items where is_active),
    'raw_count',  (select count(*) from ppc_items where item_type='raw_material' and is_active),
    'semi_count', (select count(*) from ppc_items where item_type='semi_finished' and is_active),
    'fg_count',   (select count(*) from ppc_items where item_type in ('finished_good','cable','power_cord','harness') and is_active),
    'total_valuation', (select coalesce(sum(st.on_hand * coalesce(i.unit_cost,0)),0) from ppc_stock st join ppc_items i on i.id=st.item_id),
    'reserved_total',  (select coalesce(sum(reserved),0) from ppc_stock),
    'below_reorder',   (select count(*) from ppc_stock where reorder_point>0 and on_hand <= reorder_point),
    'stock_out',       (select count(*) from ppc_stock where on_hand <= 0),
    'below_reorder_items', (select coalesce(jsonb_agg(jsonb_build_object(
        'code', i.code, 'name', i.name, 'on_hand', st.on_hand, 'reserved', st.reserved,
        'available', st.on_hand - st.reserved, 'reorder_point', st.reorder_point, 'uom', i.uom) order by st.on_hand), '[]'::jsonb)
      from ppc_stock st join ppc_items i on i.id=st.item_id where st.reorder_point>0 and st.on_hand <= st.reorder_point)
  );
$function$;
grant execute on function public.inv_control_dashboard() to authenticated;
