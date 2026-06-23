// Payment Follow-Up — the collections workspace behind the Client Pipeline's
// "Payment Follow-Up" stage. KPIs (total outstanding, due this week, overdue,
// critical), aging, collection forecast, top debtors, and a per-invoice tracker
// with editable commitment date + collection status + owner. Data from
// ar_payment_dashboard(); writes via ar_update_collection().
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Card, CardContent, Chip, CircularProgress, Alert, Snackbar,
  Table, TableHead, TableRow, TableCell, TableBody, TextField, MenuItem, LinearProgress, Grid, Avatar,
} from '@mui/material';
import PaymentsRounded from '@mui/icons-material/PaymentsRounded';
import { paymentDashboard, updateCollection, listAssignableUsers } from '../../services/crmPipelineService';

const inr = (n) => { const v = Number(n || 0); return v >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L` : `₹${v.toLocaleString('en-IN')}`; };
const COLLECTION_STATUS = ['pending', 'contacted', 'committed', 'partial', 'escalated', 'disputed', 'paid'];
const STATUS_COLOR = { pending: 'default', contacted: 'info', committed: 'primary', partial: 'warning', escalated: 'error', disputed: 'error', paid: 'success' };

function Kpi({ label, value, sub, color }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, borderTop: '3px solid', borderTopColor: color || 'primary.main' }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="overline" color="text.secondary">{label}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 800, color: color || 'text.primary' }}>{value}</Typography>
        {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

export default function PaymentFollowUp() {
  const [d, setD] = useState(null);
  const [names, setNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState(null);
  const notify = (message, severity = 'success') => setSnack({ message, severity });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, users] = await Promise.all([paymentDashboard(), listAssignableUsers().catch(() => [])]);
      const nm = {}; (users || []).forEach((u) => { nm[(u.email || '').toLowerCase()] = u.full_name || u.name || u.email; });
      setD(dash || {}); setNames(nm);
    } catch (e) { notify(e.message || 'Load failed', 'error'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = async (id, field, value) => {
    try { await updateCollection(id, { [field]: value }); notify('Saved'); load(); }
    catch (e) { notify(e.message || 'Save failed', 'error'); }
  };

  if (loading) return <Container sx={{ py: 6 }}><Stack alignItems="center"><CircularProgress /></Stack></Container>;
  const aging = d?.aging || {};
  const agingMax = Math.max(1, ...Object.values(aging).map(Number));
  const invoices = d?.invoices || [];

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <PaymentsRounded color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Payment Follow-Up</Typography>
        <Typography variant="caption" color="text.secondary">Collections workspace</Typography>
      </Stack>

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid item xs={6} md={3}><Kpi label="Total Outstanding" value={inr(d?.total_outstanding)} sub={`${d?.invoice_count || 0} open invoices`} /></Grid>
        <Grid item xs={6} md={3}><Kpi label="Due This Week" value={inr(d?.due_this_week)} color="#0288d1" /></Grid>
        <Grid item xs={6} md={3}><Kpi label="Overdue" value={inr(d?.overdue_amount)} sub={`${d?.overdue_count || 0} invoices`} color="#ed6c02" /></Grid>
        <Grid item xs={6} md={3}><Kpi label="Critical (60+ days)" value={inr(d?.critical_amount)} sub={`${d?.critical_count || 0} invoices`} color="#d32f2f" /></Grid>
      </Grid>

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}><CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Aging</Typography>
            {[['current', 'Current'], ['d1_30', '1–30 days'], ['d31_60', '31–60 days'], ['d61_90', '61–90 days'], ['d90_plus', '90+ days']].map(([k, lbl]) => (
              <Stack key={k} direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
                <Typography variant="caption" sx={{ width: 90 }}>{lbl}</Typography>
                <Box sx={{ flexGrow: 1 }}><LinearProgress variant="determinate" value={Math.min(100, (Number(aging[k] || 0) / agingMax) * 100)} color={k === 'd90_plus' ? 'error' : k === 'd61_90' ? 'warning' : 'primary'} sx={{ height: 8, borderRadius: 1 }} /></Box>
                <Typography variant="caption" sx={{ width: 90, textAlign: 'right', fontWeight: 600 }}>{inr(aging[k])}</Typography>
              </Stack>
            ))}
          </CardContent></Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}><CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Top Debtors</Typography>
            {(d?.top_debtors || []).slice(0, 6).map((t) => (
              <Stack key={t.customer_code} direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>{t.customer_name || t.customer_code}</Typography>
                {t.max_dpd > 0 && <Chip size="small" color="error" variant="outlined" label={`${t.max_dpd}d`} sx={{ height: 18, '& .MuiChip-label': { px: 0.6, fontSize: '0.6rem' } }} />}
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{inr(t.outstanding)}</Typography>
              </Stack>
            ))}
            {(d?.top_debtors || []).length === 0 && <Typography variant="caption" color="text.disabled">No outstanding invoices.</Typography>}
            {(d?.forecast || []).length > 0 && (
              <>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1.5, mb: 0.5 }}>Collection Forecast</Typography>
                {d.forecast.map((f) => <Stack key={f.week} direction="row" justifyContent="space-between"><Typography variant="caption">Week of {f.week}</Typography><Typography variant="caption" sx={{ fontWeight: 600 }}>{inr(f.amount)}</Typography></Stack>)}
              </>
            )}
          </CardContent></Card>
        </Grid>
      </Grid>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <Box sx={{ p: 2, pb: 0 }}><Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Outstanding invoices ({invoices.length})</Typography></Box>
        <Table size="small">
          <TableHead><TableRow>{['Invoice', 'Customer', 'Date', 'Value', 'Outstanding', 'Due', 'Days', 'Commitment', 'Status', 'Collector'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.7rem' }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {invoices.length === 0 && <TableRow><TableCell colSpan={10}><Typography variant="body2" color="text.disabled" sx={{ py: 2, textAlign: 'center' }}>No outstanding invoices.</Typography></TableCell></TableRow>}
            {invoices.map((v) => (
              <TableRow key={v.id} hover>
                <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{v.invoice_number || '—'}</TableCell>
                <TableCell>{v.customer_name || v.customer_code}</TableCell>
                <TableCell>{v.invoice_date || '—'}</TableCell>
                <TableCell>{inr(v.amount)}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{inr(v.balance)}</TableCell>
                <TableCell>{v.due_date || '—'}</TableCell>
                <TableCell><Chip size="small" color={v.days_past_due > 60 ? 'error' : v.days_past_due > 0 ? 'warning' : 'default'} label={v.days_past_due > 0 ? `${v.days_past_due}d` : 'OK'} sx={{ height: 18, '& .MuiChip-label': { px: 0.6, fontSize: '0.6rem' } }} /></TableCell>
                <TableCell><TextField type="date" size="small" variant="standard" defaultValue={v.payment_commitment_date || ''} onBlur={(e) => e.target.value !== (v.payment_commitment_date || '') && patch(v.id, 'commitment', e.target.value || null)} InputLabelProps={{ shrink: true }} sx={{ width: 130 }} /></TableCell>
                <TableCell>
                  <TextField select size="small" variant="standard" value={v.collection_status || 'pending'} onChange={(e) => patch(v.id, 'status', e.target.value)} sx={{ width: 110 }}>
                    {COLLECTION_STATUS.map((s) => <MenuItem key={s} value={s}><Chip size="small" color={STATUS_COLOR[s]} label={s} sx={{ height: 18, '& .MuiChip-label': { px: 0.6, fontSize: '0.6rem' } }} /></MenuItem>)}
                  </TextField>
                </TableCell>
                <TableCell>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Avatar sx={{ width: 18, height: 18, fontSize: 9 }}>{(names[(v.collection_owner_email || v.owner_email || 'U').toLowerCase()] || 'U')[0]?.toUpperCase()}</Avatar>
                    <Typography variant="caption" noWrap sx={{ maxWidth: 90 }}>{names[(v.collection_owner_email || v.owner_email || '').toLowerCase()] || (v.collection_owner_email || v.owner_email || '—').split('@')[0]}</Typography>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
