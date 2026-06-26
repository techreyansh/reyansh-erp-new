// Client Pipeline reports (Phase 7). Seven manager reports computed from
// crm_client_cards() + ar_payment_dashboard(): Pipeline, Outstanding Payment,
// Follow-Up, Client Health, Account Manager, Revenue At Risk, Dormant Client.
// Each is a table with one-click CSV export.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container, Box, Stack, Typography, Card, CardContent, List, ListItemButton, ListItemText,
  Table, TableHead, TableRow, TableCell, TableBody, Chip, CircularProgress, Button, Alert, Snackbar, Grid,
} from '@mui/material';
import AssessmentRounded from '@mui/icons-material/AssessmentRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import { clientCards, paymentDashboard, listAssignableUsers } from '../../services/crmPipelineService';
import { listClientStageDefs } from '../../services/crmPipelineService';
import CompanyLink from '../../components/crm/CompanyLink';

// Tag a customer cell so the table can render it as a clickable 360 link while
// CSV export still gets the plain name. code is optional (name resolves too).
const co = (name, code) => ({ __company: true, name, code });

const inr = (n) => { const v = Number(n || 0); return v >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L` : `₹${v.toLocaleString('en-IN')}`; };
const today = () => new Date().toISOString().slice(0, 10);
const BAND = { green: 'success', yellow: 'warning', red: 'error' };

const REPORTS = [
  { key: 'pipeline', label: 'Client Pipeline Report' },
  { key: 'outstanding', label: 'Outstanding Payment Report' },
  { key: 'followup', label: 'Follow-Up Report' },
  { key: 'health', label: 'Client Health Report' },
  { key: 'manager', label: 'Account Manager Report' },
  { key: 'risk', label: 'Revenue At Risk Report' },
  { key: 'dormant', label: 'Dormant Client Report' },
];

function toCSV(columns, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [columns.map(esc).join(','), ...rows.map((r) => r.map((c) => esc(c && c.__company ? c.name : c)).join(','))].join('\n');
}

export default function ClientReports() {
  const [cards, setCards] = useState([]);
  const [pay, setPay] = useState({});
  const [names, setNames] = useState({});
  const [defs, setDefs] = useState([]);
  const [report, setReport] = useState('pipeline');
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cd, pd, us, df] = await Promise.all([clientCards(), paymentDashboard().catch(() => ({})), listAssignableUsers().catch(() => []), listClientStageDefs().catch(() => [])]);
      const nm = {}; (us || []).forEach((u) => { nm[(u.email || '').toLowerCase()] = u.full_name || u.name || u.email; });
      setCards(cd || []); setPay(pd || {}); setNames(nm); setDefs(df || []);
    } catch (e) { setSnack({ message: e.message || 'Load failed', severity: 'error' }); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const nmOf = (e) => names[(e || '').toLowerCase()] || (e ? e.split('@')[0] : 'Unassigned');
  const stageLabel = (k) => defs.find((d) => d.stage_key === k)?.label || k;

  const built = useMemo(() => {
    if (report === 'pipeline') {
      const by = {}; cards.forEach((c) => { const k = c.pipeline_stage || 'active'; (by[k] = by[k] || []).push(c); });
      const rows = (defs.length ? defs.map((d) => d.stage_key) : Object.keys(by)).filter((k) => by[k]).map((k) => {
        const arr = by[k]; return [stageLabel(k), arr.length, arr.filter((c) => c.is_unmanaged).length, inr(arr.reduce((s, c) => s + Number(c.revenue || 0), 0)), inr(arr.reduce((s, c) => s + Number(c.outstanding || 0), 0))];
      });
      return { columns: ['Stage', 'Accounts', 'Unmanaged', 'Revenue (12m)', 'Outstanding'], rows };
    }
    if (report === 'outstanding') {
      const inv = (pay.invoices || []);
      return { columns: ['Invoice', 'Customer', 'Invoice Date', 'Value', 'Outstanding', 'Due Date', 'Days', 'Status'], rows: inv.map((v) => [v.invoice_number, co(v.customer_name || v.customer_code, v.customer_code), v.invoice_date, inr(v.amount), inr(v.balance), v.due_date, v.days_past_due, v.ar_status]) };
    }
    if (report === 'followup') {
      const rows = cards.filter((c) => c.next_action).sort((a, b) => String(a.next_action_date || '9999').localeCompare(String(b.next_action_date || '9999')))
        .map((c) => [co(c.company_name, c.customer_code || c.client_code), nmOf(c.owner_email), c.next_action, c.next_action_date || '—', c.next_action_date && c.next_action_date < today() ? 'OVERDUE' : 'upcoming', c.next_action_priority]);
      const unmanaged = cards.filter((c) => c.is_unmanaged).map((c) => [co(c.company_name, c.customer_code || c.client_code), nmOf(c.owner_email), '⚠ NO NEXT ACTION', '—', 'UNMANAGED', '—']);
      return { columns: ['Client', 'Owner', 'Next Action', 'Due', 'Status', 'Priority'], rows: [...unmanaged, ...rows] };
    }
    if (report === 'health') {
      const rows = cards.filter((c) => c.health_score != null).sort((a, b) => a.health_score - b.health_score)
        .map((c) => [co(c.company_name, c.customer_code || c.client_code), nmOf(c.owner_email), c.health_score, c.band, c.days_since_contact != null ? `${c.days_since_contact}d` : '—', inr(c.outstanding)]);
      return { columns: ['Client', 'Owner', 'Health', 'Band', 'Last Contact', 'Outstanding'], rows };
    }
    if (report === 'manager') {
      const m = new Map();
      cards.forEach((c) => { const k = (c.owner_email || '').toLowerCase() || '__u'; const r = m.get(k) || { e: c.owner_email, n: 0, u: 0, o: 0, rev: 0 }; r.n++; if (c.is_unmanaged) r.u++; r.o += Number(c.outstanding || 0); r.rev += Number(c.revenue || 0); m.set(k, r); });
      return { columns: ['Account Manager', 'Accounts', 'Unmanaged', 'Outstanding', 'Revenue (12m)'], rows: Array.from(m.values()).sort((a, b) => b.o - a.o).map((r) => [r.e ? nmOf(r.e) : 'Unassigned', r.n, r.u, inr(r.o), inr(r.rev)]) };
    }
    if (report === 'risk') {
      const rows = cards.filter((c) => c.band === 'red' || Number(c.outstanding) > 0 || ['dormant', 'lost'].includes(c.pipeline_stage))
        .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
        .map((c) => [co(c.company_name, c.customer_code || c.client_code), nmOf(c.owner_email), inr(c.revenue), inr(c.outstanding), c.band || '—', c.days_since_contact != null ? `${c.days_since_contact}d` : '—', [c.band === 'red' && 'low health', Number(c.outstanding) > 0 && 'overdue', ['dormant', 'lost'].includes(c.pipeline_stage) && c.pipeline_stage].filter(Boolean).join(', ')]);
      return { columns: ['Client', 'Owner', 'Revenue At Risk', 'Outstanding', 'Health', 'Last Contact', 'Risk Reason'], rows };
    }
    // dormant
    const rows = cards.filter((c) => c.pipeline_stage === 'dormant' || (c.days_since_contact != null && c.days_since_contact > 90))
      .sort((a, b) => (b.days_since_contact || 0) - (a.days_since_contact || 0))
      .map((c) => [co(c.company_name, c.customer_code || c.client_code), nmOf(c.owner_email), c.days_since_contact != null ? `${c.days_since_contact}d` : '—', inr(c.revenue), stageLabel(c.pipeline_stage), c.next_action || '⚠ none']);
    return { columns: ['Client', 'Owner', 'Days Since Contact', 'Revenue (12m)', 'Stage', 'Next Action'], rows };
  }, [report, cards, pay, defs, names]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = () => {
    const csv = toCSV(built.columns, built.rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${report}-report-${today()}.csv`; a.click(); URL.revokeObjectURL(a.href);
    setSnack({ message: 'CSV exported', severity: 'success' });
  };

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <AssessmentRounded color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Client Reports</Typography>
      </Stack>
      <Grid container spacing={2}>
        <Grid item xs={12} md={3}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <List dense>
              {REPORTS.map((r) => (
                <ListItemButton key={r.key} selected={report === r.key} onClick={() => setReport(r.key)}>
                  <ListItemText primary={r.label} primaryTypographyProps={{ fontWeight: report === r.key ? 700 : 500, fontSize: '0.85rem' }} />
                </ListItemButton>
              ))}
            </List>
          </Card>
        </Grid>
        <Grid item xs={12} md={9}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <Stack direction="row" alignItems="center" sx={{ p: 2, pb: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, flexGrow: 1 }}>{REPORTS.find((r) => r.key === report)?.label}</Typography>
              <Button size="small" variant="outlined" startIcon={<DownloadRounded />} onClick={download} disabled={loading || !built.rows.length}>Export CSV</Button>
            </Stack>
            {loading ? <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress /></Stack> : (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead><TableRow>{built.columns.map((c, i) => <TableCell key={c} align={i === 0 ? 'left' : 'right'} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{c}</TableCell>)}</TableRow></TableHead>
                  <TableBody>
                    {built.rows.length === 0 && <TableRow><TableCell colSpan={built.columns.length}><Typography variant="body2" color="text.disabled" sx={{ py: 2, textAlign: 'center' }}>No rows.</Typography></TableCell></TableRow>}
                    {built.rows.map((row, ri) => (
                      <TableRow key={ri} hover>
                        {row.map((cell, ci) => (
                          <TableCell key={ci} align={ci === 0 ? 'left' : 'right'}>
                            {cell && cell.__company ? <CompanyLink code={cell.code} name={cell.name} />
                              : ['OVERDUE', 'UNMANAGED'].includes(cell) ? <Chip size="small" color="error" label={cell} sx={{ height: 18, '& .MuiChip-label': { px: 0.7, fontSize: '0.6rem' } }} />
                                : (ci > 0 && BAND[cell]) ? <Chip size="small" color={BAND[cell]} variant="outlined" label={cell} sx={{ height: 18, '& .MuiChip-label': { px: 0.7, fontSize: '0.6rem' } }} />
                                  : cell}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Card>
        </Grid>
      </Grid>
      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
