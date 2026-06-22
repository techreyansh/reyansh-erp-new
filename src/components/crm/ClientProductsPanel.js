// Client-360 products — the PLM products for a customer + their latest released
// price. Self-contained (own fetch) so it drops into the client dashboard
// without touching its data-loading. Connects PLM → CRM.
import React, { useState, useEffect } from 'react';
import {
  Box, Stack, Typography, Chip, Table, TableHead, TableRow, TableCell, TableBody,
  Alert, CircularProgress, Grid, Card, CardContent,
} from '@mui/material';
import { supabase } from '../../lib/supabaseClient';

const STATUS_COLOR = { development: 'info', sample: 'warning', approved: 'success', production: 'primary', inactive: 'default', obsolete: 'error' };
const inr = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function ClientProductsPanel({ clientCode }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientCode) { setLoading(false); return; }
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const { data: products } = await supabase.from('product').select('*').ilike('customer_code', clientCode).is('archived_at', null);
        const list = products || [];
        // latest released costing price per product
        const ids = list.map((p) => p.id);
        let priceById = {};
        if (ids.length) {
          const { data: costs } = await supabase.from('costing_version').select('product_id, net_selling_price, version_number')
            .in('product_id', ids).eq('status', 'released').order('version_number', { ascending: false });
          (costs || []).forEach((c) => { if (priceById[c.product_id] == null) priceById[c.product_id] = c.net_selling_price; });
        }
        if (alive) setRows(list.map((p) => ({ ...p, price: priceById[p.id] })));
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [clientCode]);

  const count = (s) => rows.filter((r) => r.status === s).length;

  if (loading) return <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack>;
  if (rows.length === 0) return <Alert severity="info">No products linked to this customer yet — add them in Product Master (set the customer code).</Alert>;

  return (
    <Box>
      <Grid container spacing={1} sx={{ mb: 2 }}>
        {[['Development', count('development'), 'info'], ['Sampling', count('sample'), 'warning'], ['Approved', count('approved'), 'success'], ['Production', count('production'), 'primary']].map(([label, val, color]) => (
          <Grid item xs={6} sm={3} key={label}>
            <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.6rem' }}>{label}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 800, color: `${color}.main` }}>{val}</Typography>
            </CardContent></Card>
          </Grid>
        ))}
      </Grid>
      <Table size="small">
        <TableHead><TableRow>{['Product', 'Family', 'Rev', 'Latest price', 'Status'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>{rows.map((p) => (
          <TableRow key={p.id} hover>
            <TableCell sx={{ fontWeight: 600 }}>{p.product_name}</TableCell>
            <TableCell>{p.product_family || '—'}</TableCell>
            <TableCell>{p.current_revision || '—'}</TableCell>
            <TableCell>{p.price != null ? inr(p.price) : '—'}</TableCell>
            <TableCell><Chip size="small" color={STATUS_COLOR[p.status] || 'default'} label={p.status} sx={{ height: 20, textTransform: 'capitalize' }} /></TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>
    </Box>
  );
}
