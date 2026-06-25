// Molding fleet editor (IE P3). Manage the shared molding machines that the
// Assembly Planner reads for pool capacity. Add/edit/delete; per-machine daily
// capacity is shown live.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Stack, Typography,
  Button, TextField, MenuItem, IconButton, Tooltip, Chip, CircularProgress,
  FormControlLabel, Switch, Divider,
} from '@mui/material';
import { AddRounded, DeleteOutlineRounded, EditRounded } from '@mui/icons-material';
import ieService from '../../services/ieService';
import { machineDailyCapacity } from '../../services/ie/moldingPool';

const TYPES = ['inner', 'outer', 'grommet'];
const blank = () => ({ machine_code: '', name: '', mold_type: 'inner', cycle_time_sec: '', cavities: 1, available_hours: 8, is_active: true });
const fmt = (x) => Math.round(Number(x) || 0).toLocaleString('en-IN');

export default function MoldingFleetDialog({ open, onClose, onSaved }) {
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(blank());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setMachines(await ieService.listMoldingMachines() || []); }
    catch { setMachines([]); }
    setLoading(false);
  }, []);
  useEffect(() => { if (open) { load(); setDraft(blank()); } }, [open, load]);

  const setF = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const save = async () => {
    if (!draft.machine_code.trim()) return;
    setBusy(true);
    try { await ieService.saveMoldingMachine(draft); setDraft(blank()); await load(); }
    catch { /* non-blocking */ }
    finally { setBusy(false); }
  };

  const remove = async (m) => {
    if (!window.confirm(`Delete ${m.machine_code || 'machine'}?`)) return;
    try { await ieService.deleteMoldingMachine(m.id); await load(); } catch { /* ignore */ }
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose?.()} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Molding fleet (shared pool)</DialogTitle>
      <DialogContent dividers>
        {loading ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={22} /></Box> : (
          <Stack spacing={1} sx={{ mb: 2 }}>
            {machines.length === 0 && <Typography variant="body2" color="text.secondary">No machines yet — add the cell below.</Typography>}
            {machines.map((m) => (
              <Stack key={m.id} direction="row" alignItems="center" spacing={1} sx={{ p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{m.machine_code}</Typography>
                    <Chip size="small" label={m.mold_type} sx={{ height: 18, textTransform: 'capitalize' }} />
                    {m.is_active === false && <Chip size="small" color="default" variant="outlined" label="inactive" sx={{ height: 18 }} />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">{m.name || '—'} · {m.cycle_time_sec}s × {m.cavities} cav × {m.available_hours}h = {fmt(machineDailyCapacity(m))}/day</Typography>
                </Box>
                <Tooltip title="Edit"><IconButton size="small" onClick={() => setDraft({ ...blank(), ...m, cycle_time_sec: m.cycle_time_sec ?? '' })}><EditRounded fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Delete"><IconButton size="small" onClick={() => remove(m)}><DeleteOutlineRounded fontSize="small" /></IconButton></Tooltip>
              </Stack>
            ))}
          </Stack>
        )}

        <Divider sx={{ mb: 2 }}><Chip label={draft.id ? 'Edit machine' : 'Add machine'} size="small" /></Divider>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Machine code" value={draft.machine_code} onChange={setF('machine_code')} fullWidth size="small" />
            <TextField label="Name" value={draft.name} onChange={setF('name')} fullWidth size="small" />
            <TextField select label="Mold type" value={draft.mold_type} onChange={setF('mold_type')} fullWidth size="small">
              {TYPES.map((t) => <MenuItem key={t} value={t} sx={{ textTransform: 'capitalize' }}>{t}</MenuItem>)}
            </TextField>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
            <TextField label="Cycle (sec)" type="number" value={draft.cycle_time_sec} onChange={setF('cycle_time_sec')} fullWidth size="small" />
            <TextField label="Cavities" type="number" value={draft.cavities} onChange={setF('cavities')} fullWidth size="small" />
            <TextField label="Hours/day" type="number" value={draft.available_hours} onChange={setF('available_hours')} fullWidth size="small" />
            <FormControlLabel control={<Switch checked={draft.is_active !== false} onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))} />} label="Active" />
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" startIcon={<AddRounded />} onClick={save} disabled={busy || !draft.machine_code.trim()}>{draft.id ? 'Update' : 'Add'}</Button>
            {draft.id && <Button onClick={() => setDraft(blank())} disabled={busy}>New</Button>}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => { onSaved?.(); onClose?.(); }} variant="contained">Done</Button>
      </DialogActions>
    </Dialog>
  );
}
