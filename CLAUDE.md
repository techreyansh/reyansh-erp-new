# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Reyansh ERP — an internal manufacturing ERP for a cable/power-cord/molding business. Single-page **Create React App** (React 18, JavaScript with some TypeScript) talking directly to **Supabase** (Postgres + PostgREST + Auth + Storage). There is no custom backend server; the Supabase client in the browser is the entire data layer, and authorization is enforced by Postgres RLS + RPC, not by app code.

## Commands

```bash
npm ci                # install (Node 20–22, npm >=9; see .nvmrc / package.json engines)
npm start             # dev server at http://localhost:3000
npm run build         # production build → build/ (sets CI=false so lint warnings don't fail the build)
npm run build:ci      # build WITHOUT the CI=false override (strict)
npm test              # react-scripts test (Jest + React Testing Library), interactive watch
npm test -- --watchAll=false src/path/to/File.test.js   # run a single test file once
npm test -- -t "name of test"                            # run tests matching a name
```

There is **no lint script and no Prettier config**; CRA's built-in ESLint (`react-app` preset) runs during `start`/`build` only. `.env.production` historically set `DISABLE_ESLINT_PLUGIN=true` to keep legacy warnings from failing CI builds.

Environment: copy `.env.example` → `.env.local`. Required: `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`. CRA only exposes `REACT_APP_*` vars; **restart the dev server after changing `.env`**. All env access is centralized in `src/config/env.js` (`appEnv`) — read vars there, not via `process.env` scattered around.

## Architecture

### Provider tree (src/App.js)
`ThemeModeProvider → AuthProvider → UserProvider → PermissionProvider → StepStatusProvider`. Routing is one giant `<Routes>` in `App.js` (~80 routes). Most pages are wrapped in `<ProtectedRoute>` (alias `ProtectedRouteGate`); CEO-only pages use `<CEOOnlyRoute>`. Heavy/dashboard pages are `React.lazy`-loaded; flow-step components are eagerly imported.

### Authentication & authorization (the important part)
- **Auth** (`src/context/AuthContext.js`): Supabase Auth with Google OAuth via **PKCE** (`detectSessionInUrl`, session in `localStorage`). After login it enriches the user with a role by calling RPCs `is_super_admin` and reading the `users`/`roles` tables.
- **Permissions** (`src/context/PermissionContext.js`): calls the Postgres RPC **`get_my_rbac_access`**, which returns `{ authorized, role, employee, modules[] }`. This is the source of truth for what the user can see. The app never decides authorization locally — it trusts the RPC, which is backed by RLS.
- **Route → module mapping** lives in `src/config/moduleAccess.js` (`getModuleKeyForPath`, `getRequiredActionForPath`). Module keys: `dashboard, crm, sales, production, inventory, dispatch, accounts, employees, tasks, reports, settings`. `ProtectedRoute` maps the current path to a module key and checks it against the permission list. Roles (CEO, CRM, Production Manager, Process Coordinator, QC Manager, NPD, Sales Executive, Store Manager) are documented in `ROLE_ACCESS_DOCUMENTATION.md`.

Adding a protected page = add the route in `App.js` **and** add a rule in `moduleAccess.js` so it resolves to the right module key (otherwise it defaults to `dashboard`).

### Data layer — two coexisting patterns

There is a **legacy generic table layer** and a **newer typed entity-service layer**. Both hit Supabase directly; know which one a file uses before editing.

1. **`src/lib/db.js`** (legacy, JS) — `getTableRows` / `insertTableRow` / `updateTableRowById` / `updateTableRowByKey` etc., keyed by **logical names** in the `TABLE_NAMES` map. This map exists because logical names do **not** match physical table names. Critical gotchas encoded here:
   - The clients table is physically **`clients2`**, not `clients`. Logical `CLIENT`/`clients` → `clients2`.
   - Vendors → `vendors_data`, many sheets → `*_data` suffixed tables.
   - `db.js` carries fallback logic for legacy `{sort_order, record}` JSON schema vs. flat-column schema, and table-name fallbacks. `config.useLocalStorage` is forced `false` — it always calls Supabase.

2. **`src/services/supabase/`** (newer, TS) — `createSheetEntityService(tableName)` gives typed CRUD over sheet-style tables shaped `{ id, created_at, sort_order, record jsonb }`. `record` holds the row's fields; `getAllFlattened()` merges `record` up to top level. `sheetServices` (in `sheetServicesRegistry.ts`) is a ready-made registry: one service per table in `SHEET_TABLE_NAMES` (from `types/supabase.ts`), e.g. `sheetServices.audit_log.getAllFlattened()`.

3. **`src/services/*.js`** (~40 domain services: `inventoryService`, `crmService`, `dispatchService`, `salesFlowService`, `purchaseFlowService`, `rbacService`, …) — feature-specific logic. Some call dedicated tables/RPCs directly (e.g. `inventoryService` uses `inventory_stock` + the `update_inventory_transaction` RPC); others go through `db.js`. Errors are normalized and surfaced globally via `src/lib/supabaseErrorHandler.js` (wired to a Snackbar in `App.js`).

The typed Supabase client is `src/lib/supabaseClient.ts` (`supabase`), generated DB types in `types/supabase.ts`.

### Domain modules
Sales flow and Purchase flow are multi-step workflows: each step is a component under `src/components/salesFlow/` and `src/components/purchaseFlow/steps/`, with one route per step and matching `*_data`/`*_steps_data` tables. Major feature areas under `src/components/`: `Inventory`, `molding`, `cable` (production), `dispatch`, `crm`, `ppc`, `clientDashboard`, `ceoDashboard`, `employeeDashboard`, `tasks`/`taskCompliance`, `KittingSheet`, `BillOfMaterials`, `Costing`, `DocumentLibrary`. Pages composing modules live in `src/pages/`.

### Database / migrations
SQL lives in `supabase/migrations/` (timestamped, applied in order) plus `supabase/schema.sql` and assorted top-level `*.sql` files (RBAC setup, audits, repairs). Apply via the Supabase CLI (`db push` against a linked project) or by running the migration SQL in order. RLS + the `get_my_rbac_access` / `is_super_admin` RPCs are central — schema changes that touch permissions must keep those in sync.

## Conventions & gotchas

- **MUI v7** is the component system; theming is in `src/theme/` (`buildAppTheme`) with light/dark via `ThemeModeContext`. Prefer MUI components and `sx` props over custom CSS.
- When adding a new table, register its **logical→physical name** in `db.js` `TABLE_NAMES` (and `types/supabase.ts` / `SHEET_TABLE_NAMES` if using the typed service layer). Do not assume the physical name equals the logical one.
- The repo root has **many `*.md` design/feature docs and `*.sql` scripts** (e.g. `CLIENTS_TABLE_PERMANENT_FIX.md`, `RLS_DIAGNOSIS_FIX_GUIDE.md`, `BUSINESS_MODULES_INTEGRATION_MAP.md`). These are historical/feature documentation — useful context for a specific module, but not load-bearing build files. `temp_ours.js` / `temp_theirs.js` are leftover merge artifacts, not part of the app.
- Production deploys via Vercel (`vercel.json`): SPA rewrite of everything except `/static/` to `index.html`. OAuth redirect URLs (Supabase Auth → URL Configuration) must include the deployed origin and `http://localhost:3000`. See `OAUTH_SETUP.md` / `OAUTH_TROUBLESHOOTING.md`.
