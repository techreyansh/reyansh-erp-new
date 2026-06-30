// Sales Order 360 — overview, line items, PO documents, and the status timeline.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Chip, IconButton, Tabs, Tab, Card, CardContent, Grid,
  Table, TableHead, TableRow, TableCell, TableBody, Button, CircularProgress, Divider, useTheme, alpha,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloudDownload from '@mui/icons-material/CloudDownload';
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import { Link as RouterLink } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import so from '../../services/salesOrderService';

const STATUS_COLOR = {
  draft: 'default', pending_review: 'info', approved: 'warning', released: 'primary',
  in_planning: 'secondary', in_production: 'secondary', partially_dispatched: 'warning',
  dispatched: 'success', closed: 'success', cancelled: 'error',
};
const inr = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtD = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export default function Order360({ orderId, onBack, notify }) {
  const theme = useTheme();
  const [tab, setTab] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await so.getSalesOrder(orderId)); } finally { setLoading(false); }
  }, [orderId]);
  useEffect(() => { load(); }, [load]);

  if (loading || !data) return <Container sx={{ py: 6, textAlign: 'center' }}><CircularProgress /></Container>;
  const { order, lines, documents, history } = data;

  const advance = async () => {
    const next = so.nextStatus(order.status);
    if (!next) return;
    try { await so.transitionStatus(order.id, next); notify?.(`→ ${next.replace(/_/g, ' ')}`); load(); }
    catch (e) { notify?.(e.message || 'Failed', 'error'); }
  };
  const download = async (d) => {
    const { data: u } = await supabase.storage.from('documents').createSignedUrl(d.storage_path, 3600);
    if (u?.signedUrl) window.open(u.signedUrl, '_blank', 'noopener');
  };

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1, flexWrap: 'wrap' }} useFlexGap>
        <IconButton onClick={onBack}><ArrowBackIcon /></IconButton>
        <Typography variant="h6" sx={{ fontWeight: 800, fontFamily: 'monospace' }}>{order.so_number}</Typography>
        <Chip size="small" variant="outlined" label={order.company_name} />
        <Chip size="small" color={STATUS_COLOR[order.status] || 'default'} label={(order.status || '').replace(/_/g, ' ')} sx={{ textTransform: 'capitalize' }} />
        <Box sx={{ flex: 1 }} />
        <Button component={RouterLink} to={`/workflow/${orderId}`} variant="outlined" size="small" startIcon={<AccountTreeOutlined sx={{ fontSize: 18 }} />}>Workflow</Button>
        {so.nextStatus(order.status) && <Button variant="contained" size="small" onClick={advance}>Advance → {so.nextStatus(order.status).replace(/_/g, ' ')}</Button>}
      </Stack>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        {['Overview', 'Line items', 'Documents', 'Timeline'].map((t) => <Tab key={t} label={t} />)}
      </Tabs>

      {tab === 0 && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
          <Grid container spacing={1.5}>
            {[['Customer', order.company_name], ['Customer code', order.customer_code || '—'], ['PO number', order.po_number || '—'],
              ['PO date', fmtD(order.po_date)], ['Priority', order.priority], ['Expected delivery', fmtD(order.expected_delivery_date)],
              ['Total qty', order.total_qty], ['Total value', inr(order.total_value)], ['Payment terms', order.payment_terms || '—']].map(([k, v]) => (
              <Grid item xs={6} sm={4} key={k}><Box sx={{ p: 1.25, borderRadius: 1, bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                <Typography variant="caption" color="text.secondary">{k}</Typography><Typography variant="body2" fontWeight={700} sx={{ textTransform: k === 'Priority' ? 'capitalize' : 'none' }}>{String(v)}</Typography>
              </Box></Grid>
            ))}
          </Grid>
          {order.special_instructions && <><Divider sx={{ my: 2 }} /><Typography variant="caption" color="text.secondary">Special instructions</Typography><Typography variant="body2">{order.special_instructions}</Typography></>}
        </CardContent></Card>
      )}

      {tab === 1 && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}><Box sx={{ overflowX: 'auto' }}>
          <Table size="small"><TableHead><TableRow>{['Product', 'Rev', 'Qty', 'Price', 'Value', 'Req. date'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>{lines.map((l) => (
              <TableRow key={l.id}><TableCell sx={{ fontWeight: 600 }}>{l.product_name}</TableCell><TableCell>{l.revision || '—'}</TableCell>
                <TableCell>{l.qty} {l.uom}</TableCell><TableCell>{inr(l.unit_price)}</TableCell><TableCell>{inr(l.line_value)}</TableCell><TableCell>{fmtD(l.required_delivery_date)}</TableCell></TableRow>
            ))}</TableBody>
          </Table>
        </Box></Card>
      )}

      {tab === 2 && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
          {documents.length === 0 ? <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No documents.</Typography> : (
            <Stack spacing={1}>{documents.map((d) => (
              <Stack key={d.id} direction="row" alignItems="center" spacing={1} sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="body2" fontWeight={600} noWrap>{d.file_name}</Typography><Typography variant="caption" color="text.secondary">{d.doc_type} · {fmtD(d.created_at)}</Typography></Box>
                <IconButton size="small" onClick={() => download(d)}><CloudDownload fontSize="small" /></IconButton>
              </Stack>
            ))}</Stack>
          )}
        </CardContent></Card>
      )}

      {tab === 3 && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
          <Typography variant="overline" color="text.secondary">Order timeline</Typography>
          <Stack spacing={0} sx={{ position: 'relative', pl: 2, mt: 1 }}>
            <Box sx={{ position: 'absolute', left: 7, top: 6, bottom: 6, width: 2, bgcolor: 'divider' }} />
            {history.map((h) => (
              <Stack key={h.id} direction="row" spacing={2} sx={{ position: 'relative', py: 1 }}>
                <Box sx={{ width: 16, height: 16, borderRadius: '50%', mt: 0.5, flexShrink: 0, bgcolor: 'primary.main', border: '2px solid', borderColor: 'background.paper', zIndex: 1 }} />
                <Box>
                  <Typography variant="body2" fontWeight={600} sx={{ textTransform: 'capitalize' }}>{(h.to_status || '').replace(/_/g, ' ')}{h.from_status ? ` (from ${h.from_status.replace(/_/g, ' ')})` : ''}</Typography>
                  <Typography variant="caption" color="text.secondary">{fmt(h.changed_at)}{h.changed_by_email ? ` · ${h.changed_by_email}` : ''}{h.note ? ` · ${h.note}` : ''}</Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </CardContent></Card>
      )}
    </Container>
  );
}
