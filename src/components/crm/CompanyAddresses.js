// Multiple typed addresses for a CRM account (CRM 360 P3). List as cards by type
// with add/edit/delete, set-default, and a Google Maps link. Reusable.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Stack, Typography, Button, Card, CardContent, Chip, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  FormControlLabel, Switch, CircularProgress, Snackbar, Alert,
} from '@mui/material';
import {
  AddRounded, EditRounded, DeleteOutlineRounded, StarRounded, StarBorderRounded, PlaceRounded,
} from '@mui/icons-material';
import crmPipelineService from '../../services/crmPipelineService';

const TYPES = ['registered', 'corporate', 'factory', 'warehouse', 'billing', 'shipping'];
const TYPE_LABEL = { registered: 'Registered Office', corporate: 'Corporate Office', factory: 'Factory', warehouse: 'Warehouse', billing: 'Billing', shipping: 'Shipping' };
const blank = () => ({ address_type: 'registered', line1: '', line2: '', city: '', state: '', pincode: '', country: 'India', gstin: '', maps_url: '', is_default: false });

export default function CompanyAddresses({ accountId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try { setRows(await crmPipelineService.listAddresses(accountId) || []); }
    catch { setRows([]); }
    setLoading(false);
  }, [accountId]);
  useEffect(() => { load(); }, [load]);

  const setF = (k) => (e) => setEdit((d) => ({ ...d, [k]: e.target.value }));

  const save = async () => {
    if (!edit.line1.trim()) { setSnack({ severity: 'error', message: 'Address line 1 is required.' }); return; }
    setBusy(true);
    try {
      if (edit.id) await crmPipelineService.updateAddress(edit.id, edit);
      else await crmPipelineService.addAddress(accountId, edit);
      setEdit(null); await load();
      setSnack({ severity: 'success', message: 'Address saved.' });
    } catch (e) { setSnack({ severity: 'error', message: e?.message || 'Save failed.' }); }
    finally { setBusy(false); }
  };

  const remove = async (a) => {
    if (!window.confirm('Delete this address?')) return;
    try { await crmPipelineService.deleteAddress(a.id); await load(); }
    catch (e) { setSnack({ severity: 'error', message: e?.message || 'Delete failed.' }); }
  };

  const makeDefault = async (a) => {
    try {
      const cur = rows.find((x) => x.is_default && x.id !== a.id);
      if (cur) await crmPipelineService.updateAddress(cur.id, { is_default: false });
      await crmPipelineService.updateAddress(a.id, { is_default: true });
      await load();
    } catch (e) { setSnack({ severity: 'error', message: e?.message || 'Could not set default.' }); }
  };

  const oneLine = (a) => [a.line1, a.line2, a.city, a.state, a.pincode, a.country].filter(Boolean).join(', ');

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={22} /></Box>;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Addresses ({rows.length})</Typography>
        <Button size="small" variant="outlined" startIcon={<AddRounded />} onClick={() => setEdit(blank())}>Add address</Button>
      </Stack>

      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No addresses yet — add registered office, factory, warehouse, billing/shipping as needed.</Typography>
      ) : (
        <Stack spacing={1}>
          {rows.map((a) => (
            <Card key={a.id} variant="outlined">
              <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Chip size="small" label={TYPE_LABEL[a.address_type] || a.address_type} sx={{ height: 18 }} />
                      {a.is_default && <Chip size="small" color="primary" label="Default" sx={{ height: 18 }} />}
                    </Stack>
                    <Typography variant="body2" sx={{ mt: 0.5 }}>{oneLine(a)}</Typography>
                    {a.gstin && <Typography variant="caption" color="text.secondary">GSTIN: {a.gstin}</Typography>}
                  </Box>
                  <Stack direction="row" spacing={0.25} flexShrink={0}>
                    {a.maps_url && <Tooltip title="Open in Maps"><IconButton size="small" component="a" href={a.maps_url} target="_blank" rel="noreferrer"><PlaceRounded fontSize="small" color="error" /></IconButton></Tooltip>}
                    <Tooltip title={a.is_default ? 'Default' : 'Set default'}><span><IconButton size="small" onClick={() => makeDefault(a)} disabled={a.is_default}>{a.is_default ? <StarRounded fontSize="small" color="primary" /> : <StarBorderRounded fontSize="small" />}</IconButton></span></Tooltip>
                    <Tooltip title="Edit"><IconButton size="small" onClick={() => setEdit({ ...blank(), ...a })}><EditRounded fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton size="small" onClick={() => remove(a)}><DeleteOutlineRounded fontSize="small" /></IconButton></Tooltip>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <Dialog open={!!edit} onClose={() => !busy && setEdit(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{edit?.id ? 'Edit address' : 'Add address'}</DialogTitle>
        <DialogContent dividers>
          {edit && (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <TextField select label="Type" value={edit.address_type} onChange={setF('address_type')} fullWidth>
                {TYPES.map((t) => <MenuItem key={t} value={t}>{TYPE_LABEL[t]}</MenuItem>)}
              </TextField>
              <TextField label="Address line 1" value={edit.line1} onChange={setF('line1')} required fullWidth />
              <TextField label="Address line 2" value={edit.line2} onChange={setF('line2')} fullWidth />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="City" value={edit.city} onChange={setF('city')} fullWidth />
                <TextField label="State" value={edit.state} onChange={setF('state')} fullWidth />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="PIN code" value={edit.pincode} onChange={setF('pincode')} fullWidth />
                <TextField label="Country" value={edit.country} onChange={setF('country')} fullWidth />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="GSTIN (optional)" value={edit.gstin} onChange={setF('gstin')} fullWidth />
                <TextField label="Google Maps link (optional)" value={edit.maps_url} onChange={setF('maps_url')} fullWidth />
              </Stack>
              <FormControlLabel control={<Switch checked={!!edit.is_default} onChange={(e) => setEdit((d) => ({ ...d, is_default: e.target.checked }))} />} label="Default address" />
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEdit(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
