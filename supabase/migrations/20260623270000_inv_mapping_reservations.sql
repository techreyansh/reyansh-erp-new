-- Inventory ↔ Costing/MRP material-code mapping + reservations.
-- Mapping = code-identity: each costing material_code (material_rate, rate_type
-- 'material') becomes a first-class ppc inventory item with the SAME code, so
-- costing_line.material_code links directly to ppc_items.code (no translation).

-- 1) Make the 10 costing material codes inventory items (idempotent).
insert into public.ppc_items (code, name, item_type, uom, unit_cost, is_active)
select mr.material_code, mr.material_name, 'raw_material', mr.uom, mr.rate, true
from public.material_rate mr
where mr.rate_type = 'material'
  and not exists (select 1 from public.ppc_items i where lower(i.code) = lower(mr.material_code));

-- 2) Stock rows for them (start at 0 on-hand; store team enters actuals).
insert into public.ppc_stock (item_id, on_hand, reorder_point, safety_stock)
select i.id, 0, 0, 0 from public.ppc_items i
where i.code in (select material_code from public.material_rate where rate_type='material')
  and not exists (select 1 from public.ppc_stock st where st.item_id = i.id);

-- 3) Reservation ledger (one row per SO × material). reserved on ppc_stock is
-- recomputed = sum of open reservations, so it's idempotent + releasable.
create table if not exists public.inv_reservations (
  id uuid primary key default gen_random_uuid(),
  so_id uuid, so_number text, item_id uuid references public.ppc_items(id) on delete cascade,
  material_code text, qty numeric default 0, created_at timestamptz default now(),
  unique (so_id, item_id)
);
alter table public.inv_reservations enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='inv_reservations' and policyname='invres_all') then
    create policy invres_all on public.inv_reservations for all using (true) with check (true);
  end if;
end $$;

create or replace function public.inv_recompute_reserved()
returns void language sql security definer set search_path to 'public' as $function$
  update public.ppc_stock st set reserved = coalesce((select sum(qty) from public.inv_reservations r where r.item_id = st.item_id), 0);
$function$;

-- Reserve a sales order's materials (from its costing BOM). Idempotent.
create or replace function public.inv_reserve_for_order(p_so uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_so_no text; v_n int;
begin
  select so_number into v_so_no from public.sales_order where id = p_so;
  delete from public.inv_reservations where so_id = p_so;
  insert into public.inv_reservations (so_id, so_number, item_id, material_code, qty)
  select p_so, v_so_no, pi.id, cl.material_code,
         round(sum(cl.qty * sol.qty / nullif(cv.qty_basis, 0)), 3)
  from public.sales_order_line sol
  join public.costing_version cv on cv.id = sol.costing_version_id
  join public.costing_line cl on cl.costing_id = cv.id and cl.section='material'
       and cl.material_code is not null and coalesce(cl.is_percentage,false)=false
  join public.ppc_items pi on lower(pi.code) = lower(cl.material_code)
  where sol.so_id = p_so
  group by pi.id, cl.material_code;
  perform public.inv_recompute_reserved();
  select count(*) into v_n from public.inv_reservations where so_id = p_so;
  return jsonb_build_object('so', v_so_no, 'reserved_materials', v_n);
end $function$;

create or replace function public.inv_release_order(p_so uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  delete from public.inv_reservations where so_id = p_so;
  perform public.inv_recompute_reserved();
end $function$;

grant execute on function public.inv_reserve_for_order(uuid) to authenticated;
grant execute on function public.inv_release_order(uuid) to authenticated;
grant execute on function public.inv_recompute_reserved() to authenticated;
