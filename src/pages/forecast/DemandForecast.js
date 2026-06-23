// Demand Forecast — statistical reorder prediction + product demand forecast.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Grid, Card, CardContent, Chip, Table, TableHead, TableRow,
  TableCell, TableBody, CircularProgress, Alert, Snackbar, Tabs, Tab, Tooltip,
} from '@mui/material';
import TrendingUpOutlined from '@mui/icons-material/TrendingUpOutlined';
import demandForecast from '../../services/demandForecastService';
import ReportExportButton from '../../components/common/ReportExportButton';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const DUE = { overdue: { label: 'Overdue', color: 'error' }, due_soon: { label: 'Due soon', color: 'warning' }, due: { label: 'Due', color: 'warning' }, upcoming: { label: 'Upcoming', color: 'info' }, ok: { label: 'On track', color: 'success' } };
const METHOD = { trend: 'Trend', avg: 'Avg', last: 'Last', none: '—' };

function ReorderTab({ setSnack }) {
  const [data, setData] = useState({ list: [], kpis: {} });
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { setData(await demandForecast.reorderForecast(null, 60)); } catch (e) { setSnack({ message: e.message, severity: 'error' }); } finally { setLoading(false); } })(); }, [setSnack]);

  const buildReport = () => ({
    key: 'reorder', title: 'Reorder Forecast', subtitle: 'Reyansh International', generatedAt: new Date(),
    kpis: [{ label: 'Due in 30d', value: data.kpis.due30 || 0 }, { label: 'Overdue', value: data.kpis.overdue || 0 }, { label: 'Expected value', value: inr(data.kpis.expectedValue) }],
    sections: [{
      key: 'l', title: 'Expected reorders (next 60 days)',
      columns: [{ key: 'company_name', label: 'Customer' }, { key: 'next_expected', label: 'Expected' }, { key: 'cadence_days', label: 'Cadence' }, { key: 'order_count', label: 'Orders' }, { key: 'expected_value', label: 'Est. value' }, { key: 'status', label: 'Status' }],
      rows: data.list.map((c) => ({ company_name: c.company_name, next_expected: c.next_expected, cadence_days: c.cadence_days ? `${c.cadence_days}d` : '—', order_count: c.order_count, expected_value: c.expected_value, status: DUE[c.due_status]?.label || c.due_status })),
      emptyText: 'No reorders forecast in the window.',
    }],
  });

  if (loading) return <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack>;
  return (
    <Box>
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {[['Due in 30 days', data.kpis.due30 || 0, 'primary'], ['Overdue', data.kpis.overdue || 0, 'error'], ['Expected value (60d)', inr(data.kpis.expectedValue), 'success'], ['Customers tracked', data.kpis.total || 0, 'secondary']].map(([l, v, c]) => (
          <Grid item xs={6} sm={3} key={l}><Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.6rem' }}>{l}</Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, color: `${c}.main` }}>{v}</Typography>
          </CardContent></Card></Grid>
        ))}
      </Grid>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}><ReportExportButton buildReport={buildReport} label="Export" /></Stack>
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        {data.list.length === 0 ? <Box sx={{ p: 3 }}><Alert severity="info">No reorders forecast yet — this predicts from customer order cadence (needs order history in the CRM client master).</Alert></Box> : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead><TableRow>{['Customer', 'Expected', 'In', 'Cadence', 'Orders', 'Est. value', 'Status'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }} align={['Orders', 'Est. value', 'In'].includes(h) ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>{data.list.map((c, i) => {
                const d = DUE[c.due_status] || {};
                return (
                  <TableRow key={i} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{c.company_name}</TableCell>
                    <TableCell>{c.next_expected}</TableCell>
                    <TableCell align="right" sx={{ color: c.overdue ? 'error.main' : 'text.primary', fontWeight: c.overdue ? 700 : 400 }}>{c.overdue ? `${Math.abs(c.days_until)}d ago` : `${c.days_until}d`}</TableCell>
                    <TableCell>{c.cadence_days ? `${c.cadence_days}d` : '—'}</TableCell>
                    <TableCell align="right">{c.order_count}</TableCell>
                    <TableCell align="right">{inr(c.expected_value)}</TableCell>
                    <TableCell><Chip size="small" label={d.label || c.due_status} color={d.color} variant="outlined" sx={{ fontWeight: 600 }} /></TableCell>
                  </TableRow>
                );
              })}</TableBody>
            </Table>
          </Box>
        )}
      </Card>
    </Box>
  );
}

function ProductTab({ setSnack }) {
  const [data, setData] = useState({ products: [], periods: 3, lineCount: 0 });
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { setData(await demandForecast.productForecast(3)); } catch (e) { setSnack({ message: e.message, severity: 'error' }); } finally { setLoading(false); } })(); }, [setSnack]);

  const periodCols = data.products[0]?.forecast.map((f) => f.period) || [];
  const buildReport = () => ({
    key: 'product-forecast', title: 'Product Demand Forecast', subtitle: 'Reyansh International', generatedAt: new Date(),
    kpis: [{ label: 'Products', value: data.products.length }, { label: 'Forecast horizon', value: `${data.periods} months` }],
    sections: [{
      key: 'p', title: 'Forecast by product',
      columns: [{ key: 'name', label: 'Product' }, { key: 'method', label: 'Method' }, { key: 'history_total', label: 'History qty' }, ...periodCols.map((p) => ({ key: p, label: p }))],
      rows: data.products.map((p) => ({ name: p.name, method: METHOD[p.method] || p.method, history_total: p.total, ...Object.fromEntries(p.forecast.map((f) => [f.period, f.qty])) })),
      emptyText: 'No product history.',
    }],
  });

  if (loading) return <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack>;
  return (
    <Box>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}><ReportExportButton buildReport={buildReport} label="Export" /></Stack>
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        {data.products.length === 0 ? <Box sx={{ p: 3 }}><Alert severity="info">No product demand yet — this forecasts each product's next {data.periods} months from sales-order-line history (trend / moving average). Create sales orders and it populates here.</Alert></Box> : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead><TableRow>
                {['Product', 'Method', 'History'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>)}
                {periodCols.map((p) => <TableCell key={p} align="right" sx={{ fontWeight: 700, fontSize: '0.72rem', color: 'primary.main' }}>{p}</TableCell>)}
              </TableRow></TableHead>
              <TableBody>{data.products.map((p, i) => (
                <TableRow key={i} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{p.name}{p.code ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace' }}>{p.code}</Typography> : null}</TableCell>
                  <TableCell><Tooltip title={`slope ${p.slope}/mo · 3-mo avg ${p.avg}`}><Chip size="small" label={METHOD[p.method] || p.method} variant="outlined" /></Tooltip></TableCell>
                  <TableCell>{num(p.total)} {p.uom}</TableCell>
                  {p.forecast.map((f) => <TableCell key={f.period} align="right" sx={{ fontWeight: 700 }}>{num(f.qty)}</TableCell>)}
                </TableRow>
              ))}</TableBody>
            </Table>
          </Box>
        )}
      </Card>
    </Box>
  );
}

export default function DemandForecast() {
  const [tab, setTab] = useState(0);
  const [snack, setSnack] = useState(null);
  const setSnackCb = useCallback((s) => setSnack(s), []);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <TrendingUpOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Demand Forecast</Typography>
        <Chip size="small" variant="outlined" label="statistical · no AI" color="primary" />
      </Stack>
      <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Reorder forecast" />
        <Tab label="Product demand" />
      </Tabs>
      {tab === 0 ? <ReorderTab setSnack={setSnackCb} /> : <ProductTab setSnack={setSnackCb} />}

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
