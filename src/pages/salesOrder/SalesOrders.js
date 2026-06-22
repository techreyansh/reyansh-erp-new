// Sales Orders — dashboard + register + New-order wizard. Order Initiation Engine.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container, Box, Stack, Typography, Button, Grid, Card, CardContent, Chip, Table,
  TableHead, TableRow, TableCell, TableBody, IconButton, CircularProgress, Snackbar, Alert,
  TextField, InputAdornment, useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import so from '../../services/salesOrderService';
import SalesOrderWizard from '../../components/salesOrder/SalesOrderWizard';

const STATUS_COLOR = {
  draft: 'default', pending_review: 'info', approved: 'warning', released: 'primary',
  in_planning: 'secondary', in_production: 'secondary', partially_dispatched: 'warning',
  dispatched: 'success', closed: 'success', cancelled: 'error',
};
const inr = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');
const isToday = (d) => d && new Date(d).toDateString() === new Date().toDateString();

export default function SalesOrders() {
  const theme = useTheme();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState(false);
  const [search, setSearch] = useState('');
  const [snack, setSnack] = useState(null);
  const notify = (message, severity = 'success') => setSnack({ message, severity });

  const load = useCallback(async () => {
    setLoading(true);
    try { setOrders(await so.listSalesOrders()); }
    catch (e) { notify(e.message || 'Failed to load', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(() => ({
    today: orders.filter((o) => isToday(o.created_at)).length,
    pending: orders.filter((o) => o.status === 'pending_review').length,
    released: orders.filter((o) => o.status === 'released').length,
    production: orders.filter((o) => o.status === 'in_production' || o.status === 'in_planning').length,
    value: orders.filter((o) => !['cancelled', 'closed'].includes(o.status)).reduce((a, o) => a + (Number(o.total_value) || 0), 0),
  }), [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => [o.so_number, o.company_name, o.po_number].map((x) => String(x || '').toLowerCase()).join(' ').includes(q));
  }, [orders, search]);

  const advance = async (o) => {
    const next = so.nextStatus(o.status);
    if (!next) return;
    try { await so.transitionStatus(o.id, next); notify(`${o.so_number} → ${next.replace(/_/g, ' ')}`); load(); }
    catch (e) { notify(e.message || 'Failed', 'error'); }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
        <ReceiptLongOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Sales Orders</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setWizard(true)}>New order</Button>
      </Stack>

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {[['Received today', kpis.today, 'primary'], ['Pending review', kpis.pending, 'info'], ['Released', kpis.released, 'primary'],
          ['In production', kpis.production, 'secondary'], ['Open order value', inr(kpis.value), 'success']].map(([label, val, color]) => (
          <Grid item xs={6} sm={4} md={2.4} key={label}>
            <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.6rem' }}>{label}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 800, color: `${color}.main` }}>{val}</Typography>
            </CardContent></Card>
          </Grid>
        ))}
      </Grid>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField size="small" placeholder="Search SO / customer / PO…" value={search} onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} sx={{ minWidth: 260 }} />
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="caption" color="text.secondary">{filtered.length} orders</Typography>
        </Box>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" stickyHeader>
            <TableHead><TableRow>{['SO #', 'Customer', 'PO', 'Date', 'Qty', 'Value', 'Priority', 'Status', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} sx={{ textAlign: 'center', py: 4 }}><CircularProgress size={24} /></TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>No sales orders. Click “New order”.</TableCell></TableRow>
              ) : filtered.map((o) => (
                <TableRow key={o.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>{o.so_number}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{o.company_name || '—'}</TableCell>
                  <TableCell>{o.po_number || '—'}</TableCell>
                  <TableCell>{fmt(o.created_at)}</TableCell>
                  <TableCell>{o.total_qty}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{inr(o.total_value)}</TableCell>
                  <TableCell sx={{ textTransform: 'capitalize' }}>{o.priority}</TableCell>
                  <TableCell><Chip size="small" color={STATUS_COLOR[o.status] || 'default'} label={(o.status || '').replace(/_/g, ' ')} sx={{ height: 20, textTransform: 'capitalize' }} /></TableCell>
                  <TableCell align="right">{so.nextStatus(o.status) && <Button size="small" onClick={() => advance(o)}>→ {so.nextStatus(o.status).replace(/_/g, ' ')}</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Card>

      {wizard && <SalesOrderWizard onClose={() => setWizard(false)} onCreated={() => { setWizard(false); load(); }} notify={notify} />}
      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
