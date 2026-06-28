// Inventory masters — storage Bins (per location) + per-item UoM conversions and
// home bin. Additive Phase 2; the ledger stays in base UoM. Route /inventory-masters.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, Tabs, Tab, TextField, MenuItem, Button, IconButton,
  Tooltip, Chip, Table, TableHead, TableBody, TableRow, TableCell, FormControlLabel,
  Switch, CircularProgress, Snackbar, Alert, Divider,
} from '@mui/material';
import { AddRounded, DeleteOutlineRounded, SaveRounded } from '@mui/icons-material';
import svc from '../../services/inventoryUomBinService';
import BulkImportButton from '../../components/common/BulkImport/BulkImportButton';

export default function InventoryMasters() {
  const [tab, setTab] = useState(0);
  const [snack, setSnack] = useState(null);
  const notify = (severity, message) => setSnack({ severity, message });

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>Inventory masters — Bins & UoM</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <BulkImportButton dataset="inventory_items" label="Import items (Excel)" />
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Storage bins per location, and per-item alternate units (receive/read in rolls/bags while stock stays in the base unit). Use <b>Import items</b> to bulk-add the item master + opening stock.
      </Typography>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Bins" />
        <Tab label="Item UoM & Bin" />
      </Tabs>
      {tab === 0 ? <BinsTab notify={notify} /> : <ItemTab notify={notify} />}
      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}

function BinsTab({ notify }) {
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState('');
  const [bins, setBins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ bin_code: '', description: '', is_active: true });

  const loadBins = useCallback(async (loc) => {
    setLoading(true);
    try { setBins(await svc.listBins(loc) || []); } catch { setBins([]); }
    setLoading(false);
  }, []);
  useEffect(() => {
    svc.listLocations().then((l) => { setLocations(l); if (l.length && !locationId) setLocationId(l[0].id); }).catch(() => setLocations([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (locationId) loadBins(locationId); }, [locationId, loadBins]);

  const save = async () => {
    if (!draft.bin_code.trim() || !locationId) return;
    try { await svc.saveBin({ ...draft, location_id: locationId }); setDraft({ bin_code: '', description: '', is_active: true }); await loadBins(locationId); notify('success', 'Bin saved.'); }
    catch (e) { notify('error', e?.message || 'Save failed.'); }
  };
  const remove = async (b) => { if (!window.confirm(`Delete bin ${b.bin_code}?`)) return; try { await svc.deleteBin(b.id); await loadBins(locationId); } catch (e) { notify('error', e?.message || 'Delete failed.'); } };

  return (
    <Stack spacing={2}>
      <TextField select size="small" label="Location" value={locationId} onChange={(e) => setLocationId(e.target.value)} sx={{ minWidth: 220 }}>
        {locations.map((l) => <MenuItem key={l.id} value={l.id}>{l.code} — {l.name}</MenuItem>)}
      </TextField>
      <Paper variant="outlined" sx={{ p: 2 }}>
        {loading ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={22} /></Box> : (
          <Table size="small">
            <TableHead><TableRow><TableCell>Bin</TableCell><TableCell>Description</TableCell><TableCell>Status</TableCell><TableCell /></TableRow></TableHead>
            <TableBody>
              {bins.length === 0 && <TableRow><TableCell colSpan={4}><Typography variant="body2" color="text.secondary">No bins here yet.</Typography></TableCell></TableRow>}
              {bins.map((b) => (
                <TableRow key={b.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{b.bin_code}</TableCell>
                  <TableCell>{b.description || '—'}</TableCell>
                  <TableCell>{b.is_active === false ? <Chip size="small" label="inactive" /> : <Chip size="small" color="success" variant="outlined" label="active" />}</TableCell>
                  <TableCell align="right"><Tooltip title="Delete"><IconButton size="small" onClick={() => remove(b)}><DeleteOutlineRounded fontSize="small" /></IconButton></Tooltip></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Divider sx={{ my: 2 }} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
          <TextField size="small" label="Bin code" value={draft.bin_code} onChange={(e) => setDraft((d) => ({ ...d, bin_code: e.target.value }))} />
          <TextField size="small" label="Description" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} fullWidth />
          <FormControlLabel control={<Switch checked={draft.is_active} onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))} />} label="Active" />
          <Button variant="contained" startIcon={<AddRounded />} onClick={save} disabled={!draft.bin_code.trim()}>Add bin</Button>
        </Stack>
      </Paper>
    </Stack>
  );
}

function ItemTab({ notify }) {
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = useState('');
  const [bins, setBins] = useState([]);
  const [conversions, setConversions] = useState([]);
  const [conv, setConv] = useState({ alt_uom: '', factor_to_base: '', is_default: false });
  const [loading, setLoading] = useState(true);

  const item = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);

  const reloadItems = useCallback(async () => { try { setItems(await svc.listItems() || []); } catch { setItems([]); } }, []);
  useEffect(() => {
    Promise.all([svc.listItems(), svc.listBins()]).then(([it, bn]) => {
      setItems(it || []); setBins(bn || []); if ((it || []).length && !itemId) setItemId(it[0].id); setLoading(false);
    }).catch(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (itemId) svc.listConversions(itemId).then((c) => setConversions(c || [])).catch(() => setConversions([])); }, [itemId]);

  const setHomeBin = async (binId) => { try { await svc.setItemBin(itemId, binId); await reloadItems(); notify('success', 'Home bin set.'); } catch (e) { notify('error', e?.message || 'Failed.'); } };
  const saveConv = async () => {
    if (!conv.alt_uom.trim() || !(Number(conv.factor_to_base) > 0)) return;
    try { await svc.saveConversion({ ...conv, item_id: itemId }); setConv({ alt_uom: '', factor_to_base: '', is_default: false }); setConversions(await svc.listConversions(itemId)); notify('success', 'Conversion saved.'); }
    catch (e) { notify('error', e?.message || 'Save failed.'); }
  };
  const removeConv = async (c) => { try { await svc.deleteConversion(c.id); setConversions(await svc.listConversions(itemId)); } catch (e) { notify('error', e?.message || 'Delete failed.'); } };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={22} /></Box>;

  return (
    <Stack spacing={2}>
      <TextField select size="small" label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)} sx={{ minWidth: 280 }}>
        {items.map((i) => <MenuItem key={i.id} value={i.id}>{i.code} · {i.name}</MenuItem>)}
      </TextField>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography sx={{ fontWeight: 700, mb: 1 }}>Home bin</Typography>
        <TextField select size="small" label="Home bin" value={item?.bin_id || ''} onChange={(e) => setHomeBin(e.target.value)} sx={{ minWidth: 280 }}>
          <MenuItem value="">— none —</MenuItem>
          {bins.map((b) => <MenuItem key={b.id} value={b.id}>{b.location?.code}/{b.bin_code}{b.description ? ` (${b.description})` : ''}</MenuItem>)}
        </TextField>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography sx={{ fontWeight: 700, mb: 1 }}>Alternate units (base: {item?.uom || '—'})</Typography>
        <Table size="small">
          <TableHead><TableRow><TableCell>Alt unit</TableCell><TableCell align="right">Conversion</TableCell><TableCell>Default</TableCell><TableCell /></TableRow></TableHead>
          <TableBody>
            {conversions.length === 0 && <TableRow><TableCell colSpan={4}><Typography variant="body2" color="text.secondary">No alternate units. The item transacts in its base unit ({item?.uom}).</Typography></TableCell></TableRow>}
            {conversions.map((c) => (
              <TableRow key={c.id} hover>
                <TableCell sx={{ fontWeight: 600 }}>{c.alt_uom}</TableCell>
                <TableCell align="right">1 {c.alt_uom} = {c.factor_to_base} {item?.uom}</TableCell>
                <TableCell>{c.is_default && <Chip size="small" color="primary" label="default" />}</TableCell>
                <TableCell align="right"><Tooltip title="Delete"><IconButton size="small" onClick={() => removeConv(c)}><DeleteOutlineRounded fontSize="small" /></IconButton></Tooltip></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Divider sx={{ my: 2 }} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
          <TextField size="small" label="Alt unit (e.g. roll)" value={conv.alt_uom} onChange={(e) => setConv((d) => ({ ...d, alt_uom: e.target.value }))} />
          <TextField size="small" label={`1 ${conv.alt_uom || 'alt'} = ? ${item?.uom || 'base'}`} type="number" value={conv.factor_to_base} onChange={(e) => setConv((d) => ({ ...d, factor_to_base: e.target.value }))} />
          <FormControlLabel control={<Switch checked={conv.is_default} onChange={(e) => setConv((d) => ({ ...d, is_default: e.target.checked }))} />} label="Default" />
          <Button variant="contained" startIcon={<SaveRounded />} onClick={saveConv} disabled={!conv.alt_uom.trim() || !(Number(conv.factor_to_base) > 0)}>Add</Button>
        </Stack>
      </Paper>
    </Stack>
  );
}
