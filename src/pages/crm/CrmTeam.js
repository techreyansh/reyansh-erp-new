// Team Management + Client Reports (A Phase 4 & 5). Per-salesperson client-book
// metrics (crm_team_performance) + exportable client reports (health/at-risk/
// employee-wise) built on crm_client_health + the report engine.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Grid, Card, CardContent, Chip, Table, TableHead, TableRow,
  TableCell, TableBody, CircularProgress, Alert, Avatar, Tabs, Tab, Tooltip,
} from '@mui/material';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import crmPipelineService from '../../services/crmPipelineService';
import CompanyLink from '../../components/crm/CompanyLink';
import ReportExportButton from '../../components/common/ReportExportButton';

const inrK = (n) => { const v = Number(n || 0); return v >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : `₹${v.toLocaleString('en-IN')}`; };
const BAND = { green: 'success', yellow: 'warning', red: 'error' };

function TeamTab({ rows, names }) {
  const label = (email) => (!email ? 'Unassigned' : names[email.toLowerCase()] || email);
  const tot = rows.reduce((a, r) => ({ clients: a.clients + r.clients, pipeline: a.pipeline + Number(r.pipeline_value || 0), fu: a.fu + r.followups_due, dormant: a.dormant + r.dormant }), { clients: 0, pipeline: 0, fu: 0, dormant: 0 });
  return (
    <>
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {[['Salespeople', rows.filter((r) => r.owner_email).length, 'primary'], ['Total clients', tot.clients, 'secondary'], ['Pipeline value', inrK(tot.pipeline), 'success'], ['Follow-ups due', tot.fu, tot.fu ? 'warning' : 'success'], ['Dormant', tot.dormant, tot.dormant ? 'error' : 'success']].map(([l, v, c]) => (
          <Grid item xs={6} sm={2.4} key={l}><Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.58rem' }}>{l}</Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, color: `${c}.main` }}>{v}</Typography>
          </CardContent></Card></Grid>
        ))}
      </Grid>
      <Card variant="outlined" sx={{ borderRadius: 2 }}><Box sx={{ overflowX: 'auto' }}><Table size="small">
        <TableHead><TableRow>{['Salesperson', 'Clients', 'Key a/c', 'Dormant', 'Pipeline', 'Follow-ups due', 'Actions', 'Prospects', 'Conversion'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }} align={h === 'Salesperson' ? 'left' : 'right'}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>{rows.map((r, i) => (
          <TableRow key={i} hover>
            <TableCell><Stack direction="row" spacing={1} alignItems="center"><Avatar sx={{ width: 26, height: 26, fontSize: 12 }}>{label(r.owner_email)[0]}</Avatar><Typography variant="body2" sx={{ fontWeight: 600 }}>{label(r.owner_email)}</Typography></Stack></TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>{r.clients}</TableCell><TableCell align="right">{r.key_accounts}</TableCell>
            <TableCell align="right" sx={{ color: r.dormant ? 'error.main' : 'text.secondary' }}>{r.dormant}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>{inrK(r.pipeline_value)}</TableCell>
            <TableCell align="right"><Chip size="small" label={r.followups_due} color={r.followups_due ? 'warning' : 'default'} variant={r.followups_due ? 'filled' : 'outlined'} /></TableCell>
            <TableCell align="right"><Tooltip title="Open actions assigned to this rep on accounts they don't own"><span>{r.actions_assigned || 0}</span></Tooltip></TableCell>
            <TableCell align="right">{r.prospects}</TableCell><TableCell align="right">{r.conversion_rate}%</TableCell>
          </TableRow>
        ))}</TableBody>
      </Table></Box></Card>
    </>
  );
}

const REPORTS = [
  { key: 'health', label: 'Client Health' },
  { key: 'atrisk', label: 'At-Risk Clients' },
  { key: 'dormant', label: 'Dormant / No Order' },
];

function ReportsTab({ health, names }) {
  const [sel, setSel] = useState('health');
  const filtered = sel === 'atrisk' ? health.filter((h) => h.band === 'red')
    : sel === 'dormant' ? health.filter((h) => h.due_status === 'overdue' || (h.recency_days || 0) > 120)
      : health;
  const report = {
    key: `client-${sel}`, title: REPORTS.find((r) => r.key === sel).label + ' Report', subtitle: 'Reyansh International', generatedAt: new Date(),
    kpis: [{ label: 'Clients', value: filtered.length }, { label: 'Avg health', value: Math.round(filtered.reduce((s, h) => s + Number(h.health_score || 0), 0) / (filtered.length || 1)) }],
    sections: [{
      key: 'c', title: REPORTS.find((r) => r.key === sel).label,
      columns: [{ key: 'company', label: 'Client' }, { key: 'owner', label: 'Owner' }, { key: 'health', label: 'Health' }, { key: 'band', label: 'Band' }, { key: 'orders', label: 'Orders' }, { key: 'recency', label: 'Days since order' }, { key: 'overdue', label: 'Overdue AR' }, { key: 'value', label: 'Value (12m)' }],
      rows: filtered.map((h) => ({ company: h.company_name, owner: names[(h.owner_email || '').toLowerCase()] || h.owner_email || 'Unassigned', health: h.health_score, band: h.band, orders: h.order_count, recency: h.recency_days, overdue: `₹${Number(h.overdue_balance || 0).toLocaleString('en-IN')}`, value: `₹${Number(h.value_12mo || 0).toLocaleString('en-IN')}` })),
      emptyText: 'No clients match.',
    }],
  };
  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="center" flexWrap="wrap" useFlexGap>
        {REPORTS.map((r) => <Chip key={r.key} label={r.label} clickable color={sel === r.key ? 'primary' : 'default'} variant={sel === r.key ? 'filled' : 'outlined'} onClick={() => setSel(r.key)} />)}
        <Box sx={{ flexGrow: 1 }} />
        <ReportExportButton buildReport={() => report} label="Export" />
      </Stack>
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        {filtered.length === 0 ? <Box sx={{ p: 3 }}><Typography variant="body2" color="text.secondary">No clients match this report.</Typography></Box> : (
          <Box sx={{ overflowX: 'auto' }}><Table size="small">
            <TableHead><TableRow>{['Client', 'Owner', 'Health', 'Orders', 'Days since order', 'Overdue AR', 'Value (12m)'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }} align={['Health', 'Orders', 'Days since order', 'Overdue AR', 'Value (12m)'].includes(h) ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>{filtered.map((h, i) => (
              <TableRow key={i} hover>
                <TableCell sx={{ fontWeight: 600 }}><CompanyLink code={h.customer_code} name={h.company_name} /></TableCell>
                <TableCell>{names[(h.owner_email || '').toLowerCase()] || h.owner_email || 'Unassigned'}</TableCell>
                <TableCell align="right"><Chip size="small" color={BAND[h.band]} variant="outlined" label={h.health_score} /></TableCell>
                <TableCell align="right">{h.order_count}</TableCell>
                <TableCell align="right">{h.recency_days}</TableCell>
                <TableCell align="right" sx={{ color: h.overdue_balance ? 'error.main' : 'text.secondary' }}>₹{Number(h.overdue_balance || 0).toLocaleString('en-IN')}</TableCell>
                <TableCell align="right">₹{Number(h.value_12mo || 0).toLocaleString('en-IN')}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></Box>
        )}
      </Card>
    </Box>
  );
}

export default function CrmTeam() {
  const [tab, setTab] = useState(0);
  const [rows, setRows] = useState([]);
  const [health, setHealth] = useState([]);
  const [names, setNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [team, hp, users] = await Promise.all([crmPipelineService.teamPerformance(), crmPipelineService.clientHealth(), crmPipelineService.listAssignableUsers().catch(() => [])]);
      const nm = {}; (users || []).forEach((u) => { nm[(u.email || '').toLowerCase()] = u.full_name || u.name || u.email; });
      setNames(nm); setRows(team); setHealth(hp);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <GroupsOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Team &amp; Client Reports</Typography>
        <Chip size="small" variant="outlined" label="account management" color="primary" />
      </Stack>
      <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Team Performance" /><Tab label="Client Reports" />
      </Tabs>
      {loading ? <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress /></Stack> : err ? <Alert severity="error">{err}</Alert> : (
        tab === 0 ? <TeamTab rows={rows} names={names} /> : <ReportsTab health={health} names={names} />
      )}
    </Container>
  );
}
