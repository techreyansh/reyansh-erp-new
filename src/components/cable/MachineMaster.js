// Machine Master (UX overhaul Wave 1) — a planner-friendly master workspace.
// Visual machine cards (status / capacity / utilization / next job / setup) with
// a table view toggle; every record supports Add / Edit / Duplicate / Archive /
// Delete (all visible, no hidden menus) + change history; search, stage & status
// filters, sort, and bulk actions. Single-step create. Production logic untouched
// — this only changes presentation + master-data maintenance.
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box, Paper, Typography, Button, IconButton, Tooltip, Chip, Stack, Switch, Skeleton,
  Alert, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Grid, FormControlLabel,
  MenuItem, ToggleButton, ToggleButtonGroup, Card, CardContent, LinearProgress, Checkbox,
  InputAdornment, Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  useTheme, alpha,
} from "@mui/material";
import {
  Edit as EditIcon, Add as AddIcon, ContentCopyRounded, ArchiveRounded, UnarchiveRounded,
  DeleteOutlineRounded, HistoryRounded, SearchRounded, ViewModuleRounded, ViewListRounded,
  PrecisionManufacturingRounded as MachineIcon, BoltRounded,
} from "@mui/icons-material";
import ppcService from "../../services/ppcService";
import { setAuditReason } from "../../services/masterAuditService";
import { loadEngineMachines, loadSavedSchedule } from "../../services/cableProductionService";
import { capacityBoard } from "../../services/cablePlanner";
import MasterHistoryDrawer from "./masters/MasterHistoryDrawer";

const TABLE = "ppc_machines";
const STAGES = ["bunching", "core", "laying", "sheathing", "cutting"];
const STAGE_COLOR = { bunching: "#6366f1", core: "#0ea5e9", laying: "#f59e0b", sheathing: "#10b981", cutting: "#a855f7" };
const NUMBER_FIELDS = [
  { key: "speed_m_per_hr", label: "Speed (m/hr)" },
  { key: "changeover_min", label: "Changeover / setup (min)" },
  { key: "scrap_pct", label: "Scrap %" },
  { key: "lay_reduction_pct", label: "Lay reduction %" },
  { key: "shift_start_hour", label: "Shift start hour" },
  { key: "shift_hours", label: "Shift hours" },
  { key: "days_per_week", label: "Days per week" },
  { key: "drum_capacity_m", label: "Drum capacity (m)" },
  { key: "core_capacity_m", label: "Core capacity (m)" },
  { key: "laying_drum_capacity_m", label: "Laying drum capacity (m)" },
];
const EMPTY_MACHINE = { code: "", name: "", stage: "bunching", is_available: true, days_per_week: 6, shift_start_hour: 9, shift_hours: 8 };
const num = (v) => (v === null || v === undefined || v === "" ? "—" : v);
const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : null);
const utilColor = (pct, t) => (pct > 100 ? t.palette.error.main : pct > 75 ? t.palette.warning.main : pct > 25 ? t.palette.success.main : t.palette.success.light);

export default function MachineMaster() {
  const theme = useTheme();
  const [machines, setMachines] = useState([]);
  const [loadInfo, setLoadInfo] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [view, setView] = useState("cards");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState(new Set());
  const [statusFilter, setStatusFilter] = useState("active"); // active | archived | all
  const [sortKey, setSortKey] = useState("code");
  const [selected, setSelected] = useState(new Set());

  const [dialog, setDialog] = useState(null); // { form, isNew }
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [confirm, setConfirm] = useState(null); // { kind:'archive'|'delete'|'bulkArchive'|'bulkDelete', ids:[], reason:'' }
  const [history, setHistory] = useState(null); // { recordId, title }

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      setMachines(await ppcService.listCableMachines() || []);
    } catch (e) { setError(e.message || "Failed to load machines."); }
    finally { setLoading(false); }
  }, []);

  const refreshLoadInfo = useCallback(async () => {
    try {
      const [eng, sched] = await Promise.all([loadEngineMachines(), loadSavedSchedule()]);
      const info = {};
      capacityBoard(eng, sched).forEach((b) => { info[b.machine.id] = { util: b.utilToday, bottleneck: b.bottleneck }; });
      const now = Date.now();
      (sched || []).forEach((j) => {
        const t = new Date(j.startTime).getTime();
        if (t < now) return;
        const cur = info[j.machineId]?.nextJob;
        if (!cur || t < cur._t) info[j.machineId] = { ...(info[j.machineId] || {}), nextJob: { _t: t, label: `${j.stage} · ${j.orderNo || j.cableId || ""}`, at: j.startTime } };
      });
      setLoadInfo(info);
    } catch { /* load info is best-effort */ }
  }, []);

  useEffect(() => { load(); refreshLoadInfo(); }, [load, refreshLoadInfo]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = machines.filter((m) => {
      if (statusFilter === "active" && m.archived_at) return false;
      if (statusFilter === "archived" && !m.archived_at) return false;
      if (stageFilter.size && !stageFilter.has(m.stage)) return false;
      if (q && !(`${m.code} ${m.name} ${m.stage}`.toLowerCase().includes(q))) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (sortKey === "speed") return (b.speed_m_per_hr || 0) - (a.speed_m_per_hr || 0);
      if (sortKey === "util") return (loadInfo[b.code]?.util || 0) - (loadInfo[a.code]?.util || 0);
      if (sortKey === "stage") return String(a.stage).localeCompare(String(b.stage));
      return String(a.code).localeCompare(String(b.code));
    });
    return rows;
  }, [machines, search, stageFilter, statusFilter, sortKey, loadInfo]);

  const toggleStage = (s) => setStageFilter((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  const toggleSel = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSelected(new Set());

  // ---- dialog (single-step create / edit) ----
  const openNew = () => { setDialogError(""); setDialog({ form: { ...EMPTY_MACHINE }, isNew: true }); };
  const openEdit = (row) => { setDialogError(""); setDialog({ form: { ...row }, isNew: false }); };
  const openDuplicate = (row) => {
    setDialogError("");
    const copy = { ...row, id: undefined, code: `${row.code || "M"}-2`, name: row.name ? `${row.name} (copy)` : "", archived_at: null };
    setDialog({ form: copy, isNew: true });
  };
  const setField = (k, v) => setDialog((d) => ({ ...d, form: { ...d.form, [k]: v } }));

  const buildRow = (f) => {
    const row = { code: String(f.code || "").trim(), name: String(f.name || "").trim() || null, stage: f.stage, machine_type: f.stage, is_available: !!f.is_available };
    NUMBER_FIELDS.forEach(({ key }) => { const v = f[key]; row[key] = v === null || v === undefined || v === "" ? null : Number(v); });
    return row;
  };
  const handleSave = async () => {
    setDialogError("");
    if (!String(dialog.form.code || "").trim()) { setDialogError("Machine code is required."); return; }
    setSaving(true);
    try {
      const row = buildRow(dialog.form);
      if (dialog.isNew) await ppcService.addCableMachine({ ...row, status: "idle" });
      else await ppcService.updateCableMachine(dialog.form.id, row);
      setDialog(null); await load(); refreshLoadInfo();
    } catch (e) { setDialogError(e.message || "Failed to save machine."); }
    finally { setSaving(false); }
  };

  // ---- inline availability toggle ----
  const toggleAvailable = async (row) => {
    const next = !row.is_available;
    setMachines((prev) => prev.map((m) => (m.id === row.id ? { ...m, is_available: next } : m)));
    try { await ppcService.updateCableMachine(row.id, { is_available: next }); }
    catch (e) { setError(e.message); setMachines((prev) => prev.map((m) => (m.id === row.id ? { ...m, is_available: row.is_available } : m))); }
  };
  const restore = async (row) => { await ppcService.archiveCableMachine(row.id, false); load(); };

  // ---- confirm (archive / delete, single + bulk) ----
  const runConfirm = async () => {
    const { kind, ids, reason } = confirm;
    setSaving(true);
    try {
      for (const id of ids) {
        if (kind.includes("archive")) await ppcService.archiveCableMachine(id, true);
        else await ppcService.deleteCableMachine(id);
        if (reason) await setAuditReason(TABLE, id, reason);
      }
      setConfirm(null); clearSel(); await load(); refreshLoadInfo();
    } catch (e) { setError(e.message || "Action failed."); }
    finally { setSaving(false); }
  };

  const actionBtns = (m) => (
    <Stack direction="row" spacing={0.25}>
      <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(m)}><EditIcon fontSize="small" /></IconButton></Tooltip>
      <Tooltip title="Duplicate"><IconButton size="small" onClick={() => openDuplicate(m)}><ContentCopyRounded fontSize="small" /></IconButton></Tooltip>
      {m.archived_at
        ? <Tooltip title="Restore"><IconButton size="small" color="primary" onClick={() => restore(m)}><UnarchiveRounded fontSize="small" /></IconButton></Tooltip>
        : <Tooltip title="Archive"><IconButton size="small" onClick={() => setConfirm({ kind: "archive", ids: [m.id], reason: "", label: m.code })}><ArchiveRounded fontSize="small" /></IconButton></Tooltip>}
      <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setConfirm({ kind: "delete", ids: [m.id], reason: "", label: m.code })}><DeleteOutlineRounded fontSize="small" /></IconButton></Tooltip>
      <Tooltip title="History"><IconButton size="small" onClick={() => setHistory({ recordId: m.id, title: `${m.code} — ${m.name || ""}` })}><HistoryRounded fontSize="small" /></IconButton></Tooltip>
    </Stack>
  );

  return (
    <Box>
      {/* header */}
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1.5} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>Machine Master</Typography>
          <Typography variant="body2" color="text.secondary">{filtered.length} machine{filtered.length === 1 ? "" : "s"} · drive auto-routing, scheduling & capacity</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
            <ToggleButton value="cards"><ViewModuleRounded fontSize="small" /></ToggleButton>
            <ToggleButton value="table"><ViewListRounded fontSize="small" /></ToggleButton>
          </ToggleButtonGroup>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>Add machine</Button>
        </Stack>
      </Stack>

      {/* toolbar: search + filters + sort */}
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }} flexWrap="wrap" useFlexGap>
          <TextField size="small" placeholder="Search code / name / stage" value={search} onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> }} sx={{ minWidth: 240 }} />
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {STAGES.map((s) => (
              <Chip key={s} label={s} size="small" variant={stageFilter.has(s) ? "filled" : "outlined"}
                color={stageFilter.has(s) ? "primary" : "default"} onClick={() => toggleStage(s)} sx={{ textTransform: "capitalize" }} />
            ))}
          </Stack>
          <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 130 }}>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="archived">Archived</MenuItem>
            <MenuItem value="all">All</MenuItem>
          </TextField>
          <TextField select size="small" label="Sort" value={sortKey} onChange={(e) => setSortKey(e.target.value)} sx={{ minWidth: 130 }}>
            <MenuItem value="code">Code</MenuItem>
            <MenuItem value="stage">Stage</MenuItem>
            <MenuItem value="speed">Speed</MenuItem>
            <MenuItem value="util">Utilization</MenuItem>
          </TextField>
        </Stack>
      </Paper>

      {/* bulk action bar */}
      {selected.size > 0 && (
        <Paper variant="outlined" sx={{ p: 1, mb: 2, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.06), display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography variant="body2" sx={{ fontWeight: 700, px: 1 }}>{selected.size} selected</Typography>
          <Button size="small" startIcon={<ArchiveRounded />} onClick={() => setConfirm({ kind: "bulkArchive", ids: [...selected], reason: "", label: `${selected.size} machines` })}>Archive</Button>
          <Button size="small" color="error" startIcon={<DeleteOutlineRounded />} onClick={() => setConfirm({ kind: "bulkDelete", ids: [...selected], reason: "", label: `${selected.size} machines` })}>Delete</Button>
          <Button size="small" onClick={clearSel}>Clear</Button>
        </Paper>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}

      {/* CARDS */}
      {view === "cards" && (
        <Grid container spacing={1.5}>
          {loading && Array.from({ length: 4 }).map((_, i) => (
            <Grid item xs={12} sm={6} md={4} key={`sk-${i}`}><Skeleton variant="rounded" height={180} /></Grid>
          ))}
          {!loading && filtered.length === 0 && (
            <Grid item xs={12}><Paper variant="outlined" sx={{ p: 5, textAlign: "center" }}>
              <MachineIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
              <Typography color="text.secondary">No machines match. Adjust filters or add one.</Typography>
            </Paper></Grid>
          )}
          {!loading && filtered.map((m) => {
            const info = loadInfo[m.code] || {};
            const util = info.util || 0;
            return (
              <Grid item xs={12} sm={6} md={4} key={m.id}>
                <Card variant="outlined" sx={{ borderRadius: 2, height: "100%", opacity: m.archived_at ? 0.6 : 1, borderColor: info.bottleneck ? "error.main" : "divider" }}>
                  <CardContent sx={{ pb: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Checkbox size="small" sx={{ p: 0.5 }} checked={selected.has(m.id)} onChange={() => toggleSel(m.id)} />
                        <Box>
                          <Typography sx={{ fontWeight: 800, lineHeight: 1.1 }}>{m.name || m.code}</Typography>
                          <Typography variant="caption" color="text.secondary">{m.code}</Typography>
                        </Box>
                      </Stack>
                      <Chip size="small" label={m.stage} sx={{ textTransform: "capitalize", bgcolor: alpha(STAGE_COLOR[m.stage] || "#888", 0.15), color: STAGE_COLOR[m.stage], fontWeight: 700 }} />
                    </Stack>

                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                      <Chip size="small" color={m.archived_at ? "default" : m.is_available ? "success" : "warning"}
                        label={m.archived_at ? "Archived" : m.is_available ? "Available" : "Unavailable"} variant={m.archived_at ? "outlined" : "filled"} />
                      <FormControlLabel sx={{ ml: 0 }} control={<Switch size="small" checked={!!m.is_available} disabled={!!m.archived_at} onChange={() => toggleAvailable(m)} />} label={<Typography variant="caption">Available</Typography>} />
                    </Stack>

                    {/* utilization */}
                    <Box sx={{ mt: 1 }}>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="caption" color="text.secondary">Today's load</Typography>
                        <Typography variant="caption" sx={{ fontWeight: 700, color: utilColor(util, theme) }}>{util}%</Typography>
                      </Stack>
                      <LinearProgress variant="determinate" value={Math.min(100, util)} sx={{ height: 6, borderRadius: 3, mt: 0.25, "& .MuiLinearProgress-bar": { backgroundColor: utilColor(util, theme) } }} />
                    </Box>

                    {/* spec grid */}
                    <Grid container spacing={0.5} sx={{ mt: 0.5 }}>
                      <Spec label="Speed" value={`${num(m.speed_m_per_hr)} m/hr`} />
                      <Spec label="Setup" value={`${num(m.changeover_min)} min`} />
                      <Spec label="Scrap" value={`${num(m.scrap_pct)}%`} />
                      <Spec label="Shift" value={`${num(m.shift_start_hour)}h · ${num(m.shift_hours)}h · ${num(m.days_per_week)}d`} />
                      <Spec label="Drum cap" value={m.drum_capacity_m ? `${m.drum_capacity_m} m` : "—"} />
                      <Spec label="Core cap" value={m.core_capacity_m ? `${m.core_capacity_m} m` : "—"} />
                    </Grid>

                    <Box sx={{ mt: 1, p: 0.75, borderRadius: 1, bgcolor: alpha(theme.palette.text.primary, 0.03) }}>
                      <Typography variant="caption" color="text.secondary">Next job</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                        {info.nextJob ? `${info.nextJob.label} · ${fmtDT(info.nextJob.at)}` : "— none scheduled"}
                      </Typography>
                    </Box>
                  </CardContent>
                  <Box sx={{ px: 1, pb: 1, display: "flex", justifyContent: "flex-end" }}>{actionBtns(m)}</Box>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* TABLE */}
      {view === "table" && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
          <TableContainer>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  {["Code", "Name", "Stage", "Status", "Util", "Speed", "Setup", "Scrap %", "Shift", "Drum", "Actions"].map((h) => (
                    <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {!loading && filtered.map((m) => (
                  <TableRow key={m.id} hover sx={{ opacity: m.archived_at ? 0.6 : 1 }}>
                    <TableCell padding="checkbox"><Checkbox size="small" checked={selected.has(m.id)} onChange={() => toggleSel(m.id)} /></TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{m.code}</TableCell>
                    <TableCell>{m.name || "—"}</TableCell>
                    <TableCell><Chip size="small" label={m.stage} sx={{ textTransform: "capitalize" }} /></TableCell>
                    <TableCell><Chip size="small" variant="outlined" color={m.archived_at ? "default" : m.is_available ? "success" : "warning"} label={m.archived_at ? "Archived" : m.is_available ? "Avail" : "Unavail"} /></TableCell>
                    <TableCell sx={{ color: utilColor(loadInfo[m.code]?.util || 0, theme), fontWeight: 700 }}>{loadInfo[m.code]?.util || 0}%</TableCell>
                    <TableCell>{num(m.speed_m_per_hr)}</TableCell>
                    <TableCell>{num(m.changeover_min)}</TableCell>
                    <TableCell>{num(m.scrap_pct)}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{num(m.shift_start_hour)}/{num(m.shift_hours)}/{num(m.days_per_week)}</TableCell>
                    <TableCell>{num(m.drum_capacity_m)}</TableCell>
                    <TableCell>{actionBtns(m)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* create / edit dialog (single-step, all specs) */}
      <Dialog open={!!dialog} onClose={() => !saving && setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{dialog?.isNew ? "Add machine" : `Edit ${dialog?.form?.code || "machine"}`}</DialogTitle>
        <DialogContent dividers>
          {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
          {dialog && (
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}><TextField label="Code" required fullWidth size="small" value={dialog.form.code || ""} onChange={(e) => setField("code", e.target.value)} /></Grid>
              <Grid item xs={12} sm={5}><TextField label="Name" fullWidth size="small" value={dialog.form.name || ""} onChange={(e) => setField("name", e.target.value)} /></Grid>
              <Grid item xs={12} sm={3}>
                <TextField select label="Stage" fullWidth size="small" value={dialog.form.stage || "bunching"} onChange={(e) => setField("stage", e.target.value)}>
                  {STAGES.map((s) => <MenuItem key={s} value={s} sx={{ textTransform: "capitalize" }}>{s}</MenuItem>)}
                </TextField>
              </Grid>
              {NUMBER_FIELDS.map(({ key, label }) => (
                <Grid item xs={6} sm={4} key={key}>
                  <TextField label={label} type="number" fullWidth size="small" value={dialog.form[key] ?? ""} onChange={(e) => setField(key, e.target.value)} />
                </Grid>
              ))}
              <Grid item xs={12}><FormControlLabel control={<Switch checked={!!dialog.form.is_available} onChange={(e) => setField("is_available", e.target.checked)} />} label="Available for scheduling" /></Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogActions>
      </Dialog>

      {/* confirm archive / delete with optional reason */}
      <Dialog open={!!confirm} onClose={() => !saving && setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {confirm?.kind.includes("archive") ? "Archive" : "Delete"} {confirm?.label}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {confirm?.kind.includes("archive")
              ? "Archived machines are hidden from planning but kept for history and can be restored."
              : "This permanently deletes the machine. This cannot be undone."}
          </Typography>
          <TextField label="Reason (recorded in history)" fullWidth size="small" multiline minRows={2}
            value={confirm?.reason || ""} onChange={(e) => setConfirm((c) => ({ ...c, reason: e.target.value }))} />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setConfirm(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" color={confirm?.kind.includes("delete") ? "error" : "warning"} onClick={runConfirm} disabled={saving}>
            {saving ? "Working…" : confirm?.kind.includes("archive") ? "Archive" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      <MasterHistoryDrawer open={!!history} onClose={() => setHistory(null)} tableName={TABLE} recordId={history?.recordId} title={history?.title} />
    </Box>
  );
}

function Spec({ label, value }) {
  return (
    <Grid item xs={6}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.2 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{value}</Typography>
    </Grid>
  );
}
