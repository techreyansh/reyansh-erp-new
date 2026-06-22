// MRP — material requirements rolled up from released orders' costings.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container, Box, Stack, Typography, Grid, Card, CardContent, Chip, Table, TableHead,
  TableRow, TableCell, TableBody, CircularProgress, Alert, Snackbar, FormControlLabel, Switch, Tooltip,
} from '@mui/material';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import mrp from '../../services/mrpService';
import ReportExportButton from '../../components/common/ReportExportButton';

const STATUS = {
  ok: { label: 'In stock', color: 'success' },
  short: { label: 'Shortfall', color: 'error' },
  unmatched: { label: 'Not in stock master', color: 'warning' },
};
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));

export default function MaterialRequirements() {
  const [data, setData] = useState({ materials: [], lineCount: 0, shortCount: 0, unmatchedCount: 0 });
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState(null);
  const [shortOnly, setShortOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await mrp.computeMrp()); }
    catch (e) { setSnack({ message: e.message || 'Failed', severity: 'error' }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(
    () => (shortOnly ? data.materials.filter((m) => m.status !== 'ok') : data.materials),
    [data.materials, shortOnly],
  );

  const buildReport = () => ({
    key: 'mrp', title: 'Material Requirements (MRP)', subtitle: 'Reyansh International', generatedAt: new Date(),
    kpis: [
      { label: 'Distinct Materials', value: data.materials.length },
      { label: 'Shortfalls', value: data.shortCount },
      { label: 'Not in Stock Master', value: data.unmatchedCount },
      { label: 'Order Lines', value: data.lineCount },
    ],
    sections: [{
      key: 'mat', title: 'Material Requirements vs On-hand',
      columns: [
        { key: 'name', label: 'Material' }, { key: 'code', label: 'Code' },
        { key: 'qty', label: 'Required' }, { key: 'onHand', label: 'On hand' },
        { key: 'shortfall', label: 'Shortfall' }, { key: 'uom', label: 'UOM' }, { key: 'statusLabel', label: 'Status' },
      ],
      rows: rows.map((m) => ({ name: m.name, code: m.code, qty: m.qty, onHand: m.onHand == null ? '—' : m.onHand, shortfall: m.shortfall, uom: m.uom, statusLabel: STATUS[m.status]?.label })),
      emptyText: 'No material requirements.',
    }],
  });

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <Inventory2Outlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Material Requirements (MRP)</Typography>
        <Chip size="small" variant="outlined" label="from released orders" color="primary" />
        <Box sx={{ flexGrow: 1 }} />
        <FormControlLabel
          control={<Switch size="small" checked={shortOnly} onChange={(e) => setShortOnly(e.target.checked)} />}
          label={<Typography variant="caption">Shortfalls only</Typography>}
          sx={{ mr: 1 }}
        />
        <ReportExportButton buildReport={buildReport} label="Export MRP" />
      </Stack>

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {[
          ['Distinct materials', data.materials.length, 'primary'],
          ['Shortfalls', data.shortCount, 'error'],
          ['Not in stock master', data.unmatchedCount, 'warning'],
          ['Order lines costed', data.lineCount, 'secondary'],
        ].map(([label, val, color]) => (
          <Grid item xs={6} sm={3} key={label}>
            <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.6rem' }}>{label}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 800, color: `${color}.main` }}>{val}</Typography>
            </CardContent></Card>
          </Grid>
        ))}
      </Grid>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        {loading ? <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack> : data.materials.length === 0 ? (
          <Box sx={{ p: 3 }}><Alert severity="info">No requirements yet — release sales orders with costed line items (the costing's material lines drive MRP).</Alert></Box>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead><TableRow>{['Material', 'Code', 'Required', 'On hand', 'Shortfall', 'UOM', 'Status'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }} align={['Required', 'On hand', 'Shortfall'].includes(h) ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>{rows.map((m, i) => {
                const st = STATUS[m.status] || {};
                return (
                  <TableRow key={i} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{m.name}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{m.code || '—'}</TableCell>
                    <TableCell align="right">{fmt(m.qty)}</TableCell>
                    <TableCell align="right">
                      {m.stockItem ? <Tooltip title={`${m.stockItem.code} · ${m.stockItem.name}`}><span>{fmt(m.onHand)}</span></Tooltip> : fmt(m.onHand)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: m.shortfall > 0 ? 700 : 400, color: m.shortfall > 0 ? 'error.main' : 'text.primary' }}>{fmt(m.shortfall)}</TableCell>
                    <TableCell>{m.uom || '—'}</TableCell>
                    <TableCell><Chip size="small" label={st.label} color={st.color} variant={m.status === 'ok' ? 'outlined' : 'filled'} sx={{ fontWeight: 600, fontSize: '0.65rem' }} /></TableCell>
                  </TableRow>
                );
              })}</TableBody>
            </Table>
          </Box>
        )}
      </Card>

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
