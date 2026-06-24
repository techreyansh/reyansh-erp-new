import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Stack, Card, CardContent, Typography, Button, IconButton, Chip, TextField, MenuItem,
  CircularProgress, Snackbar, Alert, Dialog, DialogTitle, DialogContent, DialogActions, Tooltip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Checkbox, FormControlLabel,
  useTheme,
} from '@mui/material';
import {
  Handyman as OpIcon, Add as AddIcon, Refresh as RefreshIcon, Edit as EditIcon, DeleteOutline as DelIcon,
} from '@mui/icons-material';
import mesService, { OPERATION_CATEGORIES } from '../../services/mesService';

const CAT_COLOR = { cutting: 'default', assembly: 'primary', molding: 'secondary', testing: 'warning', packing: 'info', other: 'default' };

const AssemblyOperationMaster = () => {
  const theme = useTheme();
  const [ops, setOps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [editing, setEditing] = useState(null); // null | {} | op
  const [confirmDel, setConfirmDel] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setOps(await mesService.listOperations()); }
    catch (e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const del = async () => {
    try { await mesService.deleteOperation(confirmDel.id); setSnackbar({ open: true, message: 'Operation deleted.', severity: 'success' }); setConfirmDel(null); await load(); }
    catch (e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Card sx={{ background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`, color: 'white', borderRadius: 3, mb: 2 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, py: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <OpIcon sx={{ fontSize: 32 }} />
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>Assembly Operation Master</Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>The catalogue of operations your product routings are built from.</Typography>
            </Box>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button onClick={() => setEditing({})} startIcon={<AddIcon />} variant="contained" color="inherit" sx={{ color: theme.palette.primary.main }}>New operation</Button>
            <Tooltip title="Refresh"><IconButton onClick={load} sx={{ color: 'white' }}><RefreshIcon /></IconButton></Tooltip>
          </Stack>
        </CardContent>
      </Card>

      {loading ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box> : (
        <Card sx={{ borderRadius: 2 }}><CardContent>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
            <Table size="small">
              <TableHead><TableRow>{['Operation', 'Category', 'Std time (s)', 'UPH', 'Men', 'Tools', 'QC', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {ops.map((o) => (
                  <TableRow key={o.id} hover sx={{ opacity: o.is_active ? 1 : 0.5 }}>
                    <TableCell sx={{ fontWeight: 600 }}>{o.name}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{o.operation_code}</Typography></TableCell>
                    <TableCell><Chip size="small" label={o.category} color={CAT_COLOR[o.category]} sx={{ height: 20 }} /></TableCell>
                    <TableCell>{o.std_time_sec ?? '—'}</TableCell>
                    <TableCell>{o.uph ?? '—'}</TableCell>
                    <TableCell>{o.manpower_reqd ?? '—'}</TableCell>
                    <TableCell><Typography variant="caption" color="text.secondary">{o.tools_reqd || '—'}</Typography></TableCell>
                    <TableCell>{o.quality_critical ? <Chip size="small" color="warning" label="critical" sx={{ height: 18 }} /> : '—'}</TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => setEditing(o)}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => setConfirmDel(o)}><DelIcon fontSize="small" /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {ops.length === 0 && <TableRow><TableCell colSpan={8} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>No operations yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent></Card>
      )}

      <OperationDialog op={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} notify={setSnackbar} />

      <Dialog open={!!confirmDel} onClose={() => setConfirmDel(null)}>
        <DialogTitle>Delete operation?</DialogTitle>
        <DialogContent><Typography variant="body2">Remove <b>{confirmDel?.name}</b> from the catalogue? Routings already using it keep their step text.</Typography></DialogContent>
        <DialogActions><Button onClick={() => setConfirmDel(null)}>Cancel</Button><Button color="error" variant="contained" onClick={del}>Delete</Button></DialogActions>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
};

function OperationDialog({ op, onClose, onSaved, notify }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (op) setForm({ category: 'assembly', quality_critical: false, is_active: true, ...op }); }, [op]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    if (!form.name?.trim()) { notify({ open: true, message: 'Name is required.', severity: 'warning' }); return; }
    setSaving(true);
    try { await mesService.saveOperation(form); notify({ open: true, message: 'Operation saved.', severity: 'success' }); onSaved(); }
    catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setSaving(false);
  };
  return (
    <Dialog open={!!op} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{op?.id ? 'Edit operation' : 'New operation'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Name" value={form.name || ''} onChange={set('name')} fullWidth autoFocus />
            <TextField select label="Category" value={form.category || 'assembly'} onChange={set('category')} sx={{ minWidth: 140 }}>
              {OPERATION_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
          </Stack>
          <TextField label="Operation code" value={form.operation_code || ''} onChange={set('operation_code')} fullWidth helperText="Unique key (e.g. pin_crimping)" />
          <Stack direction="row" spacing={2}>
            <TextField type="number" label="Std time (s)" value={form.std_time_sec ?? ''} onChange={set('std_time_sec')} fullWidth />
            <TextField type="number" label="UPH" value={form.uph ?? ''} onChange={set('uph')} fullWidth />
            <TextField type="number" label="Manpower" value={form.manpower_reqd ?? ''} onChange={set('manpower_reqd')} fullWidth />
          </Stack>
          <TextField label="Tools required" value={form.tools_reqd || ''} onChange={set('tools_reqd')} fullWidth />
          <FormControlLabel control={<Checkbox checked={!!form.quality_critical} onChange={(e) => setForm((f) => ({ ...f, quality_critical: e.target.checked }))} />} label="Quality critical" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={submit} variant="contained" disabled={saving}>{saving ? <CircularProgress size={20} /> : 'Save'}</Button>
      </DialogActions>
    </Dialog>
  );
}

export default AssemblyOperationMaster;
