// Production Demand — what released sales orders require production to make.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container, Box, Stack, Typography, Grid, Card, CardContent, Chip, Table, TableHead,
  TableRow, TableCell, TableBody, Button, CircularProgress, Snackbar, Alert, useTheme,
} from '@mui/material';
import FactoryOutlined from '@mui/icons-material/FactoryOutlined';
import demand from '../../services/productionDemandService';
import ReportExportButton from '../../components/common/ReportExportButton';
import { buildProductionDemandReport } from '../../services/reporting/operationsReports';

const STATUS_COLOR = { pending: 'warning', planned: 'info', in_production: 'secondary', done: 'success', cancelled: 'default' };
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');
const overdue = (d) => d && new Date(d) < new Date(new Date().toDateString());

export default function ProductionDemand() {
  const theme = useTheme();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState(null);
  const notify = (message, severity = 'success') => setSnack({ message, severity });

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await demand.listDemand()); }
    catch (e) { notify(e.message || 'Failed', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(() => ({
    pending: rows.filter((r) => r.status === 'pending').length,
    planned: rows.filter((r) => r.status === 'planned').length,
    production: rows.filter((r) => r.status === 'in_production').length,
    overdue: rows.filter((r) => overdue(r.required_date) && r.status !== 'done').length,
    qty: rows.filter((r) => !['done', 'cancelled'].includes(r.status)).reduce((a, r) => a + (Number(r.qty) || 0), 0),
  }), [rows]);

  const advance = async (r) => {
    const next = demand.nextDemandStatus(r.status);
    if (!next) return;
    try { await demand.updateDemand(r.id, { status: next }); notify(`${r.product_name} → ${next.replace(/_/g, ' ')}`); load(); }
    catch (e) { notify(e.message, 'error'); }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <FactoryOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Production Demand</Typography>
        <Chip size="small" variant="outlined" label="from released orders" color="primary" />
        <Box sx={{ flexGrow: 1 }} />
        <ReportExportButton buildReport={() => buildProductionDemandReport(rows)} label="Export demand" />
      </Stack>

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {[['Pending', kpis.pending, 'warning'], ['Planned', kpis.planned, 'info'], ['In production', kpis.production, 'secondary'],
          ['Overdue', kpis.overdue, 'error'], ['Open units', kpis.qty, 'primary']].map(([label, val, color]) => (
          <Grid item xs={6} sm={4} md={2.4} key={label}>
            <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.6rem' }}>{label}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 800, color: `${color}.main` }}>{val}</Typography>
            </CardContent></Card>
          </Grid>
        ))}
      </Grid>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" stickyHeader>
            <TableHead><TableRow>{['Product', 'Customer', 'SO #', 'Qty', 'Required', 'Status', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} sx={{ textAlign: 'center', py: 4 }}><CircularProgress size={24} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>No demand yet — release a sales order to generate production demand.</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{r.product_name}</TableCell>
                  <TableCell>{r.company_name || '—'}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{r.so_number}</TableCell>
                  <TableCell>{r.qty} {r.uom}</TableCell>
                  <TableCell sx={{ color: overdue(r.required_date) && r.status !== 'done' ? 'error.main' : 'text.primary', fontWeight: overdue(r.required_date) ? 700 : 400 }}>{fmt(r.required_date)}</TableCell>
                  <TableCell><Chip size="small" color={STATUS_COLOR[r.status] || 'default'} label={(r.status || '').replace(/_/g, ' ')} sx={{ height: 20, textTransform: 'capitalize' }} /></TableCell>
                  <TableCell align="right">{demand.nextDemandStatus(r.status) && <Button size="small" onClick={() => advance(r)}>→ {demand.nextDemandStatus(r.status).replace(/_/g, ' ')}</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Card>

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
