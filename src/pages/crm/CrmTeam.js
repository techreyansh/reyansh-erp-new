// Team Management view (A Phase 4) — per-salesperson client-book performance.
// CEO/manager visibility: who manages how many accounts, pipeline value,
// follow-ups due, dormant, conversion. Built on crm_team_performance.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Grid, Card, CardContent, Chip, Table, TableHead, TableRow,
  TableCell, TableBody, CircularProgress, Alert, Avatar,
} from '@mui/material';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import crmPipelineService from '../../services/crmPipelineService';

const inrK = (n) => { const v = Number(n || 0); return v >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : `₹${v.toLocaleString('en-IN')}`; };

export default function CrmTeam() {
  const [rows, setRows] = useState([]);
  const [names, setNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [team, users] = await Promise.all([crmPipelineService.teamPerformance(), crmPipelineService.listAssignableUsers().catch(() => [])]);
      const nm = {}; (users || []).forEach((u) => { nm[(u.email || '').toLowerCase()] = u.full_name || u.name || u.email; });
      setNames(nm); setRows(team);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const label = (email) => (!email ? 'Unassigned' : names[email.toLowerCase()] || email);
  const tot = rows.reduce((a, r) => ({ clients: a.clients + r.clients, pipeline: a.pipeline + Number(r.pipeline_value || 0), fu: a.fu + r.followups_due, dormant: a.dormant + r.dormant }), { clients: 0, pipeline: 0, fu: 0, dormant: 0 });

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <GroupsOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Team Performance</Typography>
        <Chip size="small" variant="outlined" label="client books" color="primary" />
      </Stack>

      {loading ? <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress /></Stack> : err ? <Alert severity="error">{err}</Alert> : (
        <>
          <Grid container spacing={1.5} sx={{ mb: 2 }}>
            {[['Salespeople', rows.filter((r) => r.owner_email).length, 'primary'], ['Total clients', tot.clients, 'secondary'], ['Pipeline value', inrK(tot.pipeline), 'success'], ['Follow-ups due', tot.fu, tot.fu ? 'warning' : 'success'], ['Dormant', tot.dormant, tot.dormant ? 'error' : 'success']].map(([l, v, c]) => (
              <Grid item xs={6} sm={2.4} key={l}><Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.58rem' }}>{l}</Typography>
                <Typography variant="h6" sx={{ fontWeight: 800, color: `${c}.main` }}>{v}</Typography>
              </CardContent></Card></Grid>
            ))}
          </Grid>

          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead><TableRow>{['Salesperson', 'Clients', 'Key a/c', 'Dormant', 'Pipeline', 'Follow-ups due', 'Prospects', 'Conversion'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }} align={h === 'Salesperson' ? 'left' : 'right'}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>{rows.map((r, i) => (
                  <TableRow key={i} hover>
                    <TableCell><Stack direction="row" spacing={1} alignItems="center"><Avatar sx={{ width: 26, height: 26, fontSize: 12 }}>{label(r.owner_email)[0]}</Avatar><Typography variant="body2" sx={{ fontWeight: 600 }}>{label(r.owner_email)}</Typography></Stack></TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{r.clients}</TableCell>
                    <TableCell align="right">{r.key_accounts}</TableCell>
                    <TableCell align="right" sx={{ color: r.dormant ? 'error.main' : 'text.secondary' }}>{r.dormant}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{inrK(r.pipeline_value)}</TableCell>
                    <TableCell align="right"><Chip size="small" label={r.followups_due} color={r.followups_due ? 'warning' : 'default'} variant={r.followups_due ? 'filled' : 'outlined'} /></TableCell>
                    <TableCell align="right">{r.prospects}</TableCell>
                    <TableCell align="right">{r.conversion_rate}%</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </Box>
          </Card>
        </>
      )}
    </Container>
  );
}
