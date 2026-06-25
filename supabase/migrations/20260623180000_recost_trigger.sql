-- DB-trigger auto-recost: any change to a master rate re-prices non-frozen lines
-- and recomputes affected (non-superseded) costing_versions — mirrors the JS
-- costingEngine math exactly. Makes rate changes cascade from ANY source.
create or replace function public.recost_costing_version(p_version uuid)
returns void language plpgsql as $$
declare
  v_mat numeric := 0; v_lab numeric := 0; v_mac numeric := 0; v_ovh numeric := 0; v_fin numeric := 0;
  v_total numeric; v_margin numeric; v_price numeric; v_master_margin numeric;
  r record; base numeric;
begin
  -- 1) reprice non-frozen lines from the live rate master
  update costing_line cl set
    rate = mr.rate,
    amount = case when cl.is_percentage then cl.amount else round(coalesce(cl.qty,0) * mr.rate, 2) end
  from material_rate mr
  where cl.costing_id = p_version and cl.rate_overridden = false and cl.material_code = mr.material_code;

  -- 2) absolute section sums (amount, else qty*rate)
  select
    coalesce(sum(case when section='material'  then coalesce(amount, qty*rate) end),0),
    coalesce(sum(case when section='labour'    then coalesce(amount, qty*rate) end),0),
    coalesce(sum(case when section='machine'   then coalesce(amount, qty*rate) end),0),
    coalesce(sum(case when section='overhead'  then coalesce(amount, qty*rate) end),0),
    coalesce(sum(case when section='financial' then coalesce(amount, qty*rate) end),0)
  into v_mat, v_lab, v_mac, v_ovh, v_fin
  from costing_line where costing_id=p_version and coalesce(is_percentage,false)=false;

  -- 3) percentage lines applied against their basis (default material)
  for r in select * from costing_line where costing_id=p_version and is_percentage=true loop
    base := case r.pct_basis
      when 'labour' then v_lab when 'machine' then v_mac when 'overhead' then v_ovh
      when 'financial' then v_fin when 'total' then v_mat+v_lab+v_mac+v_ovh+v_fin else v_mat end;
    if    r.section='material'  then v_mat := v_mat + base*coalesce(r.amount,r.rate)/100;
    elsif r.section='labour'    then v_lab := v_lab + base*coalesce(r.amount,r.rate)/100;
    elsif r.section='machine'   then v_mac := v_mac + base*coalesce(r.amount,r.rate)/100;
    elsif r.section='overhead'  then v_ovh := v_ovh + base*coalesce(r.amount,r.rate)/100;
    elsif r.section='financial' then v_fin := v_fin + base*coalesce(r.amount,r.rate)/100;
    end if;
  end loop;

  v_mat:=round(v_mat,2); v_lab:=round(v_lab,2); v_mac:=round(v_mac,2); v_ovh:=round(v_ovh,2); v_fin:=round(v_fin,2);
  v_total := round(v_mat+v_lab+v_mac+v_ovh+v_fin,2);

  select rate into v_master_margin from material_rate where material_code='MARGIN_PCT';
  select case when target_margin_pct is null then coalesce(v_master_margin,0) else target_margin_pct end
    into v_margin from costing_version where id=p_version;
  v_margin := least(greatest(coalesce(v_margin,0),0),99.99);
  v_price := round(case when v_margin>0 then v_total/(1-v_margin/100) else v_total end, 2);

  update costing_version set
    material_cost=v_mat, labour_cost=v_lab, machine_cost=v_mac, overhead_cost=v_ovh, financial_cost=v_fin,
    total_cost=v_total, net_selling_price=v_price,
    net_margin_pct  = case when v_price>0 then round((v_price - v_total)/v_price*100,2) else 0 end,
    contribution_pct= case when v_price>0 then round((v_price-(v_mat+v_lab))/v_price*100,2) else 0 end,
    gross_margin_pct= case when v_price>0 then round((v_price-(v_mat+v_lab+v_mac))/v_price*100,2) else 0 end,
    recosted_at=now(), rate_basis_date=current_date
  where id=p_version;
end $$;

create or replace function public.recost_all_versions()
returns integer language plpgsql as $$
declare v record; cnt int := 0;
begin
  for v in select id from costing_version where status <> 'superseded' loop
    perform public.recost_costing_version(v.id); cnt := cnt + 1;
  end loop;
  return cnt;
end $$;

create or replace function public.trg_recost_on_rate_change()
returns trigger language plpgsql as $$
declare v record; cnt int := 0;
begin
  if NEW.rate is distinct from OLD.rate then
    for v in select distinct cl.costing_id from costing_line cl
             join costing_version cv on cv.id=cl.costing_id
             where cl.material_code = NEW.material_code and cl.rate_overridden = false
               and cv.status <> 'superseded'
    loop
      perform public.recost_costing_version(v.costing_id); cnt := cnt + 1;
    end loop;
    insert into rate_change_log (rate_code, rate_type, old_rate, new_rate, pct_change, reason, changed_by_email, affected_versions)
    values (NEW.material_code, NEW.rate_type, OLD.rate, NEW.rate,
            case when OLD.rate is not null and OLD.rate<>0 then round((NEW.rate-OLD.rate)/OLD.rate*100,2) else null end,
            'Rate change (auto-recost)', NEW.updated_by_email, cnt);
  end if;
  return NEW;
end $$;

drop trigger if exists trg_material_rate_recost on public.material_rate;
create trigger trg_material_rate_recost after update of rate on public.material_rate
for each row execute function public.trg_recost_on_rate_change();

grant execute on function public.recost_costing_version(uuid) to authenticated;
grant execute on function public.recost_all_versions() to authenticated;
