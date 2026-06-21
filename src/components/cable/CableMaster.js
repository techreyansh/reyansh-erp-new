// Cable Master (UX overhaul Wave 1) — a cable-card workspace, not a spec table.
// Each cable shows code / name / size / core config / flat-round / weight-per-m /
// finished OD / colours at a glance, with visible Edit / Duplicate / Archive /
// Delete / History. Card & table views, search + filters + sort, bulk actions,
// single dialog with a live auto-computed geometry/BOM preview. Production +
// geometry math (computeSpecs) is untouched — only presentation + maintenance.
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box, Paper, Typography, Button, TextField, InputAdornment, Table, TableHead, TableBody,
  TableRow, TableCell, TableContainer, IconButton, Tooltip, Chip, Stack, Skeleton, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, Grid, Autocomplete, Checkbox,
  FormControlLabel, MenuItem, Divider, Card, CardContent, ToggleButton, ToggleButtonGroup,
  useTheme, alpha,
} from "@mui/material";
import {
  Add as AddIcon, Search as SearchIcon, Edit as EditIcon, ContentCopyRounded,
  ArchiveRounded, UnarchiveRounded, DeleteOutlineRounded, HistoryRounded,
  CableRounded as CableIcon, ViewModuleRounded, ViewListRounded, BoltRounded,
} from "@mui/icons-material";
import {
  listCables, saveCable, deleteCable, duplicateCable, archiveCable, computeSpecs,
} from "../../services/cableMasterService";
import { setAuditReason } from "../../services/masterAuditService";
import MasterHistoryDrawer from "./masters/MasterHistoryDrawer";

const TABLE = "cable_master";
const COLOUR_OPTIONS = ["Red", "Black", "Yellow", "Green", "Blue", "Brown", "Grey", "White", "Green-Yellow", "Orange"];
const COLOUR_HEX = { Red: "#ef4444", Black: "#111827", Yellow: "#eab308", Green: "#22c55e", Blue: "#3b82f6", Brown: "#92400e", Grey: "#9ca3af", White: "#e5e7eb", "Green-Yellow": "#84cc16", Orange: "#f97316" };
const EMPTY_FORM = {
  cable_code: "", cable_name: "", cores: 1, flat_round: "round", strand_construction: "",
  copper_area_sqmm: "", conductor_od: "", core_od: "", finished_od: "", colour_combination: [],
  insulation_thickness: 0.6, sheath_thickness: 0.9, voltage: "", standard_length_m: "",
  weight_per_meter: "", is_power_cord: false, cord_length: "", notes: "", is_active: true,
};
const n2 = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(2));

export default function CableMaster() {
  const theme = useTheme();
  const [cables, setCables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [view, setView] = useState("cards");
  const [search, setSearch] = useState("");
  const [shapeFilter, setShapeFilter] = useState("all"); // all | round | flat
  const [kindFilter, setKindFilter] = useState("all");    // all | cable | powercord
  const [statusFilter, setStatusFilter] = useState("active");
  const [sortKey, setSortKey] = useState("code");
  const [selected, setSelected] = useState(new Set());

  const [dialog, setDialog] = useState(null); // { form, isNew }
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [history, setHistory] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setCables(await listCables() || []); }
    catch (e) { setError(e.message || "Failed to load cables."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = cables.filter((c) => {
      if (statusFilter === "active" && c.archived_at) return false;
      if (statusFilter === "archived" && !c.archived_at) return false;
      if (shapeFilter !== "all" && (c.flat_round || "round") !== shapeFilter) return false;
      if (kindFilter === "powercord" && !c.is_power_cord) return false;
      if (kindFilter === "cable" && c.is_power_cord) return false;
      if (q && !(`${c.cable_code} ${c.cable_name} ${c.voltage}`.toLowerCase().includes(q))) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (sortKey === "size") return (Number(b.copper_area_sqmm) || 0) - (Number(a.copper_area_sqmm) || 0);
      if (sortKey === "cores") return (Number(b.cores) || 0) - (Number(a.cores) || 0);
      if (sortKey === "name") return String(a.cable_name).localeCompare(String(b.cable_name));
      return String(a.cable_code).localeCompare(String(b.cable_code));
    });
    return rows;
  }, [cables, search, shapeFilter, kindFilter, statusFilter, sortKey]);

  const toggleSel = (id) => setSelected((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const clearSel = () => setSelected(new Set());

  const openNew = () => { setDialogError(""); setDialog({ form: { ...EMPTY_FORM }, isNew: true }); };
  const openEdit = (row) => { setDialogError(""); setDialog({ form: { ...EMPTY_FORM, ...row, colour_combination: row.colour_combination || [] }, isNew: false }); };
  const openDuplicate = (row) => { setDialogError(""); setDialog({ form: { ...EMPTY_FORM, ...row, id: undefined, cable_code: `${row.cable_code || "CBL"}-2`, cable_name: row.cable_name ? `${row.cable_name} (copy)` : "", archived_at: null, colour_combination: row.colour_combination || [] }, isNew: true }); };
  const setField = (k, v) => setDialog((d) => ({ ...d, form: { ...d.form, [k]: v } }));

  const preview = useMemo(() => { try { return dialog ? computeSpecs(dialog.form) : null; } catch { return null; } }, [dialog]);

  const handleSave = async () => {
    setDialogError("");
    if (!String(dialog.form.cable_code || "").trim()) { setDialogError("Cable code is required."); return; }
    setSaving(true);
    try { await saveCable(dialog.form); setDialog(null); await load(); }
    catch (e) { setDialogError(e.message || "Failed to save cable."); }
    finally { setSaving(false); }
  };
  const restore = async (row) => { await archiveCable(row.id, false); load(); };

  const runConfirm = async () => {
    const { kind, ids, reason } = confirm;
    setSaving(true);
    try {
      for (const id of ids) {
        if (kind.includes("archive")) await archiveCable(id, true);
        else await deleteCable(id);
        if (reason) await setAuditReason(TABLE, id, reason);
      }
      setConfirm(null); clearSel(); await load();
    } catch (e) { setError(e.message || "Action failed."); }
    finally { setSaving(false); }
  };

  const actionBtns = (c) => (
    <Stack direction="row" spacing={0.25}>
      <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(c)}><EditIcon fontSize="small" /></IconButton></Tooltip>
      <Tooltip title="Duplicate"><IconButton size="small" onClick={() => openDuplicate(c)}><ContentCopyRounded fontSize="small" /></IconButton></Tooltip>
      {c.archived_at
        ? <Tooltip title="Restore"><IconButton size="small" color="primary" onClick={() => restore(c)}><UnarchiveRounded fontSize="small" /></IconButton></Tooltip>
        : <Tooltip title="Archive"><IconButton size="small" onClick={() => setConfirm({ kind: "archive", ids: [c.id], reason: "", label: c.cable_code })}><ArchiveRounded fontSize="small" /></IconButton></Tooltip>}
      <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setConfirm({ kind: "delete", ids: [c.id], reason: "", label: c.cable_code })}><DeleteOutlineRounded fontSize="small" /></IconButton></Tooltip>
      <Tooltip title="History"><IconButton size="small" onClick={() => setHistory({ recordId: c.id, title: `${c.cable_code} — ${c.cable_name || ""}` })}><HistoryRounded fontSize="small" /></IconButton></Tooltip>
    </Stack>
  );

  const colourDots = (arr) => (
    <Stack direction="row" spacing={0.25}>
      {(arr || []).slice(0, 6).map((col, i) => (
        <Tooltip key={i} title={col}><Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: COLOUR_HEX[col] || "#888", border: "1px solid", borderColor: "divider" }} /></Tooltip>
      ))}
    </Stack>
  );

  return (
    <Box>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1.5} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>Cable Master</Typography>
          <Typography variant="body2" color="text.secondary">{filtered.length} cable{filtered.length === 1 ? "" : "s"} · specs auto-derive geometry, weight & BOM</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
            <ToggleButton value="cards"><ViewModuleRounded fontSize="small" /></ToggleButton>
            <ToggleButton value="table"><ViewListRounded fontSize="small" /></ToggleButton>
          </ToggleButtonGroup>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>New cable</Button>
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }} flexWrap="wrap" useFlexGap>
          <TextField size="small" placeholder="Search code / name / voltage" value={search} onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} sx={{ minWidth: 240 }} />
          <TextField select size="small" label="Shape" value={shapeFilter} onChange={(e) => setShapeFilter(e.target.value)} sx={{ minWidth: 110 }}>
            <MenuItem value="all">All</MenuItem><MenuItem value="round">Round</MenuItem><MenuItem value="flat">Flat</MenuItem>
          </TextField>
          <TextField select size="small" label="Type" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} sx={{ minWidth: 130 }}>
            <MenuItem value="all">All</MenuItem><MenuItem value="cable">Cable</MenuItem><MenuItem value="powercord">Power cord</MenuItem>
          </TextField>
          <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 120 }}>
            <MenuItem value="active">Active</MenuItem><MenuItem value="archived">Archived</MenuItem><MenuItem value="all">All</MenuItem>
          </TextField>
          <TextField select size="small" label="Sort" value={sortKey} onChange={(e) => setSortKey(e.target.value)} sx={{ minWidth: 110 }}>
            <MenuItem value="code">Code</MenuItem><MenuItem value="name">Name</MenuItem><MenuItem value="size">Size</MenuItem><MenuItem value="cores">Cores</MenuItem>
          </TextField>
        </Stack>
      </Paper>

      {selected.size > 0 && (
        <Paper variant="outlined" sx={{ p: 1, mb: 2, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.06), display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography variant="body2" sx={{ fontWeight: 700, px: 1 }}>{selected.size} selected</Typography>
          <Button size="small" startIcon={<ArchiveRounded />} onClick={() => setConfirm({ kind: "bulkArchive", ids: [...selected], reason: "", label: `${selected.size} cables` })}>Archive</Button>
          <Button size="small" color="error" startIcon={<DeleteOutlineRounded />} onClick={() => setConfirm({ kind: "bulkDelete", ids: [...selected], reason: "", label: `${selected.size} cables` })}>Delete</Button>
          <Button size="small" onClick={clearSel}>Clear</Button>
        </Paper>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}

      {view === "cards" && (
        <Grid container spacing={1.5}>
          {loading && Array.from({ length: 6 }).map((_, i) => (<Grid item xs={12} sm={6} md={4} key={i}><Skeleton variant="rounded" height={190} /></Grid>))}
          {!loading && filtered.length === 0 && (
            <Grid item xs={12}><Paper variant="outlined" sx={{ p: 5, textAlign: "center" }}>
              <CableIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
              <Typography color="text.secondary">No cables match. Adjust filters or add one.</Typography>
            </Paper></Grid>
          )}
          {!loading && filtered.map((c) => (
            <Grid item xs={12} sm={6} md={4} key={c.id}>
              <Card variant="outlined" sx={{ borderRadius: 2, height: "100%", opacity: c.archived_at ? 0.6 : 1 }}>
                <CardContent sx={{ pb: 1 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Checkbox size="small" sx={{ p: 0.5 }} checked={selected.has(c.id)} onChange={() => toggleSel(c.id)} />
                      <Box>
                        <Typography sx={{ fontWeight: 800, lineHeight: 1.1 }}>{c.cable_code}</Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>{c.cable_name || "—"}</Typography>
                      </Box>
                    </Stack>
                    {c.is_power_cord && <Chip size="small" icon={<BoltRounded />} label="Power cord" color="secondary" variant="outlined" />}
                  </Stack>

                  <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={`${n2(c.copper_area_sqmm)} mm²`} />
                    <Chip size="small" label={`${c.cores || 1}C ${(c.flat_round || "round")}`} sx={{ textTransform: "capitalize" }} />
                    {c.strand_construction && <Chip size="small" variant="outlined" label={c.strand_construction} />}
                    {c.voltage && <Chip size="small" variant="outlined" label={c.voltage} />}
                  </Stack>

                  <Grid container spacing={0.5} sx={{ mt: 0.5 }}>
                    <Spec label="Finished OD" value={`${n2(c.finished_od)} mm`} />
                    <Spec label="Weight/m" value={`${c.weight_per_meter ? Number(c.weight_per_meter).toFixed(3) : "—"} kg`} />
                    <Spec label="Std length" value={c.standard_length_m ? `${c.standard_length_m} m` : "—"} />
                    <Spec label="Ins / Sheath" value={`${n2(c.insulation_thickness)} / ${n2(c.sheath_thickness)}`} />
                  </Grid>

                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">Colours:</Typography>
                    {(c.colour_combination || []).length ? colourDots(c.colour_combination) : <Typography variant="caption">—</Typography>}
                    {c.archived_at && <Chip size="small" variant="outlined" label="Archived" sx={{ ml: "auto" }} />}
                  </Stack>
                </CardContent>
                <Box sx={{ px: 1, pb: 1, display: "flex", justifyContent: "flex-end" }}>{actionBtns(c)}</Box>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {view === "table" && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
          <TableContainer>
            <Table size="small" stickyHeader>
              <TableHead><TableRow>
                <TableCell padding="checkbox" />
                {["Code", "Name", "Size", "Cores", "Shape", "Fin OD", "Wt/m", "Colours", "Actions"].map((h) => <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>{h}</TableCell>)}
              </TableRow></TableHead>
              <TableBody>
                {!loading && filtered.map((c) => (
                  <TableRow key={c.id} hover sx={{ opacity: c.archived_at ? 0.6 : 1 }}>
                    <TableCell padding="checkbox"><Checkbox size="small" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)} /></TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{c.cable_code}</TableCell>
                    <TableCell>{c.cable_name || "—"}</TableCell>
                    <TableCell>{n2(c.copper_area_sqmm)}</TableCell>
                    <TableCell>{c.cores || 1}</TableCell>
                    <TableCell sx={{ textTransform: "capitalize" }}>{c.flat_round || "round"}</TableCell>
                    <TableCell>{n2(c.finished_od)}</TableCell>
                    <TableCell>{c.weight_per_meter ? Number(c.weight_per_meter).toFixed(3) : "—"}</TableCell>
                    <TableCell>{colourDots(c.colour_combination)}</TableCell>
                    <TableCell>{actionBtns(c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* create / edit dialog with live preview */}
      <Dialog open={!!dialog} onClose={() => !saving && setDialog(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{dialog?.isNew ? "New cable" : `Edit ${dialog?.form?.cable_code || "cable"}`}</DialogTitle>
        <DialogContent dividers>
          {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
          {dialog && (
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}><TextField label="Cable code" required fullWidth size="small" value={dialog.form.cable_code || ""} onChange={(e) => setField("cable_code", e.target.value)} /></Grid>
              <Grid item xs={12} sm={5}><TextField label="Cable name" fullWidth size="small" value={dialog.form.cable_name || ""} onChange={(e) => setField("cable_name", e.target.value)} /></Grid>
              <Grid item xs={6} sm={3}><TextField select label="Shape" fullWidth size="small" value={dialog.form.flat_round || "round"} onChange={(e) => setField("flat_round", e.target.value)}><MenuItem value="round">Round</MenuItem><MenuItem value="flat">Flat</MenuItem></TextField></Grid>
              <Grid item xs={6} sm={3}><TextField label="Cores" type="number" fullWidth size="small" value={dialog.form.cores ?? ""} onChange={(e) => setField("cores", e.target.value)} /></Grid>
              <Grid item xs={6} sm={3}><TextField label="Copper area (mm²)" type="number" fullWidth size="small" value={dialog.form.copper_area_sqmm ?? ""} onChange={(e) => setField("copper_area_sqmm", e.target.value)} /></Grid>
              <Grid item xs={6} sm={3}><TextField label="Strand (e.g. 30/0.25)" fullWidth size="small" value={dialog.form.strand_construction || ""} onChange={(e) => setField("strand_construction", e.target.value)} /></Grid>
              <Grid item xs={6} sm={3}><TextField label="Voltage" fullWidth size="small" value={dialog.form.voltage || ""} onChange={(e) => setField("voltage", e.target.value)} /></Grid>
              <Grid item xs={6} sm={3}><TextField label="Insulation th (mm)" type="number" fullWidth size="small" value={dialog.form.insulation_thickness ?? ""} onChange={(e) => setField("insulation_thickness", e.target.value)} /></Grid>
              <Grid item xs={6} sm={3}><TextField label="Sheath th (mm)" type="number" fullWidth size="small" value={dialog.form.sheath_thickness ?? ""} onChange={(e) => setField("sheath_thickness", e.target.value)} /></Grid>
              <Grid item xs={6} sm={3}><TextField label="Std length (m)" type="number" fullWidth size="small" value={dialog.form.standard_length_m ?? ""} onChange={(e) => setField("standard_length_m", e.target.value)} /></Grid>
              <Grid item xs={12} sm={6}>
                <Autocomplete multiple size="small" options={COLOUR_OPTIONS} freeSolo value={dialog.form.colour_combination || []}
                  onChange={(_, v) => setField("colour_combination", v)}
                  renderInput={(p) => <TextField {...p} label="Colour combination" />} />
              </Grid>
              <Grid item xs={6} sm={3}><FormControlLabel control={<Checkbox checked={!!dialog.form.is_power_cord} onChange={(e) => setField("is_power_cord", e.target.checked)} />} label="Power cord" /></Grid>
              {dialog.form.is_power_cord && <Grid item xs={6} sm={3}><TextField label="Cord length (m)" type="number" fullWidth size="small" value={dialog.form.cord_length ?? ""} onChange={(e) => setField("cord_length", e.target.value)} /></Grid>}
              <Grid item xs={12}><TextField label="Notes" fullWidth size="small" multiline minRows={1} value={dialog.form.notes || ""} onChange={(e) => setField("notes", e.target.value)} /></Grid>

              {preview && (
                <Grid item xs={12}>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.04) }}>
                    <Typography variant="caption" sx={{ fontWeight: 800, color: "primary.main" }}>AUTO-COMPUTED (leave OD/weight blank to use these)</Typography>
                    <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ mt: 0.5 }}>
                      <Typography variant="body2">Conductor OD <b>{n2(preview.conductor_od)}</b></Typography>
                      <Typography variant="body2">Core OD <b>{n2(preview.core_od)}</b></Typography>
                      <Typography variant="body2">Finished OD <b>{n2(preview.finished_od)}</b></Typography>
                      <Typography variant="body2">Weight/m <b>{Number(preview.weight_per_meter).toFixed(3)} kg</b></Typography>
                      <Divider orientation="vertical" flexItem />
                      <Typography variant="body2" color="text.secondary">BOM/m: Cu {Number(preview.rm.copper).toFixed(3)} · Ins {Number(preview.rm.ins).toFixed(3)} · Sheath {Number(preview.rm.sh).toFixed(3)} kg</Typography>
                    </Stack>
                  </Paper>
                </Grid>
              )}
            </Grid>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!confirm} onClose={() => !saving && setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{confirm?.kind.includes("archive") ? "Archive" : "Delete"} {confirm?.label}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {confirm?.kind.includes("archive") ? "Archived cables are hidden from planning but kept for history and can be restored." : "This permanently deletes the cable. This cannot be undone."}
          </Typography>
          <TextField label="Reason (recorded in history)" fullWidth size="small" multiline minRows={2} value={confirm?.reason || ""} onChange={(e) => setConfirm((c) => ({ ...c, reason: e.target.value }))} />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setConfirm(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" color={confirm?.kind.includes("delete") ? "error" : "warning"} onClick={runConfirm} disabled={saving}>{saving ? "Working…" : confirm?.kind.includes("archive") ? "Archive" : "Delete"}</Button>
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
