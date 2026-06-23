// Material Control System — management inventory visibility on the PPC engine.
// KPIs (RM/SF/FG, valuation, below-reorder, stock-out, reserved) + below-reorder
// alerts + the full stock register with available = on_hand - reserved.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Grid, Card, CardContent, Chip, Table, TableHead, TableRow,
  TableCell, TableBody, CircularProgress, Alert, Snackbar, TextField, MenuItem, InputAdornment,
  Drawer, IconButton, Divider,
} from '@mui/material';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import SearchRounded from '@mui/icons-material/SearchRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import inv from '../../services/inventoryControlService';
import ReportExportButton from '../../components/common/ReportExportButton';

const inrK = (n) => { const v = Number(n || 0); return v >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : `₹${v.toLocaleString('en-IN')}`; };
const STATUS = { out: { label: 'Stock-out', color: 'error' }, reorder: { label: 'Reorder', color: 'warning' }, low: { label: 'Low', color: 'warning' }, ok: { label: 'OK', color: 'success' } };
const dt = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

function Material360({ row, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { (async () => { setData(await inv.getMaterial360(row.item_id)); })(); }, [row.item_id]);
  return (
    <Drawer anchor="right" open onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 560 }, maxWidth: '100%' } }}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ flexGrow: 1 }}><Typography variant="h6" sx={{ fontWeight: 800 }}>{row.name}</Typography><Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{row.code} · {row.group}</Typography></Box>
          <IconButton onClick={onClose}><CloseRounded /></IconButton>
        </Stack>
        <Grid container spacing={1} sx={{ my: 1 }}>
          {[['On hand', `${row.on_hand} ${row.uom}`], ['Reserved', row.reserved], ['Available', row.available], ['Reorder', row.reorder], ['Safety', row.safety], ['Location', row.location || '—']].map(([k, v]) => (
            <Grid item xs={4} key={k}><Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.58rem', textTransform: 'uppercase', fontWeight: 700 }}>{k}</Typography><Typography variant="body2" sx={{ fontWeight: 600 }}>{v}</Typography></Grid>
          ))}
        </Grid>
        <Divider sx={{ my: 1 }} />
        {!data ? <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={22} /></Stack> : (
          <>
            <Typography variant="overline" color="text.secondary">Stock movements ({data.transactions.length})</Typography>
            <Box sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow>{['Date', 'Type', 'Δ Qty', 'Balance', 'Ref'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.68rem' }} align={['Δ Qty', 'Balance'].includes(h) ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>{data.transactions.length === 0 ? <TableRow><TableCell colSpan={5}><Typography variant="caption" color="text.secondary">No movements.</Typography></TableCell></TableRow> : data.transactions.map((t, i) => (
                <TableRow key={i}><TableCell>{dt(t.created_at)}</TableCell><TableCell><Chip size="small" variant="outlined" label={t.transaction_type} /></TableCell>
                  <TableCell align="right" sx={{ color: Number(t.quantity_delta) >= 0 ? 'success.main' : 'error.main', fontWeight: 600 }}>{Number(t.quantity_delta) >= 0 ? '+' : ''}{t.quantity_delta}</TableCell>
                  <TableCell align="right">{t.on_hand_after}</TableCell><TableCell><Typography variant="caption" color="text.secondary">{t.reference_type || '—'}</Typography></TableCell></TableRow>
              ))}</TableBody></Table></Box>
            <Typography variant="overline" color="text.secondary" sx={{ mt: 2, display: 'block' }}>Suppliers ({data.vendors.length})</Typography>
            {data.vendors.length === 0 ? <Typography variant="caption" color="text.secondary">No suppliers linked.</Typography> : (
              <Box sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow>{['Vendor', 'Preferred', 'Lead time', 'Rate', 'MOQ'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.68rem' }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>{data.vendors.map((v, i) => <TableRow key={i}><TableCell>{v.vendor_name || v.vendor_code}</TableCell><TableCell>{v.is_preferred ? '★' : '—'}</TableCell><TableCell>{v.lead_time_days ? `${v.lead_time_days}d` : '—'}</TableCell><TableCell>{v.unit_cost ? inrK(v.unit_cost) : '—'}</TableCell><TableCell>{v.moq || '—'}</TableCell></TableRow>)}</TableBody></Table></Box>
            )}
          </>
        )}
      </Box>
    </Drawer>
  );
}

export default function InventoryControl() {
  const [dash, setDash] = useState(null);
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState(null);
  const [q, setQ] = useState('');
  const [grp, setGrp] = useState('all');
  const [statusF, setStatusF] = useState('all');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const [d, s] = await Promise.all([inv.dashboard(), inv.listStock()]); setDash(d); setStock(s); }
    catch (e) { setSnack({ message: e.message || 'Failed', severity: 'error' }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const groups = ['all', ...Array.from(new Set(stock.map((s) => s.group)))];
  const rows = stock.filter((s) => (grp === 'all' || s.group === grp)
    && (statusF === 'all' || s.status === statusF)
    && (!q || `${s.code} ${s.name} ${s.location || ''}`.toLowerCase().includes(q.toLowerCase())));

  const buildReport = () => ({
    key: 'inv-control', title: 'Inventory — Material Control', subtitle: 'Reyansh International', generatedAt: new Date(),
    kpis: [{ label: 'Items', value: dash?.total_items || 0 }, { label: 'Valuation', value: inrK(dash?.total_valuation) }, { label: 'Below reorder', value: dash?.below_reorder || 0 }, { label: 'Stock-out', value: dash?.stock_out || 0 }],
    sections: [{ key: 's', title: 'Stock register', columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Material' }, { key: 'group', label: 'Type' }, { key: 'on_hand', label: 'On hand' }, { key: 'reserved', label: 'Reserved' }, { key: 'available', label: 'Available' }, { key: 'reorder', label: 'Reorder' }, { key: 'status', label: 'Status' }],
      rows: rows.map((s) => ({ code: s.code, name: s.name, group: s.group, on_hand: s.on_hand, reserved: s.reserved, available: s.available, reorder: s.reorder, status: STATUS[s.status]?.label })), emptyText: 'No stock.' }],
  });

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <Inventory2Outlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Inventory — Material Control</Typography>
        <Chip size="small" variant="outlined" label="on PPC engine" color="primary" />
        <Box sx={{ flexGrow: 1 }} />
        {!loading && <ReportExportButton buildReport={buildReport} label="Export" />}
      </Stack>
      <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>New Material Control System on the unified PPC engine (raw / semi-finished / finished, with reserved &amp; available). The legacy Inventory screens remain available during transition.</Alert>

      {loading || !dash ? <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress /></Stack> : (
        <>
          <Grid container spacing={1.5} sx={{ mb: 2 }}>
            {[['Items', dash.total_items, 'primary'], ['Valuation', inrK(dash.total_valuation), 'secondary'], ['Reserved', dash.reserved_total, 'info'], ['Below reorder', dash.below_reorder, dash.below_reorder ? 'warning' : 'success'], ['Stock-out', dash.stock_out, dash.stock_out ? 'error' : 'success']].map(([l, v, c]) => (
              <Grid item xs={6} sm={2.4} key={l}><Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.58rem' }}>{l}</Typography>
                <Typography variant="h6" sx={{ fontWeight: 800, color: `${c}.main` }}>{v}</Typography>
              </CardContent></Card></Grid>
            ))}
          </Grid>
          <Stack direction="row" spacing={1.5} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
            <Typography variant="caption" color="text.secondary">Segments:</Typography>
            <Chip size="small" label={`Raw ${dash.raw_count}`} variant="outlined" />
            <Chip size="small" label={`Semi-finished ${dash.semi_count}`} variant="outlined" />
            <Chip size="small" label={`Finished ${dash.fg_count}`} variant="outlined" />
          </Stack>

          <Stack direction="row" spacing={1.5} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap alignItems="center">
            <TextField size="small" placeholder="Search material…" value={q} onChange={(e) => setQ(e.target.value)} InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> }} sx={{ width: 240 }} />
            <TextField select size="small" label="Type" value={grp} onChange={(e) => setGrp(e.target.value)} sx={{ width: 160 }}>{groups.map((g) => <MenuItem key={g} value={g}>{g === 'all' ? 'All types' : g}</MenuItem>)}</TextField>
            <TextField select size="small" label="Status" value={statusF} onChange={(e) => setStatusF(e.target.value)} sx={{ width: 150 }}>{['all', 'reorder', 'low', 'out', 'ok'].map((st) => <MenuItem key={st} value={st}>{st === 'all' ? 'All' : STATUS[st]?.label || st}</MenuItem>)}</TextField>
          </Stack>

          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead><TableRow>{['Code', 'Material', 'Type', 'On hand', 'Reserved', 'Available', 'Reorder', 'Location', 'Status'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }} align={['On hand', 'Reserved', 'Available', 'Reorder'].includes(h) ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>{rows.map((s, i) => {
                  const st = STATUS[s.status] || {};
                  return (
                    <TableRow key={i} hover sx={{ cursor: 'pointer' }} onClick={() => setSelected(s)}>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{s.code}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{s.name}</TableCell>
                      <TableCell><Typography variant="caption">{s.group}</Typography></TableCell>
                      <TableCell align="right">{s.on_hand.toLocaleString('en-IN')} {s.uom}</TableCell>
                      <TableCell align="right">{s.reserved ? s.reserved.toLocaleString('en-IN') : '—'}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{s.available.toLocaleString('en-IN')}</TableCell>
                      <TableCell align="right">{s.reorder || '—'}</TableCell>
                      <TableCell><Typography variant="caption" color="text.secondary">{s.location || '—'}</Typography></TableCell>
                      <TableCell><Chip size="small" label={st.label} color={st.color} variant={s.status === 'ok' ? 'outlined' : 'filled'} sx={{ fontWeight: 600, fontSize: '0.65rem' }} /></TableCell>
                    </TableRow>
                  );
                })}</TableBody>
              </Table>
            </Box>
          </Card>
        </>
      )}

      {selected && <Material360 row={selected} onClose={() => setSelected(null)} />}

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
