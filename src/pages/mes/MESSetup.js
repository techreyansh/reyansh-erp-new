import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Stack, Card, CardContent, Typography, Button, IconButton, Chip, TextField, MenuItem,
  CircularProgress, Snackbar, Alert, Dialog, DialogTitle, DialogContent, DialogActions, Checkbox,
  FormControlLabel, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  Tooltip, useTheme,
} from '@mui/material';
import {
  Settings as SetupIcon, Add as AddIcon, Edit as EditIcon, DeleteOutline as DelIcon,
  ArrowBack as BackIcon, Refresh as RefreshIcon, Handyman as OpIcon,
} from '@mui/icons-material';
import mesMasterService from '../../services/mesMasterService';

// Each master: table + fields (form) + cols (table view). Selects can be static
// (options) or dynamic (source: {table,label,value}).
const MASTERS = [
  {
    key: 'molding', title: 'Molding Master', table: 'molding_master', group: 'Molding & Packing',
    cols: ['mold_number', 'mold_type', 'cavity_count', 'cycle_time_sec', 'status'],
    fields: [
      { k: 'mold_number', l: 'Mold number' }, { k: 'customer_code', l: 'Customer code' },
      { k: 'mold_type', l: 'Type', type: 'select', options: ['inner', 'outer', 'grommet'] },
      { k: 'cavity_count', l: 'Cavities', type: 'number' }, { k: 'cycle_time_sec', l: 'Cycle (s)', type: 'number' },
      { k: 'tool_life_shots', l: 'Tool life (shots)', type: 'number' }, { k: 'shots_done', l: 'Shots done', type: 'number' },
      { k: 'machine_compat', l: 'Machine compatibility' }, { k: 'location', l: 'Location' },
      { k: 'status', l: 'Status', type: 'select', options: ['active', 'maintenance', 'retired'] },
      { k: 'notes', l: 'Notes' },
    ],
  },
  {
    key: 'packing', title: 'Packing Master', table: 'packing_master', group: 'Molding & Packing',
    cols: ['name', 'packing_type', 'cycle_time_sec', 'manpower_reqd'],
    fields: [
      { k: 'code', l: 'Code' }, { k: 'name', l: 'Name', required: true },
      { k: 'packing_type', l: 'Type', type: 'select', options: ['poly', 'individual', 'master'] },
      { k: 'cycle_time_sec', l: 'Cycle (s)', type: 'number' }, { k: 'manpower_reqd', l: 'Manpower', type: 'number' },
      { k: 'min_batch_qty', l: 'Min batch', type: 'number' }, { k: 'box_dimensions', l: 'Box dimensions' },
      { k: 'box_weight_g', l: 'Box weight (g)', type: 'number' },
      { k: 'label_required', l: 'Label required', type: 'bool' }, { k: 'barcode_required', l: 'Barcode required', type: 'bool' },
    ],
  },
  {
    key: 'side', title: 'A/B-Side Config', table: 'assembly_side_config', group: 'Product config',
    cols: ['side', 'plug_type', 'pin_type', 'terminal_type'],
    fields: [
      { k: 'product_id', l: 'Product', type: 'select', source: { table: 'product', label: 'product_name', value: 'id' } },
      { k: 'side', l: 'Side', type: 'select', options: ['A', 'B'], required: true },
      { k: 'plug_type', l: 'Plug type' }, { k: 'pin_type', l: 'Pin type' },
      { k: 'terminal_type', l: 'Terminal type' }, { k: 'sleeve_type', l: 'Sleeve type' },
      { k: 'cycle_time_sec', l: 'Cycle (s)', type: 'number' }, { k: 'quality_notes', l: 'Quality notes' },
    ],
  },
  {
    key: 'shift', title: 'Shift Master', table: 'shift_master', group: 'Organisation',
    cols: ['name', 'start_hour', 'end_hour', 'shift_hours'],
    fields: [
      { k: 'code', l: 'Code' }, { k: 'name', l: 'Name', required: true },
      { k: 'start_hour', l: 'Start hour', type: 'number' }, { k: 'end_hour', l: 'End hour', type: 'number' },
      { k: 'shift_hours', l: 'Shift hours', type: 'number' }, { k: 'days_per_week', l: 'Days/week', type: 'number' },
    ],
  },
  {
    key: 'department', title: 'Department', table: 'department', group: 'Organisation',
    cols: ['code', 'name', 'manager_email'],
    fields: [{ k: 'code', l: 'Code' }, { k: 'name', l: 'Name', required: true }, { k: 'manager_email', l: 'Manager email' }],
  },
  {
    key: 'workstation', title: 'Workstation', table: 'workstation', group: 'Organisation',
    cols: ['name', 'stage', 'capacity_per_hour', 'operators'],
    fields: [
      { k: 'code', l: 'Code' }, { k: 'name', l: 'Name', required: true },
      { k: 'department_id', l: 'Department', type: 'select', source: { table: 'department', label: 'name', value: 'id' } },
      { k: 'machine_id', l: 'Machine', type: 'select', source: { table: 'ppc_machines', label: 'name', value: 'id' } },
      { k: 'stage', l: 'Stage' }, { k: 'capacity_per_hour', l: 'Capacity/hr', type: 'number' }, { k: 'operators', l: 'Operators', type: 'number' },
    ],
  },
];
const GROUPS = ['Molding & Packing', 'Product config', 'Organisation'];

function GenericMaster({ master, notify, onBack }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [srcOpts, setSrcOpts] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await mesMasterService.listRows(master.table)); }
    catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setLoading(false);
  }, [master.table, notify]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      const out = {};
      for (const f of master.fields) {
        if (f.source) { try { out[f.k] = await mesMasterService.options(f.source.table, f.source.label, f.source.value); } catch { out[f.k] = []; } }
      }
      setSrcOpts(out);
    })();
  }, [master]);

  const del = async () => {
    try { await mesMasterService.deleteRow(master.table, confirmDel.id); notify({ open: true, message: 'Deleted.', severity: 'success' }); setConfirmDel(null); await load(); }
    catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
  };
  const fmt = (v) => (v === true ? 'Yes' : v === false ? '—' : v ?? '—');

  return (
    <Box>
      <Stack direction="row" alignItems="center" sx={{ mb: 2 }} spacing={1}>
        <IconButton onClick={onBack}><BackIcon /></IconButton>
        <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>{master.title}</Typography>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setEditing({})}>Add</Button>
        <Tooltip title="Refresh"><IconButton onClick={load}><RefreshIcon /></IconButton></Tooltip>
      </Stack>
      {loading ? <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box> : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead><TableRow>{master.cols.map((c) => <TableCell key={c} sx={{ fontWeight: 700 }}>{(master.fields.find((f) => f.k === c) || {}).l || c}</TableCell>)}<TableCell /></TableRow></TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} hover>
                  {master.cols.map((c) => <TableCell key={c}>{fmt(r[c])}</TableCell>)}
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => setEditing(r)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => setConfirmDel(r)}><DelIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={master.cols.length + 1} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>None yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <MasterDialog master={master} row={editing} srcOpts={srcOpts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} notify={notify} />
      <Dialog open={!!confirmDel} onClose={() => setConfirmDel(null)}>
        <DialogTitle>Delete?</DialogTitle>
        <DialogContent><Typography variant="body2">Delete this {master.title} record?</Typography></DialogContent>
        <DialogActions><Button onClick={() => setConfirmDel(null)}>Cancel</Button><Button color="error" variant="contained" onClick={del}>Delete</Button></DialogActions>
      </Dialog>
    </Box>
  );
}

function MasterDialog({ master, row, srcOpts, onClose, onSaved, notify }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (row) setForm({ ...row }); }, [row]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    const req = master.fields.find((f) => f.required && !String(form[f.k] ?? '').trim());
    if (req) { notify({ open: true, message: `${req.l} is required.`, severity: 'warning' }); return; }
    setSaving(true);
    try {
      const clean = { ...form };
      master.fields.forEach((f) => { if (f.type === 'number') clean[f.k] = clean[f.k] === '' || clean[f.k] == null ? null : Number(clean[f.k]); });
      await mesMasterService.saveRow(master.table, clean); notify({ open: true, message: 'Saved.', severity: 'success' }); onSaved();
    } catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setSaving(false);
  };
  return (
    <Dialog open={!!row} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{row?.id ? 'Edit' : 'New'} {master.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {master.fields.map((f) => {
            if (f.type === 'bool') return <FormControlLabel key={f.k} control={<Checkbox checked={!!form[f.k]} onChange={(e) => set(f.k, e.target.checked)} />} label={f.l} />;
            if (f.type === 'select') {
              const opts = f.options ? f.options.map((o) => ({ value: o, label: o })) : (srcOpts[f.k] || []);
              return <TextField key={f.k} select label={f.l} value={form[f.k] ?? ''} onChange={(e) => set(f.k, e.target.value)} fullWidth>
                <MenuItem value="">—</MenuItem>
                {opts.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>;
            }
            return <TextField key={f.k} label={f.l} type={f.type === 'number' ? 'number' : 'text'} value={form[f.k] ?? ''} onChange={(e) => set(f.k, e.target.value)} fullWidth />;
          })}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={submit} variant="contained" disabled={saving}>{saving ? <CircularProgress size={20} /> : 'Save'}</Button>
      </DialogActions>
    </Dialog>
  );
}

const MESSetup = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [active, setActive] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  return (
    <Box sx={{ p: 3 }}>
      <Card sx={{ background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`, color: 'white', borderRadius: 3, mb: 2 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
          <SetupIcon sx={{ fontSize: 32 }} />
          <Box><Typography variant="h5" sx={{ fontWeight: 700 }}>MES Setup</Typography>
            <Typography variant="body2" sx={{ opacity: 0.9 }}>Masters that configure how power cords are made.</Typography></Box>
        </CardContent>
      </Card>

      {active ? <GenericMaster master={active} notify={setSnackbar} onBack={() => setActive(null)} /> : (
        <Stack spacing={3}>
          <Box>
            <Typography variant="overline" color="text.secondary">Operations & Routing</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3,1fr)' }, gap: 1.5, mt: 0.5 }}>
              <Card sx={{ borderRadius: 2, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }} variant="outlined" onClick={() => navigate('/assembly-operations')}>
                <CardContent><Stack direction="row" spacing={1.5} alignItems="center"><OpIcon color="primary" /><Box><Typography sx={{ fontWeight: 700 }}>Assembly Operations</Typography><Typography variant="caption" color="text.secondary">Operation catalogue → routing</Typography></Box></Stack></CardContent>
              </Card>
            </Box>
          </Box>
          {GROUPS.map((g) => (
            <Box key={g}>
              <Typography variant="overline" color="text.secondary">{g}</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3,1fr)' }, gap: 1.5, mt: 0.5 }}>
                {MASTERS.filter((m) => m.group === g).map((m) => (
                  <Card key={m.key} sx={{ borderRadius: 2, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }} variant="outlined" onClick={() => setActive(m)}>
                    <CardContent><Typography sx={{ fontWeight: 700 }}>{m.title}</Typography><Typography variant="caption" color="text.secondary">{m.fields.length} fields</Typography></CardContent>
                  </Card>
                ))}
              </Box>
            </Box>
          ))}
        </Stack>
      )}

      <Snackbar open={snackbar.open} autoHideDuration={3500} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
};

export default MESSetup;
