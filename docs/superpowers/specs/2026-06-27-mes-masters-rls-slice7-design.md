# RLS Slice 7 — Gate the MES / production masters

## Context

The shipped "Power Cord MES Phase 1" left **22 MES master/config tables on
`USING(true) WITH CHECK(true)` RLS stubs** — any authenticated user can read and
write them via PostgREST, bypassing the app's `production` module gate. This is the
production-domain equivalent of the legacy-sheet hole closed in Slices 1–6, and was
flagged as a must-fix in `POWERCORD_MES_BLUEPRINT.md` ("RLS is `USING(true)` stubs …
role-scoped RLS").

**Worse than module-only: these tables also leak to ANON.** Their `<table>_all FOR ALL
USING(true)` policies were created `TO public` (the default role), which includes the
unauthenticated `anon` role — verified live: anon gets HTTP 200 on `ppc_machines`,
`assembly_operation`, `molding_master`, `ppc_wo`. Slice 5 missed them because it only
rewrote policies literally named `"Allow all anon"`. So Slice 7 also closes an anon leak:
each gated policy is `TO authenticated`, and we add `REVOKE ALL … FROM anon` per table
(defense-in-depth, as Slice 5 did). (Broader follow-up: audit for any other `TO public`
`USING(true)` policies under non-`"Allow all anon"` names that Slice 5 likewise missed.)

(The other flagged Phase-1 bug — `product.ppc_item_id` not unique → non-deterministic
routing resolver — is **already fixed and live** on prod via
`20260624240000_mes_jobcard_capture.sql:12` (`CREATE UNIQUE INDEX uq_product_ppc_item`).
No action needed.)

Goal: gate these 22 tables to the `production` module using the established pattern
(`is_super_admin() OR rbac_employee_can('<module>','<action>')`), without breaking the
shop-floor RPC flows or the cross-module screens that write product-engineering config.

## Design

One idempotent migration: `supabase/migrations/20260628140000_rls_harden_mes_masters.sql`,
reusing the Slice 6 structure exactly — a `DO $$ … FOREACH SLICE 1 IN ARRAY …` loop over
`[table, write_rule]` with a `pg_class.relkind` guard (only ordinary tables `r`/`p`;
skip any view and `RAISE NOTICE`), `DROP POLICY IF EXISTS` for idempotency, replacing
each `<table>_all` stub with `<table>_read` + `<table>_write`.

**Reads: broad for all** — `FOR SELECT TO authenticated USING (true)`. These are
operational/reference data read across production dashboards, capacity planners, the
sales-order wizard, and dispatch; none hold PII. Matches the Slice 4 (inventory) decision.

**Writes — three groups:**

1. **`production.edit`** (19 tables): `ppc_items`, `ppc_bom`, `ppc_stock`, `ppc_lines`,
   `ppc_machines`, `ppc_wo`, `ppc_wo_stage`, `ppc_wo_material`, `ppc_wo_qc`,
   `assembly_operation`, `molding_master`, `packing_master`, `shift_master`, `department`,
   `workstation`, `daily_production_plan`, `downtime_reason`, `defect_code`,
   `stage_execution_log`.
   Write clause: `USING/CHECK (is_super_admin() OR rbac_employee_can('production','edit'))`.
   The shop-floor write paths (`ppc_create_work_order`, `ppc_advance_stage`,
   `ppc_issue_material`, `ppc_post_jobcard`) are SECURITY DEFINER and bypass RLS, so
   operator/WO flows are unaffected. `assembly_operation` is written directly only from
   production screens (`AssemblyOperationMaster` via `mesService.js`).

2. **`production.edit OR sales.edit OR npd.edit`** (2 tables): `assembly_side_config`,
   `product_quality_plan`.
   These product-engineering config tables are written **directly by the app** from
   `/product-master` (SALES, `ProductMaster.js` → `plmProductService.js`) and `/npd`
   (NPD, `NPDProject.js`). Gating to `production` alone would break those editors —
   the "definer/views bypass RLS, direct client reads/writes break" rule. The OR set
   preserves all real editors.

3. **read-only, no write policy** (1 table): `ppc_wo_status_log` — trigger-written status
   log. Keep its broad read (gate to `TO authenticated`); no write policy means only the
   trigger/definer path writes it.

### Reusable pattern references
- Mirror: `supabase/migrations/20260628120000_rls_harden_legacy_sheets_by_module.sql`
  (Slice 6 — FOREACH array + relkind guard + idempotent DROP IF EXISTS).
- Helpers (exist): `public.is_super_admin()`, `public.rbac_employee_can(module_key, action)`.
- Module key: `production` (src/config/moduleAccess.js).

## Out of scope (noted, not done here)
- Wrapping the 3 direct app writes in SECURITY DEFINER RPCs (centralized enforcement) —
  a larger change; the OR-gating above is sufficient to close the RLS hole.
- Enforcing WO transitions / the quality gate inside the RPCs (separate eng must-fix).

## Verification
1. **Idempotency:** run twice → second run a no-op; `relkind` NOTICE reports any skipped view.
2. **Policy audit:** every targeted table has exactly `<t>_read` + `<t>_write` (or read-only
   for `ppc_wo_status_log`); no surviving `<t>_all` stub.
3. **Anon regression:** anon stays `401` on these tables.
4. **Human smoke-test (prod-like):** a `production` user can still create + advance a work
   order and edit MES Setup masters; a `sales`/`npd` user can still save product config via
   Product Master / NPD; a non-production user is denied direct writes to e.g. `assembly_operation`.
5. Apply via `supabase db push` (ledger is now clean) and ship on the RLS-hardening branch.
