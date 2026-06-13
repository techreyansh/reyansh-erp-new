# Developer Onboarding — Reyansh ERP

A practical "get running and find your way around" guide for developers joining this repo.
For the deeper architecture reference, read [`CLAUDE.md`](./CLAUDE.md). For the UX direction
this codebase is moving toward, read [`ERP_UX_REDESIGN_BLUEPRINT.md`](./ERP_UX_REDESIGN_BLUEPRINT.md).

---

## 1. Run it locally

```bash
nvm use            # Node 20 (see .nvmrc); project supports Node 20–22
npm ci             # install
cp .env.example .env.local   # then fill in the two required vars below
npm start          # dev server at http://localhost:3000
```

Required env (in `.env.local`, never committed):

| Var | What |
|---|---|
| `REACT_APP_SUPABASE_URL` | Supabase project URL |
| `REACT_APP_SUPABASE_ANON_KEY` | Supabase anon key |

All env access is centralized in `src/config/env.js` (`appEnv`). Restart the dev server after editing `.env.local`.

Stack: Create React App (React 18, JS + some TS) → Supabase (Postgres + PostgREST + Auth + Storage) directly from the browser. **No custom backend server**; authorization is enforced by Postgres RLS + RPCs, not app code. MUI v7 is the component system.

---

## 2. The shared dashboard kit (use this for any new dashboard)

`src/components/common/kit/` is the single source of truth for dashboard building blocks. **Build new dashboards on it** instead of re-implementing cards/formatting.

```js
import { StatCard, Panel, AttentionCard, EmptyChart, GridBox,
         inrCompact, pct, greeting, CHART_COLORS, SEMANTIC,
         sortBySeverity } from '../common/kit';
```

- `StatCard` — KPI card (optional clickable drill-in)
- `Panel` — titled chart/content frame
- `AttentionCard` + `sortBySeverity` — the "what needs attention now" card and severity ranking
- `inrCompact` / `pct` / `CHART_COLORS` — consistent money/%/palette
- Charts use **Recharts** (already a dependency).

**Dashboard doctrine:** every dashboard leads with an *Attention Rail* — a ranked list of risks/bottlenecks, each with a one-click action — before any charts. Each screen should answer: *What happened? What's happening? What should I do next?*

Reference implementations:
- `src/components/ceoDashboard/CEOExecutiveDashboard.js` → route `/ceo-command` (CEO command center)
- `src/components/plantDashboard/PlantHeadDashboard.js` → route `/plant-command` (plant floor)
- `src/components/dashboard/Dashboard.js` → route `/dashboard` (executive, refactored onto the kit)

Their data aggregators are `src/services/executiveDashboardService.js` and `src/services/plantDashboardService.js` — each fetch is isolated and degrades to empty on a missing table / RLS denial.

Adding a protected page = add the route in `src/App.js` **and** a rule in `src/config/moduleAccess.js` so it maps to the right RBAC module (otherwise it defaults to `dashboard`).

---

## 3. Production Log module (AI sheet/photo ingestion)

Lets the team upload hourly production sheets — Excel/CSV **or photos** — and uses Claude to read, normalize, and analyze them.

- UI: `src/components/productionLog/ProductionLogModule.js` → route `/production-log`
- Client service: `src/services/productionLogService.js` (parses sheets with `xlsx`, reads photos to base64, calls the Edge Function, saves rows)
- AI backend: `supabase/functions/extract-production-log/index.ts` — a Supabase Edge Function calling **Claude `claude-opus-4-8`** with **vision** (reads photos) + **structured outputs** (returns rows matching the DB schema). The Anthropic API key lives server-side as a function secret, never in the browser.
- DB: `supabase/migrations/20260613120000_production_hourly_log.sql` — tables `production_hourly_log` (one row per line × time-slot) + `production_log_uploads`, plus a `production_hourly_rollup` view.

**Source sheets are a wide matrix** (metrics × time-slots, with each line stacked as a block). The extractor *unpivots* this into one normalized row per line × time-slot; `%` achievement and totals are derived, never stored.

### Deploying the AI backend (one-time per environment)

```bash
supabase db push                                    # apply the migration (creates the tables)
supabase functions deploy extract-production-log    # deploy the Edge Function
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # from console.anthropic.com (pay-as-you-go)
```

Or via the Supabase Dashboard: run the migration SQL in the SQL Editor, create an Edge Function named exactly `extract-production-log` and paste the code, then add `ANTHROPIC_API_KEY` under Edge Function secrets. Until the key is set, the UI shows a friendly "AI service not reachable" message — uploading/parsing still works; only AI extraction/analysis is gated.

---

## 4. Data layer — know which pattern a file uses

Two coexisting patterns hit Supabase directly:

1. **`src/lib/db.js`** (legacy, JS) — generic table CRUD keyed by **logical names** in `TABLE_NAMES`. Logical ≠ physical: clients table is physically **`clients2`**, vendors → `vendors_data`, many sheets → `*_data`.
2. **`src/services/supabase/`** (newer, TS) — `createSheetEntityService(table)` for sheet-style tables shaped `{ id, created_at, sort_order, record jsonb }`; `sheetServices` registry exposes one per table.
3. **`src/services/*.js`** (~40 domain services) — feature logic (inventory, crm, dispatch, salesFlow, rbac…).

When adding a table, register its logical→physical name in `db.js` `TABLE_NAMES` (and `types/supabase.ts` if using the typed layer).

---

## 5. Auth & RBAC (the load-bearing part)

- Auth: `src/context/AuthContext.js` — Supabase Auth, Google OAuth (PKCE).
- Permissions: `src/context/PermissionContext.js` calls RPC **`get_my_rbac_access`** → `{ authorized, role, employee, modules[] }`. The app trusts this; it never decides authorization locally.
- Route → module mapping: `src/config/moduleAccess.js`. Module keys: `dashboard, crm, sales, production, inventory, dispatch, accounts, employees, tasks, reports, settings`.

---

## 6. Commands

```bash
npm start                  # dev server
npm run build              # production build (CI=false so lint warnings don't fail)
npm test                   # Jest + React Testing Library (watch)
npm test -- --watchAll=false src/path/File.test.js   # single file
```

No lint/Prettier script — CRA's built-in ESLint (`react-app`) runs during start/build only. The repo has many `*.md` design docs and `*.sql` scripts at root; they're historical/feature context, not build files. `temp_ours.js` / `temp_theirs.js` are leftover merge artifacts.

---

## 7. Where to contribute next (from the redesign blueprint)

- **Sales dashboard** — pipeline, follow-ups due, quotes pending, conversion, leaderboard, inactivity alerts (build on the kit).
- **Quality module** — currently mock/TODO (`QualityCheck.js`, `InspectSample.js`); needs inspection → NCR → CAPA + a QC dashboard.
- **Kill the data-entry tax** — a `FlowContext` so Sales (11 steps) / Purchase (21 steps) flows inherit data instead of re-typing customer/product/supplier.
- **Wire Production Log → Plant Head dashboard** — feed saved `production_hourly_log` rows into the live production-vs-target view.
