// Generic, config-driven master-data workspace (UX overhaul Wave 2+). Give it a
// service + a field/column/filter config and it provides the full planner-grade
// pattern: card & table views, search + status + custom filters + sort, visible
// Add / Edit / Duplicate / Archive / Delete / History, bulk actions, single-step
// dialog (field-driven), and reason-logged destructive actions. Used by Colour /
// Size / Material / Preset / Rule masters so each is ~a config, not new code.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Paper, Typography, Button, TextField, InputAdornment, Stack, Grid, Card, CardContent,
  Chip, Checkbox, IconButton, Tooltip, Skeleton, Alert, MenuItem, Autocomplete, FormControlLabel,
  Switch, ToggleButton, ToggleButtonGroup, Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, Dialog, DialogTitle, DialogContent, DialogActions, useTheme, alpha,
} from "@mui/material";
import {
  Add as AddIcon, Search as SearchIcon, Edit as EditIcon, ContentCopyRounded, ArchiveRounded,
  UnarchiveRounded, DeleteOutlineRounded, HistoryRounded, ViewModuleRounded, ViewListRounded,
  Inventory2Rounded,
} from "@mui/icons-material";
import { setAuditReason } from "../../../services/masterAuditService";
import MasterHistoryDrawer from "./MasterHistoryDrawer";

const get = (row, key) => (key.includes(".") ? key.split(".").reduce((o, k) => (o ? o[k] : undefined), row) : row[key]);

export default function MasterScreen({
  tableName, title, subtitle, icon, service, codeField = "code", nameField = "name",
  searchFields = [codeField, nameField], filters = [], sortOptions = [], emptyForm = {},
  formFields = [], renderCardBody, columns = [], defaultView = "cards",
}) {
  const theme = useTheme();
  const Icon = icon || Inventory2Rounded;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [view, setView] = useState(defaultView);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [filterVals, setFilterVals] = useState({});
  const [sortKey, setSortKey] = useState(sortOptions[0]?.value || codeField);
  const [selected, setSelected] = useState(new Set());

  const [dialog, setDialog] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [history, setHistory] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setRows(await service.list() || []); }
    catch (e) { setError(e.message || "Failed to load."); }
    finally { setLoading(false); }
  }, [service]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (statusFilter === "active" && r.archived_at) return false;
      if (statusFilter === "archived" && !r.archived_at) return false;
      for (const f of filters) {
        const v = filterVals[f.key];
        if (v && v !== "all" && !f.test(r, v)) return false;
      }
      if (q && !searchFields.some((k) => String(get(r, k) ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
    const so = sortOptions.find((s) => s.value === sortKey);
    if (so?.compare) out = [...out].sort(so.compare);
    else out = [...out].sort((a, b) => String(get(a, codeField) ?? "").localeCompare(String(get(b, codeField) ?? "")));
    return out;
  }, [rows, search, statusFilter, filterVals, sortKey, filters, sortOptions, searchFields, codeField]);

  const toggleSel = (id) => setSelected((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const clearSel = () => setSelected(new Set());

  const openNew = () => { setDialogError(""); setDialog({ form: { ...emptyForm }, isNew: true }); };
  const openEdit = (row) => { setDialogError(""); setDialog({ form: { ...emptyForm, ...row }, isNew: false }); };
  const openDup = (row) => { setDialogError(""); setDialog({ form: { ...emptyForm, ...row, id: undefined, archived_at: null, [codeField]: `${get(row, codeField) || "COPY"}-2` }, isNew: true }); };
  const setField = (k, v) => setDialog((d) => ({ ...d, form: { ...d.form, [k]: v } }));

  const handleSave = async () => {
    setDialogError("");
    if (codeField && !String(dialog.form[codeField] || "").trim()) { setDialogError(`${codeField} is required.`); return; }
    setSaving(true);
    try {
      const f = { ...dialog.form };
      formFields.forEach((ff) => { if (ff.type === "number" && f[ff.key] !== undefined) f[ff.key] = f[ff.key] === "" || f[ff.key] === null ? null : Number(f[ff.key]); });
      await service.save(f); setDialog(null); await load();
    } catch (e) { setDialogError(e.message || "Save failed."); }
    finally { setSaving(false); }
  };
  const restore = async (row) => { await service.archive(row.id, false); load(); };

  const runConfirm = async () => {
    const { kind, ids, reason } = confirm; setSaving(true);
    try {
      for (const id of ids) {
        if (kind.includes("archive")) await service.archive(id, true); else await service.delete(id);
        if (reason) await setAuditReason(tableName, id, reason);
      }
      setConfirm(null); clearSel(); await load();
    } catch (e) { setError(e.message || "Action failed."); }
    finally { setSaving(false); }
  };

  const actionBtns = (r) => (
    <Stack direction="row" spacing={0.25}>
      <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(r)}><EditIcon fontSize="small" /></IconButton></Tooltip>
      <Tooltip title="Duplicate"><IconButton size="small" onClick={() => openDup(r)}><ContentCopyRounded fontSize="small" /></IconButton></Tooltip>
      {r.archived_at
        ? <Tooltip title="Restore"><IconButton size="small" color="primary" onClick={() => restore(r)}><UnarchiveRounded fontSize="small" /></IconButton></Tooltip>
        : <Tooltip title="Archive"><IconButton size="small" onClick={() => setConfirm({ kind: "archive", ids: [r.id], reason: "", label: get(r, codeField) })}><ArchiveRounded fontSize="small" /></IconButton></Tooltip>}
      <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setConfirm({ kind: "delete", ids: [r.id], reason: "", label: get(r, codeField) })}><DeleteOutlineRounded fontSize="small" /></IconButton></Tooltip>
      <Tooltip title="History"><IconButton size="small" onClick={() => setHistory({ recordId: r.id, title: `${get(r, codeField)} — ${get(r, nameField) || ""}` })}><HistoryRounded fontSize="small" /></IconButton></Tooltip>
    </Stack>
  );

  const formField = (ff) => {
    if (ff.showIf && !ff.showIf(dialog.form)) return null;
    const v = dialog.form[ff.key];
    const common = { fullWidth: true, size: "small", label: ff.label };
    let control;
    if (ff.type === "select") control = <TextField select {...common} value={v ?? ""} onChange={(e) => setField(ff.key, e.target.value)}>{(ff.options || []).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}</TextField>;
    else if (ff.type === "switch") control = <FormControlLabel control={<Switch checked={!!v} onChange={(e) => setField(ff.key, e.target.checked)} />} label={ff.label} />;
    else if (ff.type === "multiselect") control = <Autocomplete multiple freeSolo size="small" options={ff.options || []} value={v || []} onChange={(_, nv) => setField(ff.key, nv)} renderInput={(p) => <TextField {...p} label={ff.label} />} />;
    else if (ff.type === "textarea") control = <TextField {...common} multiline minRows={ff.rows || 2} value={v ?? ""} onChange={(e) => setField(ff.key, e.target.value)} />;
    else control = <TextField {...common} type={ff.type === "number" ? "number" : "text"} value={v ?? ""} onChange={(e) => setField(ff.key, e.target.value)} required={ff.key === codeField} InputProps={ff.adornment ? { startAdornment: <InputAdornment position="start">{ff.adornment}</InputAdornment> } : undefined} />;
    return <Grid item xs={ff.xs || 12} sm={ff.sm || 6} key={ff.key}>{control}</Grid>;
  };

  return (
    <Box>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1.5} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>{title}</Typography>
          <Typography variant="body2" color="text.secondary">{filtered.length} record{filtered.length === 1 ? "" : "s"}{subtitle ? ` · ${subtitle}` : ""}</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
            <ToggleButton value="cards"><ViewModuleRounded fontSize="small" /></ToggleButton>
            <ToggleButton value="table"><ViewListRounded fontSize="small" /></ToggleButton>
          </ToggleButtonGroup>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>Add</Button>
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }} flexWrap="wrap" useFlexGap>
          <TextField size="small" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} sx={{ minWidth: 220 }} />
          {filters.map((f) => (
            <TextField key={f.key} select size="small" label={f.label} value={filterVals[f.key] || "all"} onChange={(e) => setFilterVals((p) => ({ ...p, [f.key]: e.target.value }))} sx={{ minWidth: 130 }}>
              <MenuItem value="all">All</MenuItem>
              {f.options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </TextField>
          ))}
          <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 120 }}>
            <MenuItem value="active">Active</MenuItem><MenuItem value="archived">Archived</MenuItem><MenuItem value="all">All</MenuItem>
          </TextField>
          {sortOptions.length > 0 && (
            <TextField select size="small" label="Sort" value={sortKey} onChange={(e) => setSortKey(e.target.value)} sx={{ minWidth: 120 }}>
              {sortOptions.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
            </TextField>
          )}
        </Stack>
      </Paper>

      {selected.size > 0 && (
        <Paper variant="outlined" sx={{ p: 1, mb: 2, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.06), display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography variant="body2" sx={{ fontWeight: 700, px: 1 }}>{selected.size} selected</Typography>
          <Button size="small" startIcon={<ArchiveRounded />} onClick={() => setConfirm({ kind: "bulkArchive", ids: [...selected], reason: "", label: `${selected.size} records` })}>Archive</Button>
          <Button size="small" color="error" startIcon={<DeleteOutlineRounded />} onClick={() => setConfirm({ kind: "bulkDelete", ids: [...selected], reason: "", label: `${selected.size} records` })}>Delete</Button>
          <Button size="small" onClick={clearSel}>Clear</Button>
        </Paper>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}

      {view === "cards" && (
        <Grid container spacing={1.5}>
          {loading && Array.from({ length: 6 }).map((_, i) => <Grid item xs={12} sm={6} md={4} key={i}><Skeleton variant="rounded" height={150} /></Grid>)}
          {!loading && filtered.length === 0 && (
            <Grid item xs={12}><Paper variant="outlined" sx={{ p: 5, textAlign: "center" }}><Icon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} /><Typography color="text.secondary">No records. Adjust filters or add one.</Typography></Paper></Grid>
          )}
          {!loading && filtered.map((r) => (
            <Grid item xs={12} sm={6} md={4} key={r.id}>
              <Card variant="outlined" sx={{ borderRadius: 2, height: "100%", opacity: r.archived_at ? 0.6 : 1 }}>
                <CardContent sx={{ pb: 1 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Checkbox size="small" sx={{ p: 0.5 }} checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} />
                      <Box>
                        <Typography sx={{ fontWeight: 800, lineHeight: 1.1 }}>{get(r, codeField)}</Typography>
                        {nameField && <Typography variant="caption" color="text.secondary" noWrap>{get(r, nameField) || ""}</Typography>}
                      </Box>
                    </Stack>
                    {r.archived_at && <Chip size="small" variant="outlined" label="Archived" />}
                  </Stack>
                  {renderCardBody && <Box sx={{ mt: 1 }}>{renderCardBody(r)}</Box>}
                </CardContent>
                <Box sx={{ px: 1, pb: 1, display: "flex", justifyContent: "flex-end" }}>{actionBtns(r)}</Box>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {view === "table" && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
          <TableContainer><Table size="small" stickyHeader>
            <TableHead><TableRow>
              <TableCell padding="checkbox" />
              {columns.map((c) => <TableCell key={c.key} sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>{c.label}</TableCell>)}
              <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {!loading && filtered.map((r) => (
                <TableRow key={r.id} hover sx={{ opacity: r.archived_at ? 0.6 : 1 }}>
                  <TableCell padding="checkbox"><Checkbox size="small" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} /></TableCell>
                  {columns.map((c) => <TableCell key={c.key}>{c.render ? c.render(r) : (get(r, c.key) ?? "—")}</TableCell>)}
                  <TableCell>{actionBtns(r)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table></TableContainer>
        </Paper>
      )}

      <Dialog open={!!dialog} onClose={() => !saving && setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{dialog?.isNew ? `New ${title}` : `Edit ${dialog?.form?.[codeField] || ""}`}</DialogTitle>
        <DialogContent dividers>
          {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
          {dialog && <Grid container spacing={2}>{formFields.map(formField)}</Grid>}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!confirm} onClose={() => !saving && setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{confirm?.kind.includes("archive") ? "Archive" : "Delete"} {confirm?.label}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>{confirm?.kind.includes("archive") ? "Archived records are hidden but kept for history and can be restored." : "This permanently deletes the record."}</Typography>
          <TextField label="Reason (recorded in history)" fullWidth size="small" multiline minRows={2} value={confirm?.reason || ""} onChange={(e) => setConfirm((c) => ({ ...c, reason: e.target.value }))} />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setConfirm(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" color={confirm?.kind.includes("delete") ? "error" : "warning"} onClick={runConfirm} disabled={saving}>{saving ? "Working…" : confirm?.kind.includes("archive") ? "Archive" : "Delete"}</Button>
        </DialogActions>
      </Dialog>

      <MasterHistoryDrawer open={!!history} onClose={() => setHistory(null)} tableName={tableName} recordId={history?.recordId} title={history?.title} />
    </Box>
  );
}
