# Production Intelligence Center — Blueprint

## Thesis
The Production Log already does **upload → Gemini extract → store** well (`ProductionLogModule.js`, `extract-production-log` Edge Function, `production_hourly_log`). What it lacks is **intelligence on the data it has already captured** — once a sheet is saved, nothing reads it back. The Intelligence Center turns that one-shot capture tool into a standing decision surface. Integration audit: **~65% reuse**, ~20% extend, ~15% new.

## What already exists (reuse, don't rebuild)
- **Capture pipeline:** drag-drop upload + Excel/CSV/photo classify (`productionLogService.js`), Gemini vision + structured extract (`_shared/gemini.ts` `generateJson`), `EXTRACT_SCHEMA`/`ANALYZE_SCHEMA`, save to `production_hourly_log` + `production_log_uploads` + the `production_hourly_rollup` view.
- **Charts/UI:** `recharts` v3, the `common/kit/` set (`StatCard`, `AttentionCard`, `Panel`, `EmptyChart`, `format.js`), dashboard layout patterns (`PlantHeadDashboard.js`), `plantDashboardService` aggregation helpers.
- **AI chat pattern:** `aiCopilotService.js` (tool registry + `gatherContext` + `runTool`) — proven for the CRM copilot, adaptable to production.

## The gap (what the Center adds)
1. **KPIs / OEE** on stored data — achievement %, downtime, by-line/department/shift; OEE skeleton (Availability×Performance×Quality) where shop-floor data allows.
2. **Anomaly detection** — flag low-achievement slots, recurring downtime reasons, consecutive misses, scrap spikes. (NEW — simple thresholds first, not ML.)
3. **MIS dashboard** — the standing page reading back the data (trends, line ranking, top anomalies).
4. **Production AI chat** — "why did line 3 miss today?" via the copilot pattern pointed at production tables.
5. **NL search** — find reports by date/line/reason.

## Phasing
- **Phase 1 — Intelligence Dashboard (highest reuse, ship first):** a new `/production/intelligence` page reading `production_hourly_log` + `production_hourly_rollup`. KPI cards (achievement %, total downtime, units made vs target, top miss reason), trend charts (achievement over time, downtime by reason), line/department breakdown, and a **rule-based anomaly list** (achievement < 70%, downtime > 60 min, ≥2 consecutive misses) on `AttentionCard`s. Date-range filter. Links to the existing upload tool. No new AI, no new Edge Function — pure read + compute over data already captured. Self-contained, shippable.
- **Phase 2 — Production AI chat:** adapt `aiCopilotService` `gatherContext` to pull the last N days of production data; 6 tools (daily_summary, line_performance, anomalies, material_impact, machine_utilization, shift_comparison). New `analyze`-style Edge call reusing `_shared/gemini.ts`.
- **Phase 3 — Schema depth + persisted anomalies:** extend `EXTRACT_SCHEMA` for machine/stage/defect granularity; `production_anomalies` table so anomalies persist + trend; extraction-confidence audit columns.
- **Phase 4 — NL search + (optional) realtime** via Supabase Realtime on `production_hourly_log`.

## Key decisions
- **Reuse the existing capture path** — do NOT build a new upload/extract. The Center is the read/intelligence layer on top.
- **Anomaly detection starts rule-based**, not ML — thresholds are explainable and good enough for a small shop; revisit only if it proves valuable.
- **RBAC:** the Center lives under the existing `production` module (the Production Log is already there) — no new module key needed.
- **Phase 1 is read-only over existing data** — zero risk to capture; ships immediately.
