// Auto Planner — drives the ported cable-planner engine inside the ERP.
// Loads cables + production plans from the existing sheets, auto-schedules jobs
// across the 4 machines (bunching→core→laying→sheathing), shows a Gantt + table,
// and saves the generated jobs to the Machine Schedules sheet.
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box, Paper, Stack, Typography, Button, Chip, CircularProgress, Snackbar, Alert,
  TextField, MenuItem, FormControlLabel, Switch, Table, TableHead, TableRow,
  TableCell, TableBody, Tooltip, alpha, useTheme,
  Dialog, DialogTitle, DialogContent, DialogActions, Link,
} from "@mui/material";
import {
  PlayArrowRounded, SaveRounded, RefreshRounded, AutoAwesomeRounded, WarningAmberRounded,
  UploadFileRounded, Inventory2Rounded,
} from "@mui/icons-material";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ReferenceLine,
} from "recharts";
import sheetService from "../../services/sheetService";
import { supabase } from "../../lib/supabaseClient";
import {
  runAutoSchedule, sumRM, DEFAULT_MACHINES, STAGE_LABEL,
  loadHeatmap, orderRiskWatchlist, rmBurndown,
} from "../../services/cablePlanner";
import { rowToCable, rowToOrder, jobToScheduleRow } from "../../services/cablePlanner/erpAdapter";
import { loadEngineMachines } from "../../services/cableProductionService";
import { listRows } from "../../services/refMasterService";

// Categorical stage-identity palette (one distinct hue per production stage) — data/legend colors, kept literal so stages stay visually distinguishable.
const STAGE_COLOR = { bunching: "#6366f1", core: "#0ea5e9", laying: "#f59e0b", sheathing: "#10b981" };
const RISK_COLOR = (theme) => ({ critical: theme.palette.error.main, warn: theme.palette.warning.main, watch: theme.palette.info.main, ok: theme.palette.success.main });
const kg = (v) => `${(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
const m = (v) => `${(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} m`;
const fmtDT = (iso) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const todayStr = () => new Date().toISOString().slice(0, 10);
const dueLabel = (due) => {
  if (!due) return "no due date";
  const d = Math.floor((new Date(due).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `due in ${d}d`;
};
const loadColor = (pct, theme) => (pct > 100 ? theme.palette.error.main : pct > 75 ? theme.palette.warning.main : pct > 25 ? theme.palette.success.main : pct > 0 ? theme.palette.success.light : "transparent");
const RM_STOCK_KEY = "reyansh_cable_rm_stock_v1";
// Engine RM keys → on-hand stock keys + labels, for the shortage view.
const RM_ROWS = [
  { key: "copper", stockKey: "copperKg", label: "Copper" },
  { key: "ins", stockKey: "pvcInsKg", label: "PVC Insulation" },
  { key: "sh", stockKey: "pvcShKg", label: "PVC Sheath" },
];

export default function CableAutoPlanner() {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [cables, setCables] = useState([]);
  const [orders, setOrders] = useState([]);
  // Machine Master (ppc_machines) → engine machines; DEFAULT_MACHINES until loaded.
  const [machines, setMachines] = useState(DEFAULT_MACHINES);
  // Planning presets (named option sets) the planner can apply in one click.
  const [presets, setPresets] = useState([]);
  const [presetId, setPresetId] = useState("");
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState(null);
  const [opts, setOpts] = useState({
    startDate: todayStr(), mode: "forward", priority: "due_date",
    scope: "pending", batching: false, batchWindow: 7, checkStock: "warn",
  });
  // On-hand raw material (kg). Persisted locally so it survives reloads; feeds
  // the scheduler's stock check + the shortage view.
  const [stock, setStock] = useState(() => {
    try { return { copperKg: 0, pvcInsKg: 0, pvcShKg: 0, ...(JSON.parse(localStorage.getItem(RM_STOCK_KEY) || "{}")) }; }
    catch { return { copperKg: 0, pvcInsKg: 0, pvcShKg: 0 }; }
  });
  useEffect(() => { try { localStorage.setItem(RM_STOCK_KEY, JSON.stringify(stock)); } catch { /* ignore */ } }, [stock]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [importing, setImporting] = useState(false);
  const [loadingInv, setLoadingInv] = useState(false);

  const notify = (message, severity = "success") => setSnack({ message, severity });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cp, plans, eng] = await Promise.all([
        sheetService.getSheetData("Cable Products"),
        sheetService.getSheetData("Cable Production Plans"),
        loadEngineMachines(),
      ]);
      setCables((cp || []).map(rowToCable).filter((c) => c.code));
      setOrders((plans || []).map(rowToOrder).filter((o) => o.cableId && o.qtyM > 0));
      if (Array.isArray(eng) && eng.length) setMachines(eng);
    } catch (e) {
      notify(`Failed to load data: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { listRows("planning_preset", "code").then((r) => setPresets((r || []).filter((p) => !p.archived_at))).catch(() => {}); }, []);

  // Apply a named preset to the planning options (engine unchanged).
  const applyPreset = (id) => {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setOpts((o) => ({ ...o, priority: p.priority || o.priority, mode: p.mode || o.mode, batching: !!p.batching, batchWindow: p.batch_window || o.batchWindow, checkStock: p.check_stock || o.checkStock, scope: p.scope || o.scope }));
  };

  const cablesById = useMemo(() => Object.fromEntries(cables.map((c) => [c.id, c])), [cables]);

  const run = () => {
    if (!orders.length) { notify("No production plans with a quantity to schedule", "warning"); return; }
    try {
      const res = runAutoSchedule({
        cables, machines, speeds: [], orders,
        options: { ...opts, stock, startDate: new Date(`${opts.startDate}T09:00:00`) },
      });
      setResult(res);
      if (res.blocked) notify("Blocked: insufficient RM stock (see shortfalls).", "warning");
      else notify(`Scheduled ${res.schedule.length} jobs across ${res.plannedOrderIds.length} orders`, "success");
    } catch (e) {
      notify(`Scheduler error: ${e.message}`, "error");
    }
  };

  const save = async () => {
    if (!result?.schedule?.length) return;
    setSaving(true);
    try {
      const rows = result.schedule.map((j) => {
        const order = orders.find((o) => o.id === j.orderId);
        return jobToScheduleRow(j, cablesById[j.cableId], order);
      });
      await sheetService.batchAppendRows("Machine Schedules", rows);
      notify(`Saved ${rows.length} jobs to Machine Schedules`);
    } catch (e) {
      notify(`Save failed: ${e.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  // Drag-to-reschedule: move one job to a new start (duration preserved), mark it
  // manually moved. Save persists the adjusted times to Machine Schedules.
  const reschedule = useCallback((jobId, startISO, endISO) => {
    setResult((r) => {
      if (!r) return r;
      const schedule = r.schedule.map((j) =>
        j.id === jobId ? { ...j, startTime: startISO, endTime: endISO, manuallyMoved: true } : j);
      return { ...r, schedule };
    });
    setSnack({ message: "Job rescheduled — Save to persist", severity: "info" });
  }, []);

  const materials = useMemo(() => {
    if (!result) return null;
    const items = result.plannedOrderIds
      .map((id) => orders.find((o) => o.id === id))
      .filter(Boolean)
      .map((o) => ({ cable: cablesById[o.cableId] || {}, qtyMeters: o.qtyM }));
    return sumRM(items);
  }, [result, orders, cablesById]);

  // Decision support: who's at risk, where's the bottleneck.
  const watchlist = useMemo(() => orderRiskWatchlist(orders, result?.schedule || []), [orders, result]);
  const heatmap = useMemo(() => (result ? loadHeatmap(machines, result.schedule, 14) : []), [result, machines]);
  const hasStock = stock.copperKg > 0 || stock.pvcInsKg > 0 || stock.pvcShKg > 0;
  const burndown = useMemo(
    () => (result?.schedule?.length && hasStock ? rmBurndown(result.schedule, cablesById, stock, 30) : null),
    [result, cablesById, stock, hasStock],
  );

  // Bulk paste-import → append rows to the Cable Production Plans sheet.
  // Accepts CSV "Customer, Code, Qty, Due" or power-cord "Customer, Code, 5000x1.5, Due".
  const parsePlanLines = (text) => {
    const rows = [];
    for (const raw of (text || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || /^customer/i.test(line)) continue; // skip blanks + header
      const parts = line.split(/[\t,;]/).map((s) => s.trim());
      if (parts.length < 3) continue;
      const [customer, code, qtyRaw, dueRaw] = parts;
      let quantity = 0, length = 1, totalMeters = 0;
      const cordMatch = String(qtyRaw).match(/^([\d.]+)\s*[xX]\s*([\d.]+)$/); // pcs x len
      if (cordMatch) { quantity = +cordMatch[1]; length = +cordMatch[2]; totalMeters = quantity * length; }
      else { totalMeters = Number(String(qtyRaw).replace(/[^\d.]/g, "")) || 0; quantity = totalMeters; }
      if (!code || totalMeters <= 0) continue;
      rows.push({
        customerName: customer || "", productCode: code, totalMeters, quantity, length,
        dueDate: (dueRaw || "").slice(0, 10), priority: "normal", status: "pending",
      });
    }
    return rows;
  };

  const doImport = async () => {
    const rows = parsePlanLines(pasteText);
    if (!rows.length) { notify("No valid lines found. Use: Customer, Code, Qty, Due", "warning"); return; }
    setImporting(true);
    try {
      await sheetService.batchAppendRows("Cable Production Plans", rows);
      setPasteOpen(false); setPasteText("");
      notify(`Imported ${rows.length} production plan(s)`);
      await load();
    } catch (e) {
      notify(`Import failed: ${e.message}`, "error");
    } finally { setImporting(false); }
  };

  // Best-effort: read on-hand from real inventory and classify RM into the 3
  // buckets by item name/code. Prefills the editable fields (stays manual-overridable).
  const loadFromInventory = async () => {
    setLoadingInv(true);
    try {
      const { data, error } = await supabase
        .from("inventory_stock")
        .select("quantity, products(name, code, description)");
      if (error) throw error;
      const buckets = { copperKg: 0, pvcInsKg: 0, pvcShKg: 0 };
      let matched = 0;
      for (const row of data || []) {
        const p = row.products || {};
        const hay = `${p.name || ""} ${p.code || ""} ${p.description || ""}`.toLowerCase();
        const qty = Number(row.quantity) || 0;
        if (/copper|conductor|wire ?rod|\bcu\b/.test(hay)) { buckets.copperKg += qty; matched++; }
        else if (/insulat|type[\s-]?a|ins(\b|ulation)/.test(hay)) { buckets.pvcInsKg += qty; matched++; }
        else if (/sheath|jacket|st1|st2|outer/.test(hay)) { buckets.pvcShKg += qty; matched++; }
      }
      setStock(buckets);
      notify(matched ? `Loaded on-hand from inventory (${matched} item(s) matched)` : "No copper/PVC items matched in inventory — enter manually", matched ? "success" : "warning");
    } catch (e) {
      notify(`Inventory read failed: ${e.message}`, "error");
    } finally { setLoadingInv(false); }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      {/* CONTROLS */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <AutoAwesomeRounded color="primary" />
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Auto Planner</Typography>
          <Chip size="small" variant="outlined" label={`${cables.length} cables · ${orders.length} plans`} />
          <Box sx={{ flex: 1 }} />
          <Button size="small" startIcon={<UploadFileRounded />} onClick={() => setPasteOpen(true)} sx={{ textTransform: "none" }}>Import plans</Button>
          <Button size="small" startIcon={<RefreshRounded />} onClick={load} sx={{ textTransform: "none" }}>Reload</Button>
        </Stack>

        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
          {presets.length > 0 && (
            <TextField select size="small" label="Preset" value={presetId} onChange={(e) => applyPreset(e.target.value)} sx={{ width: 210 }}
              helperText="Apply a saved planning preset">
              <MenuItem value="">— none —</MenuItem>
              {presets.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </TextField>
          )}
          <TextField size="small" type="date" label="Plan start" InputLabelProps={{ shrink: true }}
            value={opts.startDate} onChange={(e) => setOpts({ ...opts, startDate: e.target.value })} sx={{ width: 160 }} />
          <TextField select size="small" label="Mode" value={opts.mode} onChange={(e) => setOpts({ ...opts, mode: e.target.value })} sx={{ width: 150 }}>
            <MenuItem value="forward">Forward fill</MenuItem>
            <MenuItem value="reverse">Reverse (from due)</MenuItem>
          </TextField>
          <TextField select size="small" label="Priority" value={opts.priority} onChange={(e) => setOpts({ ...opts, priority: e.target.value })} sx={{ width: 150 }}>
            <MenuItem value="due_date">Due date</MenuItem>
            <MenuItem value="manual">Priority flag</MenuItem>
            <MenuItem value="created">Created order</MenuItem>
          </TextField>
          <TextField select size="small" label="Scope" value={opts.scope} onChange={(e) => setOpts({ ...opts, scope: e.target.value })} sx={{ width: 150 }}>
            <MenuItem value="pending">Pending only</MenuItem>
            <MenuItem value="all">All open</MenuItem>
          </TextField>
          <TextField select size="small" label="Stock check" value={opts.checkStock} onChange={(e) => setOpts({ ...opts, checkStock: e.target.value })} sx={{ width: 150 }}>
            <MenuItem value="skip">Ignore stock</MenuItem>
            <MenuItem value="warn">Warn on short</MenuItem>
            <MenuItem value="block">Block on short</MenuItem>
          </TextField>
          <FormControlLabel control={<Switch checked={opts.batching} onChange={(e) => setOpts({ ...opts, batching: e.target.checked })} />} label="Batch similar specs" />
          <Button variant="contained" startIcon={<PlayArrowRounded />} onClick={run} disabled={loading} sx={{ textTransform: "none" }}>
            Run auto-schedule
          </Button>
          {result?.schedule?.length > 0 && (
            <Button variant="outlined" startIcon={<SaveRounded />} onClick={save} disabled={saving} sx={{ textTransform: "none" }}>
              {saving ? "Saving…" : "Save to Machine Schedules"}
            </Button>
          )}
        </Stack>

        {opts.checkStock !== "skip" && (
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mt: 1.5, pt: 1.5, borderTop: "1px dashed", borderColor: "divider" }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary" }}>On-hand RM (kg):</Typography>
            {RM_ROWS.map((r) => (
              <TextField key={r.key} size="small" type="number" label={r.label} value={stock[r.stockKey]}
                onChange={(e) => setStock({ ...stock, [r.stockKey]: Number(e.target.value) || 0 })} sx={{ width: 150 }} />
            ))}
            <Button size="small" variant="outlined" startIcon={loadingInv ? <CircularProgress size={14} /> : <Inventory2Rounded />}
              onClick={loadFromInventory} disabled={loadingInv} sx={{ textTransform: "none" }}>
              Load from inventory
            </Button>
          </Stack>
        )}
      </Paper>

      {/* ORDER RISK WATCHLIST — surfaces what needs attention even before planning */}
      {!loading && watchlist.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <WarningAmberRounded fontSize="small" color="warning" />
            <Typography variant="overline" sx={{ fontWeight: 800, color: "text.secondary" }}>
              Order risk watchlist ({watchlist.length})
            </Typography>
          </Stack>
          <Stack spacing={0.75}>
            {watchlist.slice(0, 8).map(({ order, level }) => (
              <Stack key={order.id} direction="row" alignItems="center" spacing={1.5}
                sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: alpha(RISK_COLOR(theme)[level], 0.08) }}>
                <Chip size="small" label={level} sx={{ bgcolor: RISK_COLOR(theme)[level], color: "common.white", fontWeight: 700, height: 20, textTransform: "capitalize" }} />
                <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 90 }}>{order.orderNo || order.id}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }} noWrap>
                  {order.customer || "—"} · {cablesById[order.cableId]?.code || order.cableId} · {m(order.qtyM)}
                </Typography>
                <Typography variant="caption" sx={{ color: RISK_COLOR(theme)[level], fontWeight: 700 }}>
                  {dueLabel(order.dueDate)}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress /></Box>
      ) : !result ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: "center", borderRadius: 2.5 }}>
          <Typography color="text.secondary">
            Loads your Cable Products + Production Plans, then schedules every stage across the 4 machines.
            Click <b>Run auto-schedule</b>.
          </Typography>
        </Paper>
      ) : (
        <>
          {/* SUMMARY */}
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            <SummaryCard label="Jobs scheduled" value={result.schedule.length} />
            <SummaryCard label="Orders planned" value={result.plannedOrderIds.length} />
            <SummaryCard label="Copper RM" value={kg(materials?.copper)} />
            <SummaryCard label="PVC insulation" value={kg(materials?.ins)} />
            <SummaryCard label="PVC sheath" value={kg(materials?.sh)} />
            <SummaryCard label="Missed due" value={result.missedDue.length} warn={result.missedDue.length > 0} />
          </Stack>

          {result.missedDue.length > 0 && (
            <Alert severity="warning" icon={<WarningAmberRounded />} sx={{ mb: 2 }}>
              {result.missedDue.length} order(s) finish after their due date: {result.missedDue.map((d) => d.orderNo || d.orderId).join(", ")}
            </Alert>
          )}

          {/* RM SHORTAGE — required (this plan) vs on-hand */}
          {opts.checkStock !== "skip" && result.stock && (
            <Paper variant="outlined" sx={{ borderRadius: 2.5, mb: 2, overflow: "hidden" }}>
              <Box sx={{ px: 2, py: 1.25 }}>
                <Typography variant="overline" sx={{ fontWeight: 800, color: "text.secondary" }}>Raw material — required vs on-hand</Typography>
              </Box>
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>{["Material", "Required", "On-hand", "Balance", "Status"].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow>
                  </TableHead>
                  <TableBody>
                    {RM_ROWS.map((r) => {
                      const required = result.stock.required?.[r.key] || 0;
                      const onHand = stock[r.stockKey] || 0;
                      const bal = onHand - required;
                      const level = bal < 0 ? "short" : bal < required * 0.2 ? "low" : "ok";
                      const color = level === "short" ? theme.palette.error.main : level === "low" ? theme.palette.warning.main : theme.palette.success.main;
                      return (
                        <TableRow key={r.key} hover>
                          <TableCell sx={{ fontWeight: 600 }}>{r.label}</TableCell>
                          <TableCell>{kg(required)}</TableCell>
                          <TableCell>{kg(onHand)}</TableCell>
                          <TableCell sx={{ color, fontWeight: 700 }}>{bal < 0 ? `-${kg(Math.abs(bal))}` : kg(bal)}</TableCell>
                          <TableCell><Chip size="small" label={level === "short" ? "SHORT" : level === "low" ? "LOW" : "OK"} sx={{ bgcolor: alpha(color, 0.15), color, fontWeight: 700 }} /></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Box>
            </Paper>
          )}

          {/* RM BURN-DOWN — projected on-hand over 30 days */}
          {burndown && (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Typography variant="overline" sx={{ fontWeight: 800, color: "text.secondary" }}>RM burn-down (30 days)</Typography>
                {burndown.shortageDay != null && (
                  <Chip size="small" color="error" label={`Shortage in ${burndown.shortageDay}d · reorder by day ${burndown.reorderDay}`} />
                )}
              </Stack>
              <Box sx={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={burndown.series} margin={{ top: 5, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={alpha(theme.palette.text.primary, 0.08)} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} interval={4} />
                    <YAxis tick={{ fontSize: 10 }} width={48} />
                    <RTooltip formatter={(v) => `${v} kg`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={0} stroke={theme.palette.error.main} strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="copper" name="Copper" stroke="#b45309" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="ins" name="PVC Ins" stroke="#0ea5e9" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="sh" name="PVC Sheath" stroke="#10b981" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            </Paper>
          )}

          {/* MACHINE LOAD HEATMAP */}
          <Heatmap heatmap={heatmap} theme={theme} />

          {/* GANTT */}
          <Gantt schedule={result.schedule} machines={machines} theme={theme} onReschedule={reschedule} />

          {/* TABLE */}
          <Paper variant="outlined" sx={{ borderRadius: 2.5, mt: 2, overflow: "hidden" }}>
            <Box sx={{ px: 2, py: 1.25 }}>
              <Typography variant="overline" sx={{ fontWeight: 800, color: "text.secondary" }}>Scheduled jobs</Typography>
            </Box>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {["Order", "Cable", "Stage", "Machine", "Core", "Planned", "Start", "End", "Hrs"].map((h) => (
                      <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.schedule.map((j) => {
                    const order = orders.find((o) => o.id === j.orderId);
                    return (
                      <TableRow key={j.id} hover>
                        <TableCell>{order?.orderNo || j.orderId}</TableCell>
                        <TableCell>{cablesById[j.cableId]?.code || j.cableId}</TableCell>
                        <TableCell><Chip size="small" label={STAGE_LABEL[j.stage]} sx={{ bgcolor: alpha(STAGE_COLOR[j.stage], 0.15), color: STAGE_COLOR[j.stage], fontWeight: 700 }} /></TableCell>
                        <TableCell>{j.machineId}</TableCell>
                        <TableCell>{j.coreColor ? `${j.coreIndex}/${j.coreOfTotal} ${j.coreColor}` : "—"}</TableCell>
                        <TableCell>{m(j.plannedM)}</TableCell>
                        <TableCell>{fmtDT(j.startTime)}</TableCell>
                        <TableCell>{fmtDT(j.endTime)}</TableCell>
                        <TableCell>{j.plannedHrs.toFixed(1)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        </>
      )}

      {/* BULK PASTE IMPORT */}
      <Dialog open={pasteOpen} onClose={() => setPasteOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>Import production plans</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Paste one order per line. Format: <code>Customer, Cable Code, Qty, Due (YYYY-MM-DD)</code>.
            For power cords use <code>pieces×length</code> as the quantity, e.g. <code>Havells, PC-16A-15, 5000×1.5, 2026-07-10</code>.
          </Typography>
          <TextField
            multiline minRows={6} fullWidth autoFocus value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"BluStar, R3C25, 5000, 2026-07-05\nHavells, PC-16A-15, 5000×1.5, 2026-07-10"}
            sx={{ fontFamily: "monospace" }}
          />
          <Typography variant="caption" color="text.secondary">
            New cable codes should exist in <Link href="/cable-production" underline="hover">Cable Products</Link> for scheduling to pick them up.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasteOpen(false)} sx={{ textTransform: "none" }}>Cancel</Button>
          <Button variant="contained" onClick={doImport} disabled={importing} startIcon={importing ? <CircularProgress size={16} /> : <UploadFileRounded />} sx={{ textTransform: "none" }}>
            {importing ? "Importing…" : "Import"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={5000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}

function SummaryCard({ label, value, warn }) {
  return (
    <Paper variant="outlined" sx={{ px: 2, py: 1.25, borderRadius: 2, minWidth: 120, borderColor: warn ? "warning.main" : "divider" }}>
      <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1, color: warn ? "warning.main" : "text.primary" }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Paper>
  );
}

// 14-day machine-load heatmap: one row per machine, a cell per day shaded by % load.
function Heatmap({ heatmap, theme }) {
  if (!heatmap.length) return null;
  const labels = heatmap[0].days;
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 2, overflow: "hidden" }}>
      <Typography variant="overline" sx={{ fontWeight: 800, color: "text.secondary" }}>Machine load (next 14 days)</Typography>
      <Box sx={{ overflowX: "auto", mt: 1 }}>
        <Box sx={{ minWidth: 720 }}>
          <Box sx={{ display: "flex", pl: "120px", mb: 0.5 }}>
            {labels.map((d, i) => (
              <Box key={i} sx={{ flex: 1, fontSize: 10, textAlign: "center", color: new Date(d.date + "T00:00:00").getDay() === 0 ? "error.main" : "text.secondary" }}>
                {new Date(d.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit" })}
              </Box>
            ))}
          </Box>
          {heatmap.map(({ machine, days }) => (
            <Box key={machine.id} sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
              <Box sx={{ width: 120, flexShrink: 0, fontSize: 12, fontWeight: 700 }}>{machine.name}</Box>
              {days.map((d, i) => (
                <Tooltip key={i} title={`${d.date}: ${d.hrs}h / ${d.capacity}h (${d.pct}%)`}>
                  <Box sx={{
                    flex: 1, height: 22, mx: "1px", borderRadius: 0.5,
                    bgcolor: d.capacity === 0 ? alpha(theme.palette.text.primary, 0.04) : loadColor(d.pct, theme),
                    border: d.capacity === 0 ? "none" : `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700,
                    color: d.pct > 75 ? "common.white" : "text.secondary",
                  }}>
                    {d.pct > 0 ? `${d.pct}` : ""}
                  </Box>
                </Tooltip>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    </Paper>
  );
}

// Compact 7-day Gantt: one row per machine, bars positioned across the window.
// Bars are draggable horizontally to reschedule (onReschedule(jobId, startISO,
// endISO)); duration is preserved and the new start snaps to 15 minutes.
const SNAP_MS = 15 * 60000;
function Gantt({ schedule, machines, theme, onReschedule }) {
  const [drag, setDrag] = useState(null); // { id, startX, trackW, leftPct, widthPct, previewLeftPct, origStartMs, durMs }
  if (!schedule.length) return null;
  const starts = schedule.map((j) => new Date(j.startTime).getTime());
  const ends = schedule.map((j) => new Date(j.endTime).getTime());
  const min = Math.min(...starts);
  const max = Math.max(Math.max(...ends), min + 7 * 86400000);
  const span = max - min || 1;
  const days = [];
  for (let t = min; t <= max; t += 86400000) days.push(new Date(t));

  const onDown = (e, j, left, width) => {
    if (!onReschedule) return;
    e.preventDefault();
    const track = e.currentTarget.parentElement.getBoundingClientRect();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    setDrag({
      id: j.id, startX: e.clientX, trackW: track.width || 1, leftPct: left, widthPct: width,
      previewLeftPct: left, origStartMs: new Date(j.startTime).getTime(),
      durMs: new Date(j.endTime).getTime() - new Date(j.startTime).getTime(),
    });
  };
  const onMove = (e, jid) => {
    if (!drag || drag.id !== jid) return;
    const dPct = ((e.clientX - drag.startX) / drag.trackW) * 100;
    const previewLeftPct = Math.max(0, Math.min(100 - drag.widthPct, drag.leftPct + dPct));
    setDrag((d) => (d ? { ...d, previewLeftPct } : d));
  };
  const onUp = (e, j) => {
    if (!drag || drag.id !== j.id) { setDrag(null); return; }
    const deltaMs = ((drag.previewLeftPct - drag.leftPct) / 100) * span;
    setDrag(null);
    if (Math.abs(deltaMs) < 60000) return; // ignore <1min nudges / plain clicks
    const newStart = Math.round((drag.origStartMs + deltaMs) / SNAP_MS) * SNAP_MS;
    onReschedule(j.id, new Date(newStart).toISOString(), new Date(newStart + drag.durMs).toISOString());
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, overflow: "hidden" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="overline" sx={{ fontWeight: 800, color: "text.secondary" }}>Timeline (Gantt)</Typography>
        {onReschedule && <Typography variant="caption" color="text.secondary">Drag a bar to reschedule · Save to persist</Typography>}
      </Stack>
      <Box sx={{ overflowX: "auto", mt: 1 }}>
        <Box sx={{ minWidth: 720 }}>
          {/* day axis */}
          <Box sx={{ display: "flex", pl: "120px", borderBottom: "1px solid", borderColor: "divider", pb: 0.5, mb: 0.5 }}>
            {days.map((d, i) => (
              <Box key={i} sx={{ flex: 1, fontSize: 11, color: d.getDay() === 0 ? "error.main" : "text.secondary", fontWeight: 600 }}>
                {d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
              </Box>
            ))}
          </Box>
          {machines.map((mac) => {
            const jobs = schedule.filter((j) => j.machineId === mac.id);
            return (
              <Box key={mac.id} sx={{ display: "flex", alignItems: "center", height: 34, position: "relative" }}>
                <Box sx={{ width: 120, flexShrink: 0, fontSize: 12, fontWeight: 700 }}>{mac.name}</Box>
                <Box sx={{ position: "relative", flex: 1, height: 26, bgcolor: alpha(theme.palette.text.primary, 0.03), borderRadius: 1 }}>
                  {jobs.map((j) => {
                    const baseLeft = ((new Date(j.startTime).getTime() - min) / span) * 100;
                    const width = Math.max(((new Date(j.endTime).getTime() - new Date(j.startTime).getTime()) / span) * 100, 0.5);
                    const dragging = drag && drag.id === j.id;
                    const left = dragging ? drag.previewLeftPct : baseLeft;
                    return (
                      <Tooltip key={j.id} title={dragging ? "" : `${STAGE_LABEL[j.stage]} · ${j.cableId} · ${m(j.plannedM)} · ${fmtDT(j.startTime)}→${fmtDT(j.endTime)}`}>
                        <Box
                          onPointerDown={(e) => onDown(e, j, baseLeft, width)}
                          onPointerMove={(e) => onMove(e, j.id)}
                          onPointerUp={(e) => onUp(e, j)}
                          sx={{
                            position: "absolute", left: `${left}%`, width: `${width}%`, top: 3, height: 20,
                            bgcolor: STAGE_COLOR[j.stage], borderRadius: 0.75, color: "common.white", fontSize: 10,
                            px: 0.5, overflow: "hidden", whiteSpace: "nowrap",
                            cursor: onReschedule ? (dragging ? "grabbing" : "grab") : "default",
                            touchAction: "none", userSelect: "none",
                            zIndex: dragging ? 5 : 1,
                            outline: dragging ? `2px solid ${theme.palette.common.white}` : j.manuallyMoved ? `2px solid ${alpha(theme.palette.common.white, 0.7)}` : "none",
                            display: "flex", alignItems: "center", boxShadow: dragging ? 4 : 1,
                          }}
                        >
                          {j.coreColor ? j.coreColor[0] : STAGE_LABEL[j.stage][0]}
                        </Box>
                      </Tooltip>
                    );
                  })}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Paper>
  );
}
