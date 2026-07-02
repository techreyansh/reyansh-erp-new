# Profitability Net Profit Allocation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spread company operating expenses pro-rata by revenue onto each product, customer, order, and month so every Profitability rollup carries an allocated Net Profit line.

**Architecture:** One additive migration redefines the `profit_summary` Postgres RPC to add `allocated_opex` / `net_profit` / `net_margin` to four rollups, using a full-company (filter-invariant) revenue denominator. The React page and the monthly report builder then surface the new fields. No schema change, no new tables.

**Tech Stack:** Supabase Postgres (plpgsql `SECURITY DEFINER` RPC), Create React App + MUI v7, Jest + React Testing Library.

## Global Constraints

- This is a **CEO-only** module: the `profit_summary` RPC keeps its `is_super_admin()` guard and `SECURITY DEFINER`; never weaken either.
- **No schema change.** Allocation is pure computation inside `profit_summary`. Do not add columns or tables.
- **Allocation denominator is full-company and filter-invariant.** Use total costed revenue over the UNFILTERED fact set (`fact0`), never the filtered `fact`. A line's overhead share must not change when a filter is applied.
- **Uncosted lines absorb no overhead:** they are excluded from the denominator and any group whose costed revenue is 0 returns `net_profit = null` / `net_margin = null` (render as "—").
- **Migration safety:** timestamp the new migration file AFTER the latest applied migration; never run a blind `supabase db push --include-all` (see `~/.gstack/projects/.../reyansh-erp-migration-ledger`). No local Postgres/Docker on this machine — RPC verification is live REST against the linked project with a CEO token.
- Money is INR; reuse the page's existing `money` / `pct` formatters. Match the existing `cols`-array table pattern; do not introduce a new table component.

---

### Task 1: Redefine `profit_summary` RPC with net allocation

**Files:**
- Create: `supabase/migrations/20260701120000_profitability_net_allocation.sql`
- Reference (do not edit): `supabase/migrations/20260701110000_profitability_cm_net.sql` (current definition)

**Interfaces:**
- Consumes: existing `expense_entry`, `sales_order_line`, `sales_order`, `finance_invoice_line`, `finance_invoices`, `costing_version`, `profit_product_cost_override`, `product`.
- Produces: `profit_summary(p_from date, p_to date, p_basis text, p_filters jsonb)` returns the same jsonb, with `by_customer[]`, `by_product[]`, `by_order[]`, and `by_month[]` objects each gaining numeric `allocated_opex`, nullable numeric `net_profit`, nullable numeric `net_margin`.

- [ ] **Step 1: Create the migration file with the full redefined function**

This is a `create or replace` — paste the complete function. The only changes vs the current definition are: (a) two new CTEs `allrev` and `oprate` after the `fact` CTE, and (b) three new fields appended to the inner selects of `by_customer`, `by_product`, `by_order`, `by_month`.

Create `supabase/migrations/20260701120000_profitability_net_allocation.sql`:

```sql
-- Profitability V2: allocate operating expenses (expense_entry) pro-rata by
-- revenue onto by_customer/by_product/by_order/by_month so each rollup carries
-- a Net Profit line. Denominator = full-company costed revenue (filter-invariant,
-- from fact0). Uncosted groups get net = null. No schema change. CEO-only.
BEGIN;

create or replace function public.profit_summary(
  p_from date, p_to date, p_basis text default 'ordered', p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare v jsonb; v_exp numeric; v_exp_break jsonb;
begin
  if not public.is_super_admin() then raise exception 'not_authorized'; end if;

  select coalesce(sum(amount),0) into v_exp from public.expense_entry
    where coalesce(period_month, to_char(entry_date,'YYYY-MM'))
          between to_char(p_from,'YYYY-MM') and to_char(p_to,'YYYY-MM');
  select coalesce(jsonb_agg(jsonb_build_object('type', expense_type, 'amount', round(amt,2)) order by amt desc), '[]'::jsonb)
    into v_exp_break from (
      select expense_type, sum(amount) amt from public.expense_entry
      where coalesce(period_month, to_char(entry_date,'YYYY-MM')) between to_char(p_from,'YYYY-MM') and to_char(p_to,'YYYY-MM')
      group by expense_type) t;

  with flt as (
    select nullif(p_filters->>'customer_code','') f_cust, nullif(p_filters->>'product_id','')::uuid f_prod,
           nullif(p_filters->>'product_family','') f_fam, nullif(p_filters->>'product_category','') f_cat,
           lower(nullif(p_filters->>'sales_exec','')) f_exec,
           nullif(p_filters->>'rev_min','')::numeric f_rmin, nullif(p_filters->>'rev_max','')::numeric f_rmax
  ),
  src as (
    select l.id line_id, l.qty, l.line_value revenue, l.product_id, l.costing_version_id,
           so.customer_code, so.company_name, lower(coalesce(so.owner_email,'')) sales_exec,
           so.created_at::date txn_date, so.so_number, so.id order_id
    from public.sales_order_line l join public.sales_order so on so.id = l.so_id
    where p_basis = 'ordered' and so.created_at::date between p_from and p_to and so.status <> 'cancelled'
    union all
    select fl.id, fl.qty, fl.taxable_value revenue,
           (select pp.id from public.product pp where pp.product_code = fl.product_code limit 1),
           null::uuid, fi.customer_code, fi.customer_name, lower(coalesce(fi.owner_email,'')),
           coalesce(fi.invoice_date, fi.created_at::date), fi.invoice_number, fi.id
    from public.finance_invoice_line fl join public.finance_invoices fi on fi.id = fl.invoice_id
    where p_basis = 'realized' and coalesce(fi.invoice_date, fi.created_at::date) between p_from and p_to
  ),
  fact0 as (
    select s.*, p.product_name, p.product_code, p.product_family, p.product_category,
           cr.mat_per_unit, cr.conv_per_unit, cr.var_per_unit, cr.cost_source, cr.resolved_cv
    from src s
    left join public.product p on p.id = s.product_id
    left join lateral (
      select coalesce(pin.m, ovr.m, rel.m) mat_per_unit,
             coalesce(pin.c, ovr.c, rel.c) conv_per_unit,
             coalesce(pin.vc, ovr.vc, rel.vc) var_per_unit,
             coalesce(pin.cv, rel.cv) resolved_cv,
             case when pin.m is not null then 'costing' when ovr.m is not null then 'override'
                  when rel.m is not null then 'released' else 'uncosted' end cost_source
      from (select 1) one
      left join lateral (select cv.id cv, cv.material_cost/nullif(cv.qty_basis,0) m,
                (cv.labour_cost+cv.machine_cost+cv.overhead_cost+cv.financial_cost)/nullif(cv.qty_basis,0) c,
                cv.labour_cost/nullif(cv.qty_basis,0) vc
                from public.costing_version cv where cv.id = s.costing_version_id) pin on true
      left join lateral (select o.material_per_unit m, o.conversion_per_unit c, o.conversion_per_unit vc
                from public.profit_product_cost_override o where o.product_id = s.product_id) ovr on true
      left join lateral (select cv.id cv, cv.material_cost/nullif(cv.qty_basis,0) m,
                (cv.labour_cost+cv.machine_cost+cv.overhead_cost+cv.financial_cost)/nullif(cv.qty_basis,0) c,
                cv.labour_cost/nullif(cv.qty_basis,0) vc
                from public.costing_version cv where cv.product_id = s.product_id and cv.status='released'
                order by cv.version_number desc limit 1) rel on true
    ) cr on true
  ),
  fact as (
    select f.*,
      round(f.qty * coalesce(f.mat_per_unit,0), 2) material,
      round(f.qty * coalesce(f.conv_per_unit,0), 2) conversion,
      round(f.qty * coalesce(f.var_per_unit,0), 2) variable_conv,
      round(f.qty * (coalesce(f.conv_per_unit,0) - coalesce(f.var_per_unit,0)), 2) fixed_conv,
      case when f.mat_per_unit is null then null
           else round(f.revenue - f.qty*coalesce(f.mat_per_unit,0) - f.qty*coalesce(f.conv_per_unit,0), 2) end gp,
      case when f.mat_per_unit is null then null
           else round(f.revenue - f.qty*coalesce(f.mat_per_unit,0) - f.qty*coalesce(f.var_per_unit,0), 2) end contribution,
      (f.mat_per_unit is null) uncosted
    from fact0 f, flt
    where (flt.f_cust is null or f.customer_code = flt.f_cust)
      and (flt.f_prod is null or f.product_id = flt.f_prod)
      and (flt.f_fam  is null or f.product_family = flt.f_fam)
      and (flt.f_cat  is null or f.product_category = flt.f_cat)
      and (flt.f_exec is null or f.sales_exec = flt.f_exec)
      and (flt.f_rmin is null or f.revenue >= flt.f_rmin)
      and (flt.f_rmax is null or f.revenue <= flt.f_rmax)
  ),
  -- full-company costed revenue (UNFILTERED, from fact0) = allocation denominator
  allrev as (
    select coalesce(sum(f.revenue) filter (where f.mat_per_unit is not null), 0) total_costed_rev
    from fact0 f
  ),
  -- operating-expense rate per rupee of company costed revenue
  oprate as (
    select case when (select total_costed_rev from allrev) > 0
                then v_exp / (select total_costed_rev from allrev) else 0 end r
  )
  select jsonb_build_object(
    'basis', p_basis, 'range', jsonb_build_object('from', p_from, 'to', p_to),
    'kpis', (select jsonb_build_object(
        'revenue', coalesce(round(sum(revenue),2),0),
        'material', coalesce(round(sum(material),2),0),
        'conversion', coalesce(round(sum(conversion),2),0),
        'variable_conv', coalesce(round(sum(variable_conv),2),0),
        'fixed_conv', coalesce(round(sum(fixed_conv),2),0),
        'gross_profit', coalesce(round(sum(gp),2),0),
        'contribution', coalesce(round(sum(contribution),2),0),
        'gm_pct', case when sum(revenue) filter (where not uncosted) > 0
                    then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else 0 end,
        'cm_pct', case when sum(revenue) filter (where not uncosted) > 0
                    then round(sum(contribution)/sum(revenue) filter (where not uncosted)*100,1) else 0 end,
        'orders', count(distinct order_id), 'lines', count(*),
        'uncosted_revenue', coalesce(round(sum(revenue) filter (where uncosted),2),0),
        'uncosted_lines', count(*) filter (where uncosted)) from fact),
    'net', (select jsonb_build_object(
        'revenue', coalesce(round(sum(revenue),2),0),
        'gross_profit', coalesce(round(sum(gp),2),0),
        'contribution', coalesce(round(sum(contribution),2),0),
        'fixed_conv', coalesce(round(sum(fixed_conv),2),0),
        'operating_expenses', round(v_exp,2),
        'expense_breakdown', v_exp_break,
        'net_profit', coalesce(round(sum(contribution) - sum(fixed_conv) - v_exp, 2), 0),
        'net_margin', case when sum(revenue) filter (where not uncosted) > 0
                      then round((sum(contribution)-sum(fixed_conv)-v_exp)/sum(revenue) filter (where not uncosted)*100,1) else 0 end
      ) from fact),
    'by_customer', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select customer_code code, max(company_name) name, round(sum(revenue),2) revenue,
               round(sum(material),2) material, round(sum(conversion),2) conversion,
               round(sum(gp),2) gross_profit, round(sum(contribution),2) contribution,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(contribution)/sum(revenue) filter (where not uncosted)*100,1) else null end cm_pct,
               round(coalesce(sum(revenue) filter (where not uncosted) * (select r from oprate),0),2) allocated_opex,
               case when sum(revenue) filter (where not uncosted)>0
                    then round(sum(contribution) - sum(fixed_conv) - sum(revenue) filter (where not uncosted) * (select r from oprate),2) else null end net_profit,
               case when sum(revenue) filter (where not uncosted)>0
                    then round((sum(contribution) - sum(fixed_conv) - sum(revenue) filter (where not uncosted) * (select r from oprate))/sum(revenue) filter (where not uncosted)*100,1) else null end net_margin,
               round(sum(qty),2) qty, count(distinct order_id) orders, count(distinct product_id) products
        from fact group by customer_code) x), '[]'::jsonb),
    'by_product', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select product_id, max(product_code) code, max(product_name) name, max(product_family) family,
               max(product_category) category, round(sum(revenue),2) revenue, round(sum(material),2) material,
               round(sum(conversion),2) conversion, round(sum(gp),2) gross_profit, round(sum(contribution),2) contribution,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(contribution)/sum(revenue) filter (where not uncosted)*100,1) else null end cm_pct,
               round(coalesce(sum(revenue) filter (where not uncosted) * (select r from oprate),0),2) allocated_opex,
               case when sum(revenue) filter (where not uncosted)>0
                    then round(sum(contribution) - sum(fixed_conv) - sum(revenue) filter (where not uncosted) * (select r from oprate),2) else null end net_profit,
               case when sum(revenue) filter (where not uncosted)>0
                    then round((sum(contribution) - sum(fixed_conv) - sum(revenue) filter (where not uncosted) * (select r from oprate))/sum(revenue) filter (where not uncosted)*100,1) else null end net_margin,
               round(sum(qty),2) qty, count(distinct customer_code) customers
        from fact group by product_id) x), '[]'::jsonb),
    'by_family', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select coalesce(product_family,'—') name, round(sum(revenue),2) revenue, round(sum(gp),2) gross_profit, round(sum(contribution),2) contribution,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct
        from fact group by product_family) x), '[]'::jsonb),
    'by_category', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select coalesce(product_category,'—') name, round(sum(revenue),2) revenue, round(sum(gp),2) gross_profit, round(sum(contribution),2) contribution,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct
        from fact group by product_category) x), '[]'::jsonb),
    'by_sales_exec', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select case when sales_exec='' then '—' else sales_exec end name, round(sum(revenue),2) revenue,
               round(sum(gp),2) gross_profit, round(sum(contribution),2) contribution,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct,
               count(distinct order_id) orders
        from fact group by sales_exec) x), '[]'::jsonb),
    'by_order', coalesce((select jsonb_agg(x order by x.gross_profit desc nulls last) from (
        select order_id, max(so_number) so_number, max(customer_code) customer_code, max(company_name) company_name,
               round(sum(revenue),2) revenue, round(sum(material),2) material, round(sum(conversion),2) conversion,
               round(sum(gp),2) gross_profit, round(sum(contribution),2) contribution,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct,
               round(coalesce(sum(revenue) filter (where not uncosted) * (select r from oprate),0),2) allocated_opex,
               case when sum(revenue) filter (where not uncosted)>0
                    then round(sum(contribution) - sum(fixed_conv) - sum(revenue) filter (where not uncosted) * (select r from oprate),2) else null end net_profit,
               case when sum(revenue) filter (where not uncosted)>0
                    then round((sum(contribution) - sum(fixed_conv) - sum(revenue) filter (where not uncosted) * (select r from oprate))/sum(revenue) filter (where not uncosted)*100,1) else null end net_margin
        from fact group by order_id) x), '[]'::jsonb),
    'by_month', coalesce((select jsonb_agg(jsonb_build_object(
          'month', ym, 'revenue', revenue, 'gross_profit', gross_profit, 'contribution', contribution, 'gm_pct', gm_pct,
          'allocated_opex', allocated_opex, 'net_profit', net_profit, 'net_margin', net_margin) order by ym) from (
        select to_char(txn_date,'YYYY-MM') ym, round(sum(revenue),2) revenue, round(sum(gp),2) gross_profit, round(sum(contribution),2) contribution,
               case when sum(revenue) filter (where not uncosted)>0 then round(sum(gp)/sum(revenue) filter (where not uncosted)*100,1) else null end gm_pct,
               round(coalesce(sum(revenue) filter (where not uncosted) * (select r from oprate),0),2) allocated_opex,
               case when sum(revenue) filter (where not uncosted)>0
                    then round(sum(contribution) - sum(fixed_conv) - sum(revenue) filter (where not uncosted) * (select r from oprate),2) else null end net_profit,
               case when sum(revenue) filter (where not uncosted)>0
                    then round((sum(contribution) - sum(fixed_conv) - sum(revenue) filter (where not uncosted) * (select r from oprate))/sum(revenue) filter (where not uncosted)*100,1) else null end net_margin
        from fact group by to_char(txn_date,'YYYY-MM')) t), '[]'::jsonb),
    'needs_costing', coalesce((select jsonb_agg(x order by x.revenue desc) from (
        select product_id, max(product_code) code, max(product_name) name, round(sum(revenue),2) revenue, count(*) lines
        from fact where uncosted group by product_id) x), '[]'::jsonb),
    'material_breakdown', coalesce((select jsonb_agg(x order by x.amount desc) from (
        select cl.material_code code, round(sum(cl.amount * f.qty / nullif(cv.qty_basis,0)),2) amount
        from fact f join public.costing_version cv on cv.id = f.resolved_cv
        join public.costing_line cl on cl.costing_id = f.resolved_cv and cl.section='material' and cl.material_code is not null
        group by cl.material_code) x), '[]'::jsonb)
  ) into v;
  return v;
end $fn$;
revoke all on function public.profit_summary(date,date,text,jsonb) from public, anon;
grant execute on function public.profit_summary(date,date,text,jsonb) to authenticated;

COMMIT;
```

- [ ] **Step 2: Static sanity check (no DB needed)**

Confirm the migration is internally consistent before applying. Run:

```bash
grep -c "select r from oprate" supabase/migrations/20260701120000_profitability_net_allocation.sql
```

Expected: `12` (3 references × 4 rollups). If not 12, a rollup is missing its net fields — fix before proceeding.

Then confirm the new CTEs exist exactly once each:

```bash
grep -cE "^  allrev as \(|^  oprate as \(" supabase/migrations/20260701120000_profitability_net_allocation.sql
```

Expected: `2`.

- [ ] **Step 3: Apply the migration (safe recipe — no blind --include-all)**

Check for any colliding/unapplied migration timestamps first:

```bash
cd ~/Desktop/reyansh-erp-new
ls supabase/migrations/ | sort | tail -6
supabase migration list 2>/dev/null | tail -12
```

If the new file (`20260701120000_...`) is strictly after the last APPLIED remote migration and there are no earlier unapplied/duplicate-timestamp files, apply just the pending set:

```bash
supabase db push
```

If `db push` reports an earlier out-of-order or duplicate-timestamp file that is not yours, STOP and use the migration-ledger recipe: `mv` the colliding non-yours file aside, `supabase db push`, then restore it. Never pass `--include-all`.

- [ ] **Step 4: Verify reconciliation live (CEO token, REST)**

Call the RPC for a period with known data (the PICDEMO seed). Use the CEO Supabase JWT (from the browser localStorage key `sb-azwdxgahmdgccfimhtmm-auth-token`, per the QA note in the profitability-center memory):

```bash
curl -s -X POST "$REACT_APP_SUPABASE_URL/rest/v1/rpc/profit_summary" \
  -H "apikey: $REACT_APP_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $CEO_JWT" \
  -H "Content-Type: application/json" \
  -d '{"p_from":"2026-01-01","p_to":"2026-12-31","p_basis":"ordered","p_filters":{}}' \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
net=d['net']['net_profit']
for dim in ['by_product','by_customer','by_order']:
    s=round(sum((r.get('net_profit') or 0) for r in d[dim]),2)
    print(dim, 'Σnet=', s, 'company net=', net, 'reconciles' if abs(s-net)<1.0 else 'MISMATCH')
# uncosted group must have null net + 0 allocated_opex
unc=[r for r in d['by_product'] if (r.get('gm_pct') is None)]
print('uncosted groups:', len(unc), 'all null net+0 opex:',
      all(r.get('net_profit') is None and (r.get('allocated_opex') or 0)==0 for r in unc))
"
```

Expected: each dimension prints `reconciles` (Σ per-line net ≈ company net within rounding), and uncosted groups show `null net + 0 opex`.

- [ ] **Step 5: Verify zero-revenue guard**

Call for a period with operating expenses logged but no costed sales (use a future/empty month range):

```bash
curl -s -X POST "$REACT_APP_SUPABASE_URL/rest/v1/rpc/profit_summary" \
  -H "apikey: $REACT_APP_SUPABASE_ANON_KEY" -H "Authorization: Bearer $CEO_JWT" \
  -H "Content-Type: application/json" \
  -d '{"p_from":"2030-01-01","p_to":"2030-01-31","p_basis":"ordered","p_filters":{}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('by_product rows:', len(d['by_product']), 'no error -> guard OK')"
```

Expected: returns without a division error; empty or zero-allocation rollups.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260701120000_profitability_net_allocation.sql
git commit -m "feat(profitability): allocate operating expenses to net profit per rollup"
```

---

### Task 2: Add Net columns to the Monthly report builder

**Files:**
- Modify: `src/services/reporting/profitabilityReports.js` (the `buildMonthlyVariance` function's `by_month` section)
- Test: `src/services/reporting/profitabilityReports.test.js` (create)

**Interfaces:**
- Consumes: `buildMonthlyVariance(summary)` where `summary.by_month[]` rows now carry `net_profit` (nullable) and `net_margin` (nullable) from Task 1.
- Produces: the returned Report's `by_month` section gains `Net Profit` and `Net %` columns; existing columns unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/services/reporting/profitabilityReports.test.js`:

```javascript
import { buildMonthlyVariance } from "./profitabilityReports";

const summary = {
  range: { from: "2026-01-01", to: "2026-03-31" },
  by_month: [
    { month: "2026-01", revenue: 100000, gross_profit: 30000, contribution: 25000, gm_pct: 30, net_profit: 12000, net_margin: 12 },
    { month: "2026-02", revenue: 0, gross_profit: 0, contribution: 0, gm_pct: null, net_profit: null, net_margin: null },
  ],
};

test("buildMonthlyVariance includes Net Profit and Net % columns", () => {
  const report = buildMonthlyVariance(summary);
  const section = report.sections.find((s) => s.key === "by_month");
  const colLabels = section.columns.map((c) => c.label);
  expect(colLabels).toContain("Net Profit");
  expect(colLabels).toContain("Net %");
});

test("buildMonthlyVariance renders a costed month's net and a null month's net as dash", () => {
  const report = buildMonthlyVariance(summary);
  const rows = report.sections.find((s) => s.key === "by_month").rows;
  expect(rows[0].net_profit).toBe("₹12,000");
  expect(rows[1].net_profit).toBe("—");
  expect(rows[1].net_margin).toBe("—");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx react-scripts test --watchAll=false src/services/reporting/profitabilityReports.test.js`
Expected: FAIL — `Net Profit` not in columns (current builder has no net columns).

- [ ] **Step 3: Implement — add net columns to `buildMonthlyVariance`**

In `src/services/reporting/profitabilityReports.js`, the `buildMonthlyVariance` `by_month` section currently is:

```javascript
      { key: "by_month", title: "By month",
        columns: [{ key: "month", label: "Month" }, { key: "revenue", label: "Revenue", align: "right" }, { key: "gross_profit", label: "Gross Profit", align: "right" }, { key: "contribution", label: "Contribution", align: "right" }, { key: "gm", label: "GM %", align: "right" }],
        rows },
```

Replace the `columns` array and the `rows` mapping so net fields are included. Change the `rows` builder (defined a few lines above as `const rows = (summary?.by_month || []).map(...)`) to:

```javascript
  const rows = (summary?.by_month || []).map((m) => ({
    month: m.month, revenue: inr(m.revenue), gross_profit: inr(m.gross_profit),
    contribution: m.contribution != null ? inr(m.contribution) : "—", gm: pct(m.gm_pct),
    net_profit: m.net_profit != null ? inr(m.net_profit) : "—",
    net_margin: pct(m.net_margin),
  }));
```

And the section's `columns`:

```javascript
      { key: "by_month", title: "By month",
        columns: [{ key: "month", label: "Month" }, { key: "revenue", label: "Revenue", align: "right" }, { key: "gross_profit", label: "Gross Profit", align: "right" }, { key: "contribution", label: "Contribution", align: "right" }, { key: "gm", label: "GM %", align: "right" }, { key: "net_profit", label: "Net Profit", align: "right" }, { key: "net_margin", label: "Net %", align: "right" }],
        rows },
```

Note: `inr` and `pct` are the existing helpers at the top of the file (`pct` already returns "—" for null, so `net_margin` null renders "—" automatically).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx react-scripts test --watchAll=false src/services/reporting/profitabilityReports.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/reporting/profitabilityReports.js src/services/reporting/profitabilityReports.test.js
git commit -m "feat(profitability): Net Profit/Net % columns in the Monthly report"
```

---

### Task 3: Add Net Profit + Net % columns to the rollup tables

**Files:**
- Modify: `src/pages/profitability/ProfitabilityCenter.js` (the `customerCols`, `productCols`, `orderCols` arrays at lines ~126-144, and add one formatter)

**Interfaces:**
- Consumes: `data.by_customer[]`, `data.by_product[]`, `data.by_order[]` rows now carry `allocated_opex` (always numeric), `net_profit` (nullable), and `net_margin` (nullable) from Task 1.
- Produces: each of the Customers, Products, and Orders tables (and their PDF/Excel/CSV exports, which derive from the same `cols`) renders an `Overhead`, `Net Profit`, and `Net %` column. The Overhead column makes the ladder (Contribution → − Overhead → Net Profit) visible inline. Null net renders as "—".

- [ ] **Step 1: Add a null-safe money formatter next to `moneyCol`**

In `ProfitabilityCenter.js`, immediately after the existing `const moneyCol = (v) => money(v);` (line ~125), add:

```javascript
  const netCol = (v) => (v == null ? "—" : money(v));
```

- [ ] **Step 2: Append Net columns to `customerCols`**

In the `customerCols` array (ends at line ~131 with `{ k: "orders", h: "Orders", align: "right" },`), insert three columns before the `orders` entry so the array becomes:

```javascript
    { k: "contribution", h: "Contribution", align: "right", fmt: moneyCol }, { k: "cm_pct", h: "CM %", align: "right", fmt: pct },
    { k: "allocated_opex", h: "Overhead", align: "right", fmt: moneyCol }, { k: "net_profit", h: "Net Profit", align: "right", bold: true, fmt: netCol }, { k: "net_margin", h: "Net %", align: "right", fmt: pct },
    { k: "orders", h: "Orders", align: "right" },
```

- [ ] **Step 3: Append Net columns to `productCols`**

In `productCols` (ends ~138 with `{ k: "qty", h: "Qty", align: "right" },`), insert before the `qty` entry:

```javascript
    { k: "contribution", h: "Contribution", align: "right", fmt: moneyCol }, { k: "cm_pct", h: "CM %", align: "right", fmt: pct },
    { k: "allocated_opex", h: "Overhead", align: "right", fmt: moneyCol }, { k: "net_profit", h: "Net Profit", align: "right", bold: true, fmt: netCol }, { k: "net_margin", h: "Net %", align: "right", fmt: pct },
    { k: "qty", h: "Qty", align: "right" },
```

- [ ] **Step 4: Append Net columns to `orderCols`**

In `orderCols` (ends ~143 with the `gm_pct` entry), append after the `gm_pct` entry:

```javascript
    { k: "gross_profit", h: "Gross Profit", align: "right", bold: true, fmt: moneyCol }, { k: "gm_pct", h: "GM %", align: "right", fmt: pct },
    { k: "allocated_opex", h: "Overhead", align: "right", fmt: moneyCol }, { k: "net_profit", h: "Net Profit", align: "right", bold: true, fmt: netCol }, { k: "net_margin", h: "Net %", align: "right", fmt: pct },
```

- [ ] **Step 5: Run the full test suite (no regressions)**

Run: `CI=true npx react-scripts test --watchAll=false`
Expected: all suites pass (the 38 existing + the new `profitabilityReports.test.js` from Task 2).

- [ ] **Step 6: Production build (compile check)**

Run: `npm run build`
Expected: `Compiled` (warnings OK, no errors). Confirms the new columns and `netCol` introduce no compile issues.

- [ ] **Step 7: Commit**

```bash
git add src/pages/profitability/ProfitabilityCenter.js
git commit -m "feat(profitability): Net Profit/Net % columns on Customers/Products/Orders tables"
```

---

## Notes for the implementer

- **Order matters:** Task 1 must land first (it produces the fields). Tasks 2 and 3 are independent of each other and both depend only on Task 1's field names (`net_profit`, `net_margin`, `allocated_opex`).
- **The `net` company block already exists** (V2.1) — do not duplicate it; this work only pushes allocation down to the per-line rollups.
- **`by_family`, `by_category`, `by_sales_exec` intentionally do NOT get net** (per spec scope — only product/customer/order/month). Leave them unchanged.
- After all three tasks: ship via `/ship` (PR) then `/land-and-deploy` (Vercel). The migration applies to the linked Supabase project as part of that flow; re-run the Step 4 reconciliation against prod after deploy.
