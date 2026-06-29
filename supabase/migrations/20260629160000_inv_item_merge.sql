-- Item-master merge: fold a generic ppc_items code (e.g. COPPER) into a physical
-- SKU. Repoints every reference (BOM hard FKs + rate/costing soft text refs +
-- ledger/balance) in ONE transaction, snapshots to an audit log, then deletes the
-- generic. Super-admin only. The mapping is user-driven via the Merge Items UI.
--
-- Stock safety: generics are rate/BOM codes that carry no stock, so the inventory
-- side is normally a no-op. To avoid a wrong weighted-avg valuation we REFUSE to
-- merge when BOTH items actually carry ledger movements — that case needs a manual
-- consolidation, not an automatic one.
BEGIN;

create table if not exists public.inv_item_merge_log (
  merge_id   uuid primary key default gen_random_uuid(),
  from_id    uuid,
  from_code  text,
  to_id      uuid,
  to_code    text,
  affected   jsonb,
  merged_by  text,
  merged_at  timestamptz not null default now()
);
alter table public.inv_item_merge_log enable row level security;
drop policy if exists inv_item_merge_log_read on public.inv_item_merge_log;
create policy inv_item_merge_log_read on public.inv_item_merge_log
  for select using (public.is_super_admin());

-- ---- Preview: what WOULD repoint + collision/blocker flags (no writes) --------
create or replace function public.inv_merge_preview(p_from_code text, p_to_code text)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_from uuid; v_to uuid; v_from_stock boolean; v_to_stock boolean;
begin
  select id into v_from from public.ppc_items where code = p_from_code;
  select id into v_to   from public.ppc_items where code = p_to_code;
  if v_from is null then return jsonb_build_object('error', 'From code not found: '||coalesce(p_from_code,'')); end if;
  if v_to   is null then return jsonb_build_object('error', 'To code not found: '||coalesce(p_to_code,'')); end if;
  if v_from = v_to  then return jsonb_build_object('error', 'From and To are the same item.'); end if;

  v_from_stock := exists (select 1 from public.inv_ledger where item_id = v_from);
  v_to_stock   := exists (select 1 from public.inv_ledger where item_id = v_to);

  return jsonb_build_object(
    'from_code', p_from_code, 'to_code', p_to_code, 'from_id', v_from, 'to_id', v_to,
    'bom_component_rows', (select count(*) from public.ppc_bom where component_item_id = v_from),
    'bom_parent_rows',    (select count(*) from public.ppc_bom where parent_item_id = v_from),
    'material_rate_rows', (select count(*) from public.material_rate where material_code = p_from_code),
    'costing_line_rows',  (select count(*) from public.costing_line where material_code = p_from_code),
    'rate_log_rows',      (select count(*) from public.rate_change_log where rate_code = p_from_code),
    'ledger_rows',        (select count(*) from public.inv_ledger where item_id = v_from),
    'on_hand_from',       (select coalesce(sum(on_hand),0) from public.inv_balance where item_id = v_from),
    'on_hand_to',         (select coalesce(sum(on_hand),0) from public.inv_balance where item_id = v_to),
    -- BOM parents where TO is already a component → qty folds into the existing line
    'bom_collisions',     (select count(*) from public.ppc_bom fb join public.ppc_bom tb
                             on tb.parent_item_id = fb.parent_item_id and tb.component_item_id = v_to
                           where fb.component_item_id = v_from),
    -- hard blocker: both items carry stock movements
    'blocked',            (v_from_stock and v_to_stock),
    'block_reason',       case when (v_from_stock and v_to_stock)
                               then 'Both items carry stock movements — consolidate stock manually before merging.'
                               else null end
  );
end $$;
grant execute on function public.inv_merge_preview(text,text) to authenticated;

-- ---- Merge: repoint everything, snapshot, delete generic (super-admin only) ---
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

  -- Refuse when both items actually carry stock (avoid wrong valuation merge).
  if exists (select 1 from public.inv_ledger where item_id = v_from)
     and exists (select 1 from public.inv_ledger where item_id = v_to) then
    raise exception 'both_items_have_stock';
  end if;

  -- Snapshot affected refs for audit / manual recovery.
  v_affected := jsonb_build_object(
    'bom',     (select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) from public.ppc_bom b
                 where b.component_item_id = v_from or b.parent_item_id = v_from),
    'balance', (select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.inv_balance x where x.item_id = v_from),
    'ledger_rows', (select count(*) from public.inv_ledger where item_id = v_from),
    'material_rate_codes', (select count(*) from public.material_rate where material_code = p_from_code)
  );

  -- 1. ppc_bom component refs (UNIQUE(parent,component)) — fold colliding lines.
  update public.ppc_bom tb set qty_per = tb.qty_per + fb.qty_per
    from public.ppc_bom fb
    where fb.component_item_id = v_from
      and tb.parent_item_id = fb.parent_item_id and tb.component_item_id = v_to;
  delete from public.ppc_bom fb
    where fb.component_item_id = v_from
      and exists (select 1 from public.ppc_bom tb
                  where tb.parent_item_id = fb.parent_item_id and tb.component_item_id = v_to);
  update public.ppc_bom set component_item_id = v_to where component_item_id = v_from;

  -- 2. ppc_bom parent refs (rare for generics) — same collision handling.
  update public.ppc_bom tb set qty_per = tb.qty_per + fb.qty_per
    from public.ppc_bom fb
    where fb.parent_item_id = v_from
      and tb.parent_item_id = v_to and tb.component_item_id = fb.component_item_id;
  delete from public.ppc_bom fb
    where fb.parent_item_id = v_from
      and exists (select 1 from public.ppc_bom tb
                  where tb.parent_item_id = v_to and tb.component_item_id = fb.component_item_id);
  update public.ppc_bom set parent_item_id = v_to where parent_item_id = v_from;

  -- 3. drop any self-referential line the merge may have created.
  delete from public.ppc_bom where parent_item_id = component_item_id;

  -- 4. soft text refs (rate master, costing lines, rate audit).
  update public.material_rate   set material_code = p_to_code where material_code = p_from_code;
  update public.costing_line    set material_code = p_to_code where material_code = p_from_code;
  update public.rate_change_log set rate_code      = p_to_code where rate_code      = p_from_code;

  -- 5. inventory ledger + balance. Guard above guarantees at most one side has
  --    stock, so a straight item_id repoint never hits the inv_balance PK or
  --    corrupts the running qty_after snapshots.
  update public.inv_ledger  set item_id = v_to where item_id = v_from;
  update public.inv_balance set item_id = v_to where item_id = v_from;

  -- 6. delete the now-orphaned generic item.
  delete from public.ppc_items where id = v_from;

  insert into public.inv_item_merge_log(from_id, from_code, to_id, to_code, affected, merged_by)
    values (v_from, p_from_code, v_to, p_to_code, v_affected, public.rbac_current_email())
    returning merge_id into v_mid;

  return jsonb_build_object('ok', true, 'merge_id', v_mid, 'from_code', p_from_code, 'to_code', p_to_code);
end $$;
revoke all on function public.inv_merge_item(text,text) from public, anon;
grant execute on function public.inv_merge_item(text,text) to authenticated;

COMMIT;
