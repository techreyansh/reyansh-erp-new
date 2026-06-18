// Job Cards — per-machine operator cards for a chosen day, with stage specs,
// material kg, and supervisor "enter actuals" writing back to Machine Schedules.
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box, Paper, Stack, Typography, Button, Chip, CircularProgress, Snackbar, Alert,
  TextField, MenuItem, Divider, Dialog, DialogTitle, DialogContent, DialogActions,
  IconButton, Tooltip, alpha, useTheme,
} from "@mui/material";
import {
  RefreshRounded, TvRounded, PlayArrowRounded, CheckCircleRounded, EditNoteRounded,
} from "@mui/icons-material";
import sheetService from "../../services/sheetService";
import { jobSpecs, DEFAULT_MACHINES } from "../../services/cablePlanner";
import { rowToCable, rowToOrder } from "../../services/cablePlanner/erpAdapter";
import { demoScheduleRows, demoCablesByCode, demoOrdersById } from "../../services/cablePlanner/demo";

const stageColor = (theme) => ({ bunching: theme.palette.primary.main, core: theme.palette.primary.main, laying: theme.palette.warning.main, sheathing: theme.palette.success.main });
const num = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const todayStr = () => new Date().toISOString().slice(0, 10);
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—");
const nowLocalInput = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

const rowToJob = (row) => ({
  stage: row.stage,
  plannedM: num(row.quantity),
  plannedInputM: num(row.inputQuantity),
  coreIndex: row.coreIndex,
  coreColor: row.coreColor,
  coreOfTotal: row.coreOfTotal,
});

export default function CableJobCards() {
  const theme = useTheme();
  const [date, setDate] = useState(todayStr());
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [cablesByCode, setCablesByCode] = useState({});
  const [ordersById, setOrdersById] = useState({});
  const [snack, setSnack] = useState(null);
  const [actual, setActual] = useState(null); // { row, form }

  const notify = (message, severity = "success") => setSnack({ message, severity });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sch, cp, plans] = await Promise.all([
        sheetService.getSheetData("Machine Schedules"),
        sheetService.getSheetData("Cable Products"),
        sheetService.getSheetData("Cable Production Plans"),
      ]);
      setRows(sch || []);
      const cabs = {};
      (cp || []).map(rowToCable).forEach((c) => { if (c.code) cabs[c.code] = c; });
      setCablesByCode(cabs);
      const ords = {};
      (plans || []).map(rowToOrder).forEach((o) => { ords[o.id] = o; });
      setOrdersById(ords);
    } catch (e) {
      notify(`Failed to load: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadDemo = () => {
    setRows(demoScheduleRows(Date.now()));
    setCablesByCode(demoCablesByCode());
    setOrdersById(demoOrdersById());
    setDate(todayStr());
    setLoading(false);
    notify("Loaded demo jobs (in-memory — not saved)", "info");
  };

  const byMachine = useMemo(() => {
    const dayRows = rows.filter((r) => String(r.scheduledStartTime || "").slice(0, 10) === date);
    const map = {};
    for (const m of DEFAULT_MACHINES) map[m.id] = [];
    for (const r of dayRows) (map[r.machineId] = map[r.machineId] || []).push(r);
    for (const k of Object.keys(map)) map[k].sort((a, b) => String(a.scheduledStartTime).localeCompare(String(b.scheduledStartTime)));
    return map;
  }, [rows, date]);

  const openFloor = (machineId) => window.open(`/cable-floor?machine=${machineId}`, "_blank");

  // quick status update (Start / Done) or full actuals save
  const persist = async (row, patch) => {
    try {
      const fresh = await sheetService.getSheetData("Machine Schedules");
      const idx = (fresh || []).findIndex((r) => r.scheduleId === row.scheduleId);
      if (idx === -1) throw new Error("Schedule row not found");
      await sheetService.updateRow("Machine Schedules", idx + 2, patch);
      notify("Saved");
      load();
    } catch (e) {
      notify(`Save failed: ${e.message}`, "error");
    }
  };

  const quickStart = (row) => persist(row, { status: "In Progress", actualStartTime: new Date().toISOString() });
  const quickDone = (row) => persist(row, { status: "Completed", actualEndTime: new Date().toISOString() });

  const saveActual = async () => {
    const { row, form } = actual;
    await persist(row, {
      actualQuantity: form.actualM,
      scrapMeters: form.scrapM,
      operatorName: form.operator,
      actualStartTime: form.actualStart ? new Date(form.actualStart).toISOString() : row.actualStartTime || "",
      actualEndTime: form.actualEnd ? new Date(form.actualEnd).toISOString() : row.actualEndTime || "",
      status: form.status,
    });
    setActual(null);
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Job Cards</Typography>
          <TextField size="small" type="date" label="Date" InputLabelProps={{ shrink: true }} value={date} onChange={(e) => setDate(e.target.value)} sx={{ width: 170 }} />
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={loadDemo} sx={{ textTransform: "none" }}>Demo data</Button>
          <Button size="small" startIcon={<RefreshRounded />} onClick={load} sx={{ textTransform: "none" }}>Reload</Button>
        </Stack>
      </Paper>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress /></Box>
      ) : (
        <Stack spacing={2}>
          {DEFAULT_MACHINES.map((mac) => {
            const jobs = byMachine[mac.id] || [];
            return (
              <Paper key={mac.id} variant="outlined" sx={{ borderRadius: 2.5, overflow: "hidden" }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.25, bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  <Typography sx={{ fontWeight: 800 }}>{mac.name} <Typography component="span" variant="caption" color="text.secondary">({mac.id})</Typography></Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" label={`${jobs.length} job${jobs.length === 1 ? "" : "s"}`} />
                    <Tooltip title="Open floor / TV view"><IconButton size="small" onClick={() => openFloor(mac.id)}><TvRounded /></IconButton></Tooltip>
                  </Stack>
                </Stack>
                {jobs.length === 0 ? (
                  <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">No jobs scheduled this day.</Typography></Box>
                ) : (
                  <Box sx={{ p: 1.5, display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
                    {jobs.map((row) => {
                      const cable = cablesByCode[row.productCode] || { code: row.productCode, size: 1, cores: 1 };
                      const order = ordersById[row.planId] || { orderNo: row.orderNumber, customer: row.customerName };
                      const spec = jobSpecs(rowToJob(row), cable, order);
                      const done = String(row.status || "").toLowerCase().includes("complet");
                      return (
                        <Paper key={row.scheduleId} variant="outlined" sx={{ p: 1.5, borderRadius: 2, borderLeft: `4px solid ${stageColor(theme)[row.stage]}` }}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                            <Typography sx={{ fontWeight: 700 }}>{spec.title}</Typography>
                            <Chip size="small" label={row.status || "Scheduled"} color={done ? "success" : "default"} />
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            {order.orderNo || "—"} · {cable.code} · {hhmm(row.scheduledStartTime)}–{hhmm(row.scheduledEndTime)}
                          </Typography>
                          <Divider sx={{ my: 1 }} />
                          <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 1, rowGap: 0.25 }}>
                            {spec.specs.map(([k, v]) => (
                              <React.Fragment key={k}>
                                <Typography variant="caption" color="text.secondary">{k}</Typography>
                                <Typography variant="caption" sx={{ fontWeight: 600 }}>{v}</Typography>
                              </React.Fragment>
                            ))}
                          </Box>
                          {row.actualQuantity != null && row.actualQuantity !== "" && (
                            <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "success.main", fontWeight: 700 }}>
                              Actual: {row.actualQuantity} m{row.scrapMeters ? ` · scrap ${row.scrapMeters} m` : ""}{row.operatorName ? ` · ${row.operatorName}` : ""}
                            </Typography>
                          )}
                          <Stack direction="row" spacing={0.5} sx={{ mt: 1 }}>
                            <Button size="small" startIcon={<PlayArrowRounded />} onClick={() => quickStart(row)} sx={{ textTransform: "none" }}>Start</Button>
                            <Button size="small" color="success" startIcon={<CheckCircleRounded />} onClick={() => quickDone(row)} sx={{ textTransform: "none" }}>Done</Button>
                            <Button size="small" startIcon={<EditNoteRounded />} onClick={() => setActual({ row, form: { actualM: row.actualQuantity || row.quantity || "", scrapM: row.scrapMeters || "", operator: row.operatorName || "", actualStart: "", actualEnd: nowLocalInput(), status: "Completed" } })} sx={{ textTransform: "none" }}>Actuals</Button>
                          </Stack>
                        </Paper>
                      );
                    })}
                  </Box>
                )}
              </Paper>
            );
          })}
        </Stack>
      )}

      <Dialog open={!!actual} onClose={() => setActual(null)} fullWidth maxWidth="sm">
        <DialogTitle>Enter actuals</DialogTitle>
        <DialogContent>
          {actual && (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <Stack direction="row" spacing={2}>
                <TextField label="Actual metres" type="number" value={actual.form.actualM} onChange={(e) => setActual({ ...actual, form: { ...actual.form, actualM: e.target.value } })} fullWidth />
                <TextField label="Scrap metres" type="number" value={actual.form.scrapM} onChange={(e) => setActual({ ...actual, form: { ...actual.form, scrapM: e.target.value } })} fullWidth />
              </Stack>
              <TextField label="Operator" value={actual.form.operator} onChange={(e) => setActual({ ...actual, form: { ...actual.form, operator: e.target.value } })} fullWidth />
              <Stack direction="row" spacing={2}>
                <TextField label="Actual start" type="datetime-local" InputLabelProps={{ shrink: true }} value={actual.form.actualStart} onChange={(e) => setActual({ ...actual, form: { ...actual.form, actualStart: e.target.value } })} fullWidth />
                <TextField label="Actual end" type="datetime-local" InputLabelProps={{ shrink: true }} value={actual.form.actualEnd} onChange={(e) => setActual({ ...actual, form: { ...actual.form, actualEnd: e.target.value } })} fullWidth />
              </Stack>
              <TextField select label="Status" value={actual.form.status} onChange={(e) => setActual({ ...actual, form: { ...actual.form, status: e.target.value } })} fullWidth>
                {["Scheduled", "In Progress", "Completed"].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </TextField>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setActual(null)} sx={{ textTransform: "none" }}>Cancel</Button>
          <Button variant="contained" onClick={saveActual} sx={{ textTransform: "none" }}>Save actuals</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
