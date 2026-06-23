// Cost Control — the dynamic costing command center. Edit a master rate and see
// (and apply) its impact across every product costing. Built on rateMasterService.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Grid, Card, CardContent, Chip, Table, TableHead, TableRow,
  TableCell, TableBody, CircularProgress, Alert, Snackbar, Button, Tabs, Tab, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, IconButton, Tooltip,
} from '@mui/material';
import CalculateOutlined from '@mui/icons-material/CalculateOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import rateMaster from '../../services/rateMasterService';
import { REPORTS } from '../../services/costingReportsService';
import ReportExportButton from '../../components/common/ReportExportButton';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pct = (n) => `${Number(n || 0).toFixed(2)}%`;
const RATE_TYPE_LABEL = { material: 'Materials', labour: 'Labour', machine: 'Machine', power: 'Power', overhead_pct: 'Overhead %', finance_pct: 'Finance %', margin_pct: 'Margin %' };
const KEY_RATES = ['COPPER', 'PVC_INS', 'LABOUR_RATE', 'OVERHEAD_PCT', 'MARGIN_PCT'];

function ImpactTable({ rows }) {
  const affected = rows.filter((r) => Math.abs(r.delta.total_cost) > 0.001 || Math.abs(r.delta.net_margin_pct) > 0.001);
  if (!affected.length) return <Alert severity="info" sx={{ mt: 1 }}>No products are affected by this change.</Alert>;
  return (
    <Box sx={{ overflowX: 'auto', mt: 1 }}>
      <Table size="small">
        <TableHead><TableRow>{['Product', 'Current cost', 'New cost', 'Δ Cost', 'Current price', 'New price', 'Margin'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.7rem' }} align={h === 'Product' ? 'left' : 'right'}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>{affected.map((r) => {
          const up = r.delta.total_cost > 0;
          return (
            <TableRow key={r.version_id} hover>
              <TableCell sx={{ fontWeight: 600 }}>{r.product_name}<Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace' }}>{r.costing_no}</Typography></TableCell>
              <TableCell align="right">{inr(r.current.total_cost)}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>{inr(r.new.total_cost)}</TableCell>
              <TableCell align="right" sx={{ color: up ? 'error.main' : 'success.main', fontWeight: 700 }}>{up ? '+' : ''}{inr(r.delta.total_cost)} ({up ? '+' : ''}{pct(r.delta.total_cost_pct)})</TableCell>
              <TableCell align="right">{inr(r.current.net_selling_price)}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>{inr(r.new.net_selling_price)}</TableCell>
              <TableCell align="right"><Chip size="small" variant="outlined" label={pct(r.new.net_margin_pct)} color={r.new.net_margin_pct < r.new.target_margin_pct ? 'warning' : 'success'} /></TableCell>
            </TableRow>
          );
        })}</TableBody>
      </Table>
    </Box>
  );
}

function EditRateDialog({ rate, onClose, onApplied, setSnack }) {
  const [newRate, setNewRate] = useState('');
  const [reason, setReason] = useState('');
  const [impact, setImpact] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (rate) { setNewRate(String(rate.rate)); setReason(''); setImpact(null); } }, [rate]);

  const preview = async () => {
    setBusy(true);
    try { setImpact(await rateMaster.whatIf({ [rate.material_code]: Number(newRate) })); }
    catch (e) { setSnack({ message: e.message, severity: 'error' }); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true);
    try {
      const r = await rateMaster.updateRate(rate.material_code, Number(newRate), reason || 'Rate update');
      setSnack({ message: `${rate.material_code} updated — ${r.affected} product(s) recosted.`, severity: 'success' });
      onApplied();
    } catch (e) { setSnack({ message: e.message, severity: 'error' }); }
    finally { setBusy(false); }
  };

  const changed = newRate !== '' && Number(newRate) !== Number(rate?.rate);
  return (
    <Dialog open={!!rate} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{rate?.material_name} <Typography component="span" variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>({rate?.material_code})</Typography></DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="body2" color="text.secondary">Current: <strong>{rate?.rate}</strong> {rate?.uom}</Typography>
          <TextField label="New rate" type="number" size="small" value={newRate} onChange={(e) => { setNewRate(e.target.value); setImpact(null); }} sx={{ width: 140 }} />
          <TextField label="Reason" size="small" value={reason} onChange={(e) => setReason(e.target.value)} sx={{ flexGrow: 1 }} placeholder="e.g. LME copper up" />
          <Button variant="outlined" onClick={preview} disabled={!changed || busy} sx={{ borderRadius: 2 }}>Preview impact</Button>
        </Stack>
        {impact && <>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>Cost impact analysis</Typography>
          <ImpactTable rows={impact} />
        </>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel (simulation)</Button>
        <Button variant="contained" color="warning" onClick={apply} disabled={!changed || busy}>
          {busy ? 'Applying…' : 'Apply & recost products'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DashboardTab({ data, onRecostAll, recosting }) {
  const byCode = Object.fromEntries(data.rates.map((r) => [r.material_code, r]));
  return (
    <Box>
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {[['Master rates', data.rates.length, 'primary'], ['Products costed', data.totalProducts, 'secondary'], ['Stale vs rates', data.stale, data.stale ? 'warning' : 'success'], ['Below target margin', data.belowTarget, data.belowTarget ? 'error' : 'success']].map(([l, v, c]) => (
          <Grid item xs={6} sm={3} key={l}><Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.6rem' }}>{l}</Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, color: `${c}.main` }}>{v}</Typography>
          </CardContent></Card></Grid>
        ))}
      </Grid>

      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1 }}>Key rates</Typography>
        <Button size="small" startIcon={<RefreshRounded />} onClick={onRecostAll} disabled={recosting} variant="outlined" sx={{ borderRadius: 2 }}>
          {recosting ? 'Recosting…' : 'Recalculate all products'}
        </Button>
      </Stack>
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {KEY_RATES.map((code) => { const r = byCode[code]; if (!r) return null; const prev = Number(r.previous_rate);
          const ch = prev ? ((Number(r.rate) - prev) / prev) * 100 : null;
          return (
            <Grid item xs={6} sm={4} md={2.4} key={code}><Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, fontSize: '0.62rem' }}>{r.material_name}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>{r.rate}<Typography component="span" variant="caption" color="text.secondary"> {r.uom}</Typography></Typography>
              {ch != null && <Typography variant="caption" sx={{ color: ch > 0 ? 'error.main' : ch < 0 ? 'success.main' : 'text.disabled' }}>{ch > 0 ? '▲' : ch < 0 ? '▼' : ''} {pct(Math.abs(ch))} vs prev</Typography>}
            </CardContent></Card></Grid>
          );
        })}
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <Box sx={{ px: 2, py: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1 }}><WarningAmberRounded fontSize="small" color={data.belowTarget ? 'error' : 'disabled'} /><Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Margin alerts</Typography></Box>
            {data.marginAlerts.length === 0 ? <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">All products meet target margin.</Typography></Box> : (
              <Table size="small"><TableBody>{data.marginAlerts.map((a, i) => (
                <TableRow key={i}><TableCell sx={{ fontWeight: 600 }}>{a.product_name}</TableCell><TableCell align="right"><Chip size="small" color="error" variant="outlined" label={`${pct(a.net_margin_pct)} / target ${pct(a.target_margin_pct)}`} /></TableCell></TableRow>
              ))}</TableBody></Table>
            )}
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <Box sx={{ px: 2, py: 1, bgcolor: 'action.hover' }}><Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Recent rate changes</Typography></Box>
            {data.recentChanges.length === 0 ? <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">No rate changes logged yet.</Typography></Box> : (
              <Table size="small"><TableHead><TableRow>{['Rate', 'Old → New', 'Δ%', 'Products', 'When'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.68rem' }}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>{data.recentChanges.map((c) => (
                <TableRow key={c.id}><TableCell sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{c.rate_code}</TableCell><TableCell>{c.old_rate} → {c.new_rate}</TableCell><TableCell sx={{ color: Number(c.pct_change) > 0 ? 'error.main' : 'success.main' }}>{c.pct_change != null ? pct(c.pct_change) : '—'}</TableCell><TableCell>{c.affected_versions}</TableCell><TableCell><Typography variant="caption" color="text.secondary">{new Date(c.changed_at).toLocaleDateString('en-IN')}</Typography></TableCell></TableRow>
              ))}</TableBody></Table>
            )}
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

function RateMasterTab({ rates, onEdit }) {
  const groups = rates.reduce((acc, r) => { (acc[r.rate_type] ||= []).push(r); return acc; }, {});
  return (
    <Stack spacing={2}>
      {Object.entries(groups).map(([type, rows]) => (
        <Card key={type} variant="outlined" sx={{ borderRadius: 2 }}>
          <Box sx={{ px: 2, py: 1, bgcolor: 'action.hover' }}><Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{RATE_TYPE_LABEL[type] || type}</Typography></Box>
          <Table size="small">
            <TableHead><TableRow>{['Code', 'Name', 'Current', 'Previous', 'Effective', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.7rem' }} align={['Current', 'Previous'].includes(h) ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>{rows.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{r.material_code}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{r.material_name}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>{r.rate} <Typography component="span" variant="caption" color="text.secondary">{r.uom}</Typography></TableCell>
                <TableCell align="right" color="text.secondary">{r.previous_rate ?? '—'}</TableCell>
                <TableCell><Typography variant="caption" color="text.secondary">{r.effective_from}</Typography></TableCell>
                <TableCell align="right"><Tooltip title="Edit rate + preview impact"><IconButton size="small" onClick={() => onEdit(r)}><EditOutlined fontSize="small" /></IconButton></Tooltip></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </Card>
      ))}
    </Stack>
  );
}

function WhatIfTab({ rates, setSnack }) {
  const [over, setOver] = useState({});
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const editable = rates.filter((r) => KEY_RATES.includes(r.material_code));

  const run = async () => {
    const overrides = {};
    Object.entries(over).forEach(([k, v]) => { if (v !== '' && v != null) overrides[k] = Number(v); });
    if (!Object.keys(overrides).length) { setSnack({ message: 'Enter at least one hypothetical rate.', severity: 'info' }); return; }
    setBusy(true);
    try { setRows(await rateMaster.whatIf(overrides)); }
    catch (e) { setSnack({ message: e.message, severity: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>Test hypothetical rates and see the cost/margin impact instantly. <strong>Nothing is saved.</strong></Alert>
      <Card variant="outlined" sx={{ borderRadius: 2, p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
          {editable.map((r) => (
            <TextField key={r.material_code} label={`${r.material_name} (${r.rate})`} type="number" size="small" sx={{ width: 180 }}
              value={over[r.material_code] ?? ''} onChange={(e) => setOver((o) => ({ ...o, [r.material_code]: e.target.value }))} placeholder={String(r.rate)} />
          ))}
          <Button variant="contained" onClick={run} disabled={busy} sx={{ borderRadius: 2 }}>{busy ? 'Simulating…' : 'Run simulation'}</Button>
        </Stack>
      </Card>
      {rows && <Card variant="outlined" sx={{ borderRadius: 2, p: 1.5 }}><ImpactTable rows={rows} /></Card>}
    </Box>
  );
}

function ReportsTab({ setSnack }) {
  const [sel, setSel] = useState('profitability');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (key) => {
    setLoading(true);
    try { setReport(await REPORTS.find((r) => r.key === key).build()); }
    catch (e) { setSnack({ message: e.message, severity: 'error' }); }
    finally { setLoading(false); }
  }, [setSnack]);
  useEffect(() => { load(sel); }, [sel, load]);
  const section = report?.sections?.[0];
  return (
    <Box>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }} alignItems="center">
        {REPORTS.map((r) => <Chip key={r.key} label={r.label} clickable color={sel === r.key ? 'primary' : 'default'} variant={sel === r.key ? 'filled' : 'outlined'} onClick={() => setSel(r.key)} />)}
        <Box sx={{ flexGrow: 1 }} />
        {report && <ReportExportButton buildReport={() => report} label="Export" />}
      </Stack>
      {loading || !report ? <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack> : (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <Box sx={{ px: 2, py: 1, bgcolor: 'action.hover' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{report.title}</Typography>
            <Stack direction="row" spacing={2} flexWrap="wrap">{report.kpis.map((k) => <Typography key={k.label} variant="caption" color="text.secondary">{k.label}: <strong>{k.value}</strong></Typography>)}</Stack>
          </Box>
          {section.rows.length === 0 ? <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">{section.emptyText}</Typography></Box> : (
            <Box sx={{ overflowX: 'auto' }}><Table size="small" stickyHeader>
              <TableHead><TableRow>{section.columns.map((c) => <TableCell key={c.key} sx={{ fontWeight: 700, fontSize: '0.7rem' }}>{c.label}</TableCell>)}</TableRow></TableHead>
              <TableBody>{section.rows.map((row, i) => <TableRow key={i} hover>{section.columns.map((c) => <TableCell key={c.key} sx={{ fontSize: '0.78rem' }}>{row[c.key]}</TableCell>)}</TableRow>)}</TableBody>
            </Table></Box>
          )}
        </Card>
      )}
    </Box>
  );
}

export default function CostControl() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState(null);
  const [editRate, setEditRate] = useState(null);
  const [recosting, setRecosting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await rateMaster.dashboard()); }
    catch (e) { setSnack({ message: e.message || 'Failed', severity: 'error' }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const recostAll = async () => {
    setRecosting(true);
    try { const n = await rateMaster.recostAll(); setSnack({ message: `Recosted ${n} product(s) at current rates.`, severity: 'success' }); await load(); }
    catch (e) { setSnack({ message: e.message, severity: 'error' }); }
    finally { setRecosting(false); }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <CalculateOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Cost Control</Typography>
        <Chip size="small" variant="outlined" label="dynamic costing" color="primary" />
      </Stack>

      {loading || !data ? <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress /></Stack> : (
        <>
          <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Tab label="Dashboard" /><Tab label="Rate Master" /><Tab label="What-If" /><Tab label="Reports" />
          </Tabs>
          {tab === 0 && <DashboardTab data={data} onRecostAll={recostAll} recosting={recosting} />}
          {tab === 1 && <RateMasterTab rates={data.rates} onEdit={setEditRate} />}
          {tab === 2 && <WhatIfTab rates={data.rates} setSnack={setSnack} />}
          {tab === 3 && <ReportsTab setSnack={setSnack} />}
        </>
      )}

      <EditRateDialog rate={editRate} onClose={() => setEditRate(null)} onApplied={() => { setEditRate(null); load(); }} setSnack={setSnack} />
      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
