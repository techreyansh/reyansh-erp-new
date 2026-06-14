// Auto Planner — drives the ported cable-planner engine inside the ERP.
// Loads cables + production plans from the existing sheets, auto-schedules jobs
// across the 4 machines (bunching→core→laying→sheathing), shows a Gantt + table,
// and saves the generated jobs to the Machine Schedules sheet.
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box, Paper, Stack, Typography, Button, Chip, CircularProgress, Snackbar, Alert,
  TextField, MenuItem, FormControlLabel, Switch, Table, TableHead, TableRow,
  TableCell, TableBody, Tooltip, alpha, useTheme,
} from "@mui/material";
import {
  PlayArrowRounded, SaveRounded, RefreshRounded, AutoAwesomeRounded, WarningAmberRounded,
} from "@mui/icons-material";
import sheetService from "../../services/sheetService";
import {
  runAutoSchedule, sumRM, DEFAULT_MACHINES, STAGE_LABEL,
} from "../../services/cablePlanner";
import { rowToCable, rowToOrder, jobToScheduleRow } from "../../services/cablePlanner/erpAdapter";

const STAGE_COLOR = { bunching: "#6366f1", core: "#0ea5e9", laying: "#f59e0b", sheathing: "#10b981" };
const kg = (v) => `${(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
const m = (v) => `${(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} m`;
const fmtDT = (iso) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function CableAutoPlanner() {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [cables, setCables] = useState([]);
  const [orders, setOrders] = useState([]);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState(null);
  const [opts, setOpts] = useState({
    startDate: todayStr(), mode: "forward", priority: "due_date",
    scope: "pending", batching: false, batchWindow: 7, checkStock: "skip",
  });

  const notify = (message, severity = "success") => setSnack({ message, severity });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cp, plans] = await Promise.all([
        sheetService.getSheetData("Cable Products"),
        sheetService.getSheetData("Cable Production Plans"),
      ]);
      setCables((cp || []).map(rowToCable).filter((c) => c.code));
      setOrders((plans || []).map(rowToOrder).filter((o) => o.cableId && o.qtyM > 0));
    } catch (e) {
      notify(`Failed to load data: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const cablesById = useMemo(() => Object.fromEntries(cables.map((c) => [c.id, c])), [cables]);

  const run = () => {
    if (!orders.length) { notify("No production plans with a quantity to schedule", "warning"); return; }
    try {
      const res = runAutoSchedule({
        cables, machines: DEFAULT_MACHINES, speeds: [], orders,
        options: { ...opts, startDate: new Date(`${opts.startDate}T09:00:00`) },
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

  const materials = useMemo(() => {
    if (!result) return null;
    const items = result.plannedOrderIds
      .map((id) => orders.find((o) => o.id === id))
      .filter(Boolean)
      .map((o) => ({ cable: cablesById[o.cableId] || {}, qtyMeters: o.qtyM }));
    return sumRM(items);
  }, [result, orders, cablesById]);

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      {/* CONTROLS */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <AutoAwesomeRounded color="primary" />
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Auto Planner</Typography>
          <Chip size="small" variant="outlined" label={`${cables.length} cables · ${orders.length} plans`} />
          <Box sx={{ flex: 1 }} />
          <Button size="small" startIcon={<RefreshRounded />} onClick={load} sx={{ textTransform: "none" }}>Reload</Button>
        </Stack>

        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
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
      </Paper>

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

          {/* GANTT */}
          <Gantt schedule={result.schedule} machines={DEFAULT_MACHINES} theme={theme} />

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

// Compact 7-day Gantt: one row per machine, bars positioned across the window.
function Gantt({ schedule, machines, theme }) {
  if (!schedule.length) return null;
  const starts = schedule.map((j) => new Date(j.startTime).getTime());
  const ends = schedule.map((j) => new Date(j.endTime).getTime());
  const min = Math.min(...starts);
  const max = Math.max(Math.max(...ends), min + 7 * 86400000);
  const span = max - min || 1;
  const days = [];
  for (let t = min; t <= max; t += 86400000) days.push(new Date(t));

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, overflow: "hidden" }}>
      <Typography variant="overline" sx={{ fontWeight: 800, color: "text.secondary" }}>Timeline (Gantt)</Typography>
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
                    const left = ((new Date(j.startTime).getTime() - min) / span) * 100;
                    const width = Math.max(((new Date(j.endTime).getTime() - new Date(j.startTime).getTime()) / span) * 100, 0.5);
                    return (
                      <Tooltip key={j.id} title={`${STAGE_LABEL[j.stage]} · ${j.cableId} · ${m(j.plannedM)} · ${fmtDT(j.startTime)}→${fmtDT(j.endTime)}`}>
                        <Box sx={{
                          position: "absolute", left: `${left}%`, width: `${width}%`, top: 3, height: 20,
                          bgcolor: STAGE_COLOR[j.stage], borderRadius: 0.75, color: "#fff", fontSize: 10,
                          px: 0.5, overflow: "hidden", whiteSpace: "nowrap", cursor: "default",
                          display: "flex", alignItems: "center", boxShadow: 1,
                        }}>
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
