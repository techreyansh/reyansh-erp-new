// Customer-facing portal (PUBLIC, token in URL). Read-only: orders, dispatch
// status, invoices & outstanding balance. No ERP chrome, no login.
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box, Container, Stack, Typography, Card, CardContent, Chip, Table, TableHead, TableRow,
  TableCell, TableBody, CircularProgress, Grid, Divider,
} from '@mui/material';
import StorefrontOutlined from '@mui/icons-material/StorefrontOutlined';
import portalService from '../../services/portalService';
import { SELLER } from '../../config/company';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const ORDER_COLOR = { draft: 'default', released: 'info', in_production: 'warning', partially_dispatched: 'warning', dispatched: 'success', completed: 'success', cancelled: 'error' };
const INV_COLOR = { ISSUED: 'info', PAID: 'success', PARTIAL: 'warning', OVERDUE: 'error', CANCELLED: 'default' };

function Section({ title, count, children }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <Box sx={{ px: 2, py: 1.25, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{title}</Typography>
        <Chip size="small" label={count} sx={{ fontWeight: 700 }} />
      </Box>
      {children}
    </Card>
  );
}

export default function CustomerPortal() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await portalService.getPortalData(token);
        if (!d || d.error) setErr('This portal link is invalid or has been deactivated.');
        else setData(d);
      } catch (e) { setErr(e.message || 'Could not load your portal.'); }
      finally { setLoading(false); }
    })();
  }, [token]);

  if (loading) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;

  if (err) return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
      <Card variant="outlined" sx={{ borderRadius: 3, maxWidth: 420, textAlign: 'center', p: 2 }}>
        <CardContent>
          <StorefrontOutlined sx={{ fontSize: 40, color: 'text.disabled' }} />
          <Typography variant="h6" sx={{ fontWeight: 700, mt: 1 }}>Portal unavailable</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{err}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>Please contact {SELLER.name} for an updated link.</Typography>
        </CardContent>
      </Card>
    </Box>
  );

  const { customer, orders = [], invoices = [], dispatches = [] } = data;
  const outstanding = invoices.reduce((s, i) => s + (Number(i.balance) || 0), 0);
  const openOrders = orders.filter((o) => !['completed', 'cancelled', 'dispatched'].includes(o.status)).length;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Brand header */}
      <Box sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', py: 2.5 }}>
        <Container maxWidth="md">
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <StorefrontOutlined />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1 }}>{SELLER.name}</Typography>
              <Typography variant="caption" sx={{ opacity: 0.85 }}>Customer Portal{SELLER.gstin ? ` · GSTIN ${SELLER.gstin}` : ''}</Typography>
            </Box>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="md" sx={{ py: 3 }}>
        <Stack spacing={2}>
          {/* Customer + summary */}
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>{customer?.name || customer?.code}</Typography>
              <Typography variant="body2" color="text.secondary">
                {customer?.code}{customer?.gstin ? ` · GSTIN ${customer.gstin}` : ''}{customer?.state ? ` · ${customer.state}` : ''}
              </Typography>
              <Divider sx={{ my: 1.5 }} />
              <Grid container spacing={2}>
                {[['Open orders', openOrders, 'primary'], ['Invoices', invoices.length, 'info'], ['Outstanding', inr(outstanding), outstanding > 0 ? 'error' : 'success']].map(([l, v, c]) => (
                  <Grid item xs={4} key={l}>
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.6rem' }}>{l}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: `${c}.main` }}>{v}</Typography>
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>

          {/* Orders */}
          <Section title="Orders" count={orders.length}>
            {orders.length === 0 ? <Box sx={{ p: 2.5 }}><Typography variant="body2" color="text.secondary">No orders on record.</Typography></Box> : (
              <Box sx={{ overflowX: 'auto' }}><Table size="small">
                <TableHead><TableRow>{['Order', 'PO', 'Value', 'Expected dispatch', 'Status'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>{orders.map((o, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{o.so_number}</TableCell>
                    <TableCell>{o.po_number || '—'}</TableCell>
                    <TableCell>{inr(o.total_value)}</TableCell>
                    <TableCell>{o.expected_dispatch_date || '—'}</TableCell>
                    <TableCell><Chip size="small" label={String(o.status || '').replace(/_/g, ' ')} color={ORDER_COLOR[o.status] || 'default'} variant="outlined" sx={{ fontWeight: 600, textTransform: 'capitalize' }} /></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table></Box>
            )}
          </Section>

          {/* Dispatch status */}
          {dispatches.length > 0 && (
            <Section title="Dispatch status" count={dispatches.length}>
              <Box sx={{ overflowX: 'auto' }}><Table size="small">
                <TableHead><TableRow>{['Order', 'Planned', 'Dispatched', 'Status'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>{dispatches.map((d, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{d.so_number}</TableCell>
                    <TableCell>{d.dispatch_date || '—'}</TableCell>
                    <TableCell>{d.actual_dispatch_date || '—'}</TableCell>
                    <TableCell><Chip size="small" label={String(d.status || 'planned').replace(/_/g, ' ')} variant="outlined" sx={{ fontWeight: 600, textTransform: 'capitalize' }} /></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table></Box>
            </Section>
          )}

          {/* Invoices */}
          <Section title="Invoices & payments" count={invoices.length}>
            {invoices.length === 0 ? <Box sx={{ p: 2.5 }}><Typography variant="body2" color="text.secondary">No invoices on record.</Typography></Box> : (
              <Box sx={{ overflowX: 'auto' }}><Table size="small">
                <TableHead><TableRow>{['Invoice', 'Date', 'Amount', 'Balance', 'Due', 'Status'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }} align={['Amount', 'Balance'].includes(h) ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>{invoices.map((v, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{v.invoice_number}</TableCell>
                    <TableCell>{v.invoice_date}</TableCell>
                    <TableCell align="right">{inr(v.amount)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: Number(v.balance) > 0 ? 700 : 400, color: Number(v.balance) > 0 ? 'error.main' : 'text.primary' }}>{inr(v.balance)}</TableCell>
                    <TableCell>{v.due_date || '—'}</TableCell>
                    <TableCell><Chip size="small" label={v.status} color={INV_COLOR[v.status] || 'default'} variant="outlined" sx={{ fontWeight: 600 }} /></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table></Box>
            )}
          </Section>

          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', display: 'block', pt: 1 }}>
            This is a secure read-only view of your account with {SELLER.name}. For changes, contact your account manager.
          </Typography>
        </Stack>
      </Container>
    </Box>
  );
}
