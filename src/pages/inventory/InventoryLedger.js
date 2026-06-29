import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Stack, Card, CardContent, Typography, Button, IconButton, Chip, TextField,
  MenuItem, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  CircularProgress, Snackbar, Alert, Dialog, DialogTitle, DialogContent, DialogActions,
  Drawer, Divider, Tooltip, useTheme, alpha, InputAdornment,
} from '@mui/material';
import {
  Inventory2 as InventoryIcon, Add as AddIcon, Remove as RemoveIcon, SyncAlt as TransferIcon,
  FactCheck as AdjustIcon, Refresh as RefreshIcon, Search as SearchIcon, Close as CloseIcon,
} from '@mui/icons-material';
import inventoryLedgerService from '../../services/inventoryLedgerService';
import inventoryUomBinService from '../../services/inventoryUomBinService';

const BASE_UNIT = '__base__';
const fmtQty = (n) => (Number(n) || 0).toLocaleString('en-IN');
const fmtInr = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const STATUS_COLOR = { OK: 'success', Reorder: 'warning', 'Stock-out': 'error' };
const MOVE_SIGN = { OPENING: '+', RECEIPT: '+', MFG_RECEIVE: '+', TRANSFER_IN: '+', SCRAP_RECOVER: '+' };

const ACTIONS = {
  receive: { title: 'Receive stock', verb: 'Receive', color: 'success', needsRate: true },
  issue: { title: 'Issue stock', verb: 'Issue', color: 'warning' },
  adjust: { title: 'Adjust (cycle count)', verb: 'Set count', color: 'info', absolute: true, needsReason: true },
  transfer: { title: 'Transfer between locations', verb: 'Transfer', color: 'primary', isTransfer: true },
};

const InventoryLedger = () => {
  const theme = useTheme();
  const [rows, setRows] = useState([]);
  const [locations, setLocations] = useState([]);
  const [convByCode, setConvByCode] = useState({}); // itemCode -> [{ alt_uom, factor, is_default }]
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const [search, setSearch] = useState('');
  const [locFilter, setLocFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [dialog, setDialog] = useState(null); // { action, form }
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState(null); // { row, ledger }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ rows: r, locations: l }, allConv] = await Promise.all([
        inventoryLedgerService.getInventoryView(),
        inventoryUomBinService.listAllConversions(),
      ]);
      setRows(r);
      setLocations(l);
      // Build itemCode -> conversions (rows carry both itemId and code).
      const codeByItem = new Map(r.map((row) => [row.itemId, row.code]));
      const map = {};
      (allConv || []).forEach((c) => {
        const code = codeByItem.get(c.item_id);
        if (!code) return;
        (map[code] = map[code] || []).push({ alt_uom: c.alt_uom, factor: Number(c.factor_to_base) || 0, is_default: !!c.is_default });
      });
      setConvByCode(map);
    } catch (e) {
      setSnackbar({ open: true, message: 'Failed to load inventory: ' + e.message, severity: 'error' });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(() => {
    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    const reorderN = rows.filter((r) => r.status === 'Reorder').length;
    const stockoutN = rows.filter((r) => r.status === 'Stock-out').length;
    const items = new Set(rows.map((r) => r.code)).size;
    return { items, totalValue, reorderN, stockoutN };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (locFilter !== 'ALL' && r.locationCode !== locFilter) return false;
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (q && !(`${r.code} ${r.name}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, locFilter, statusFilter, search]);

  const itemOptions = useMemo(() => {
    const seen = new Map();
    rows.forEach((r) => { if (!seen.has(r.code)) seen.set(r.code, r); });
    return Array.from(seen.values());
  }, [rows]);

  const openDialog = (action) => setDialog({
    action,
    form: { itemCode: '', locationCode: 'STORE', toCode: 'WIP', qty: '', rate: '', reason: '', unit: BASE_UNIT },
  });

  const submit = async () => {
    const { action, form } = dialog;
    const cfg = ACTIONS[action];
    if (!form.itemCode || !form.qty) {
      setSnackbar({ open: true, message: 'Item and quantity are required', severity: 'warning' });
      return;
    }
    setSubmitting(true);
    try {
      // The ledger stays in base UoM. If the user transacted in an alt unit,
      // convert qty (and the receive rate) to base before posting.
      const convs = convByCode[form.itemCode] || [];
      const sel = form.unit && form.unit !== BASE_UNIT ? convs.find((c) => c.alt_uom === form.unit) : null;
      const factor = sel && sel.factor > 0 ? sel.factor : 1;
      const qty = inventoryUomBinService.toBase(Number(form.qty), factor);
      if (action === 'receive') {
        await inventoryLedgerService.receive({ itemCode: form.itemCode, locationCode: form.locationCode, qty, rate: form.rate !== '' ? Number(form.rate) / factor : null, grnRef: 'manual' });
      } else if (action === 'issue') {
        await inventoryLedgerService.issue({ itemCode: form.itemCode, locationCode: form.locationCode, qty, refType: 'manual' });
      } else if (action === 'adjust') {
        await inventoryLedgerService.adjust({ itemCode: form.itemCode, locationCode: form.locationCode, newQty: qty, reason: form.reason || 'cycle count' });
      } else if (action === 'transfer') {
        await inventoryLedgerService.transfer({ itemCode: form.itemCode, fromCode: form.locationCode, toCode: form.toCode, qty });
      }
      setSnackbar({ open: true, message: `${cfg.verb} posted to the ledger`, severity: 'success' });
      setDialog(null);
      await load();
    } catch (e) {
      setSnackbar({ open: true, message: `${cfg.verb} failed: ${e.message}`, severity: 'error' });
    }
    setSubmitting(false);
  };

  const openDetail = async (row) => {
    setDetail({ row, ledger: null });
    try {
      const ledger = await inventoryLedgerService.getItemLedger(row.itemId);
      setDetail({ row, ledger });
    } catch (e) {
      setDetail({ row, ledger: [] });
    }
  };

  const Kpi = ({ label, value, color }) => (
    <Card sx={{ flex: 1, minWidth: 150, borderRadius: 2 }}>
      <CardContent>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 700, color: color || 'text.primary', mt: 0.5 }}>{value}</Typography>
      </CardContent>
    </Card>
  );

  const cfg = dialog && ACTIONS[dialog.action];

  // Dialog UoM context: the selected item's base unit + alt-unit conversions.
  const dlgConvs = dialog ? (convByCode[dialog.form.itemCode] || []) : [];
  const dlgItem = dialog ? itemOptions.find((o) => o.code === dialog.form.itemCode) : null;
  const dlgBaseUom = dlgItem?.uom || 'base';
  const dlgSel = dialog && dialog.form.unit !== BASE_UNIT ? dlgConvs.find((c) => c.alt_uom === dialog.form.unit) : null;
  const dlgFactor = dlgSel && dlgSel.factor > 0 ? dlgSel.factor : 1;
  const dlgUnitLabel = dlgSel ? dialog.form.unit : dlgBaseUom;
  const dlgBaseQty = dialog && dialog.form.qty !== '' ? Number(dialog.form.qty) * dlgFactor : null;

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Card sx={{ background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`, color: 'white', borderRadius: 3, mb: 3 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <InventoryIcon sx={{ fontSize: 36 }} />
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 700 }}>Inventory</Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>One perpetual stock ledger — live on-hand, value, and every movement.</Typography>
            </Box>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button onClick={() => openDialog('receive')} startIcon={<AddIcon />} variant="contained" color="success" size="small">Receive</Button>
            <Button onClick={() => openDialog('issue')} startIcon={<RemoveIcon />} variant="contained" color="warning" size="small">Issue</Button>
            <Button onClick={() => openDialog('transfer')} startIcon={<TransferIcon />} variant="contained" size="small">Transfer</Button>
            <Button onClick={() => openDialog('adjust')} startIcon={<AdjustIcon />} variant="contained" color="info" size="small">Count</Button>
            <Tooltip title="Refresh"><IconButton onClick={load} sx={{ color: 'white' }}><RefreshIcon /></IconButton></Tooltip>
          </Stack>
        </CardContent>
      </Card>

      {/* KPIs */}
      <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap' }}>
        <Kpi label="Items" value={kpis.items} />
        <Kpi label="Stock value" value={fmtInr(kpis.totalValue)} color={theme.palette.success.main} />
        <Kpi label="Below reorder" value={kpis.reorderN} color={theme.palette.warning.main} />
        <Kpi label="Stock-out" value={kpis.stockoutN} color={theme.palette.error.main} />
      </Stack>

      {/* Filters */}
      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <TextField size="small" placeholder="Search code or name" value={search} onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} sx={{ minWidth: 240 }} />
        <TextField select size="small" label="Location" value={locFilter} onChange={(e) => setLocFilter(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="ALL">All locations</MenuItem>
          {locations.map((l) => <MenuItem key={l.code} value={l.code}>{l.name}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 140 }}>
          <MenuItem value="ALL">All status</MenuItem>
          <MenuItem value="OK">OK</MenuItem>
          <MenuItem value="Reorder">Reorder</MenuItem>
          <MenuItem value="Stock-out">Stock-out</MenuItem>
        </TextField>
      </Stack>

      {/* Table */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Material</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Bin</TableCell>
                <TableCell align="right">On hand</TableCell>
                <TableCell align="right">Alt stock</TableCell>
                <TableCell align="right">Rate</TableCell>
                <TableCell align="right">Value</TableCell>
                <TableCell align="right">Reorder</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={10} align="center" sx={{ py: 6, color: 'text.secondary' }}>No inventory rows match.</TableCell></TableRow>
              ) : filtered.map((r) => (
                <TableRow key={r.itemId + r.locationCode} hover sx={{ cursor: 'pointer' }} onClick={() => openDetail(r)}>
                  <TableCell sx={{ fontWeight: 600 }}>{r.code}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell><Chip size="small" label={r.locationName} variant="outlined" /></TableCell>
                  <TableCell>{r.binCode ? <Chip size="small" label={r.binCode} variant="outlined" /> : <Typography component="span" variant="caption" color="text.disabled">—</Typography>}</TableCell>
                  <TableCell align="right">{fmtQty(r.onHand)} <Typography component="span" variant="caption" color="text.secondary">{r.uom}</Typography></TableCell>
                  <TableCell align="right">{r.altUom ? <>{fmtQty(r.altOnHand)} <Typography component="span" variant="caption" color="text.secondary">{r.altUom}</Typography></> : <Typography component="span" variant="caption" color="text.disabled">—</Typography>}</TableCell>
                  <TableCell align="right">{r.rate ? fmtInr(r.rate) : '—'}</TableCell>
                  <TableCell align="right">{r.value ? fmtInr(r.value) : '—'}</TableCell>
                  <TableCell align="right">{r.reorder ? fmtQty(r.reorder) : '—'}</TableCell>
                  <TableCell><Chip size="small" label={r.status} color={STATUS_COLOR[r.status]} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Action dialog */}
      <Dialog open={!!dialog} onClose={() => !submitting && setDialog(null)} maxWidth="xs" fullWidth>
        {dialog && (
          <>
            <DialogTitle>{cfg.title}</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField select label="Item" value={dialog.form.itemCode} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, itemCode: e.target.value, unit: BASE_UNIT } })} fullWidth>
                  {itemOptions.map((o) => <MenuItem key={o.code} value={o.code}>{o.code} — {o.name}</MenuItem>)}
                </TextField>
                <TextField select label={cfg.isTransfer ? 'From location' : 'Location'} value={dialog.form.locationCode} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, locationCode: e.target.value } })} fullWidth>
                  {locations.map((l) => <MenuItem key={l.code} value={l.code}>{l.name}</MenuItem>)}
                </TextField>
                {cfg.isTransfer && (
                  <TextField select label="To location" value={dialog.form.toCode} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, toCode: e.target.value } })} fullWidth>
                    {locations.map((l) => <MenuItem key={l.code} value={l.code}>{l.name}</MenuItem>)}
                  </TextField>
                )}
                {dlgConvs.length > 0 && (
                  <TextField select label="Unit" value={dialog.form.unit} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, unit: e.target.value } })} fullWidth helperText="Transact in an alternate unit — converted to the base unit when posted.">
                    <MenuItem value={BASE_UNIT}>{dlgBaseUom} (base)</MenuItem>
                    {dlgConvs.map((c) => <MenuItem key={c.alt_uom} value={c.alt_uom}>{c.alt_uom} — 1 = {fmtQty(c.factor)} {dlgBaseUom}</MenuItem>)}
                  </TextField>
                )}
                <TextField
                  type="number"
                  label={`${cfg.absolute ? 'Counted quantity' : 'Quantity'}${dlgSel ? ` (${dlgUnitLabel})` : ''}`}
                  value={dialog.form.qty}
                  onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, qty: e.target.value } })}
                  fullWidth
                  helperText={dlgSel && dlgBaseQty != null ? `= ${fmtQty(dlgBaseQty)} ${dlgBaseUom} (base)` : undefined}
                />
                {cfg.needsRate && (
                  <TextField type="number" label={`Rate per ${dlgUnitLabel} (₹, optional)`} value={dialog.form.rate} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, rate: e.target.value } })} fullWidth helperText="Landed cost — drives weighted-average value." />
                )}
                {cfg.needsReason && (
                  <TextField label="Reason" value={dialog.form.reason} onChange={(e) => setDialog({ ...dialog, form: { ...dialog.form, reason: e.target.value } })} fullWidth />
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDialog(null)} disabled={submitting}>Cancel</Button>
              <Button onClick={submit} variant="contained" color={cfg.color} disabled={submitting}>
                {submitting ? <CircularProgress size={20} /> : cfg.verb}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Item detail drawer */}
      <Drawer anchor="right" open={!!detail} onClose={() => setDetail(null)} PaperProps={{ sx: { width: { xs: '100%', sm: 480 } } }}>
        {detail && (
          <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{detail.row.code}</Typography>
                <Typography variant="body2" color="text.secondary">{detail.row.name}</Typography>
              </Box>
              <IconButton onClick={() => setDetail(null)}><CloseIcon /></IconButton>
            </Box>
            <Stack direction="row" spacing={2} sx={{ my: 2 }}>
              <Box><Typography variant="caption" color="text.secondary">On hand</Typography><Typography variant="h6">{fmtQty(detail.row.onHand)} {detail.row.uom}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Value</Typography><Typography variant="h6">{detail.row.value ? fmtInr(detail.row.value) : '—'}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Location</Typography><Typography variant="h6">{detail.row.locationName}</Typography></Box>
            </Stack>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Recent movements</Typography>
            {detail.ledger === null ? (
              <CircularProgress size={22} />
            ) : detail.ledger.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No movements yet.</Typography>
            ) : (
              <Stack spacing={1}>
                {detail.ledger.map((m) => (
                  <Box key={m.id} sx={{ display: 'flex', justifyContent: 'space-between', p: 1, borderRadius: 1, bgcolor: alpha(theme.palette.text.primary, 0.03) }}>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.movement_type}</Typography>
                      <Typography variant="caption" color="text.secondary">{new Date(m.posted_at).toLocaleString('en-IN')} · {m.ref_type || ''} {m.ref_id || ''}</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: (MOVE_SIGN[m.movement_type] === '+') ? theme.palette.success.main : theme.palette.error.main }}>
                        {(MOVE_SIGN[m.movement_type] === '+' ? '+' : '')}{fmtQty(m.qty_delta)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">bal {fmtQty(m.qty_after)}</Typography>
                    </Box>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
        )}
      </Drawer>

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
};

export default InventoryLedger;
