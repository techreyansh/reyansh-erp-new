// NPD Intelligence — reporting / MIS over the New Product Development module.
// Funnel, stage aging, turnaround, feedback-outcome mix, throughput and engineer
// load over npd_project + npd_stage_history (+ feedback/quality/dispatch), via the
// npd_intel_summary RPC. Mirrors the Production Intelligence Center pattern.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Stack, Card, CardContent, Typography, Button, IconButton, Chip, TextField, MenuItem,
  CircularProgress, Tooltip, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Paper, useTheme, alpha, Alert,
} from '@mui/material';
import { Insights as IntelIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, XAxis, YAxis,
  Tooltip as RTooltip, CartesianGrid, Cell, Legend,
} from 'recharts';
import npdMetricsService from '../../services/npdMetricsService';
import { NPD_STAGE_LABEL } from '../../services/npdService';
import ReportExportButton from '../../components/common/ReportExportButton';
import { buildNpdReport } from '../../services/reporting/operationsReports';

const iso = (d) => d.toISOString().slice(0, 10);
const num = (v) => Number(v || 0).toLocaleString('en-IN');
const PRESETS = [{ d: 30, l: '30d' }, { d: 90, l: '90d' }, { d: 180, l: '180d' }];
const OUTCOME_LABEL = {
  pending: 'Pending', approved: 'Approved', approved_with_changes: 'Approved w/ changes',
  rejected: 'Rejected', resample: 'Resample',
};
const stageLabel = (k) => NPD_STAGE_LABEL[k] || k;

function Kpi({ label, value, color, sub }) {
  const theme = useTheme();
  const c = theme.palette[color] || theme.palette.primary;
  return (
    <Card variant="outlined" sx={{ borderRadius: 2.5, flex: 1, minWidth: 130 }}>
      <CardContent sx={{ py: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{label}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 800, color: c.main, lineHeight: 1.2 }}>{value}</Typography>
        {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, data, x, y, color, theme }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2.5 }}>
      <CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{title}</Typography>
        {(!data || data.length === 0) ? (
          <Typography variant="caption" color="text.secondary">No data in range.</Typography>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.text.primary, 0.08)} />
              <XAxis dataKey={x} fontSize={11} interval={0} angle={-20} textAnchor="end" height={60} /><YAxis fontSize={11} /><RTooltip />
              <Bar dataKey={y} fill={color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export default function NPDIntelligence() {
  const theme = useTheme();
  const navigate = useNavigate();
  const [from, setFrom] = useState(iso(new Date(Date.now() - 180 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [engineer, setEngineer] = useState('all');
  const [devType, setDevType] = useState('all');
  const [opts, setOpts] = useState({ engineers: [], devTypes: [] });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { npdMetricsService.filterOptions().then(setOpts).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await npdMetricsService.summary({
        from, to, engineer: engineer === 'all' ? null : engineer, devType: devType === 'all' ? null : devType,
      });
      setData(res);
    } catch (e) {
      setError(e?.message || 'Failed to load NPD metrics.');
      setData(null);
    } finally { setLoading(false); }
  }, [from, to, engineer, devType]);
  useEffect(() => { load(); }, [load]);

  const setPreset = (days) => { setFrom(iso(new Date(Date.now() - days * 86400000))); setTo(iso(new Date())); };
  const k = data?.kpis || {};

  // Map raw stage/outcome keys to display labels for the charts.
  const funnel = useMemo(() => (data?.funnel || []).map((d) => ({ ...d, label: stageLabel(d.stage) })), [data]);
  const aging = useMemo(() => (data?.stage_aging || []).map((d) => ({ ...d, label: stageLabel(d.stage) })), [data]);
  const outcomes = useMemo(() => (data?.outcome_mix || []).map((d) => ({ ...d, label: OUTCOME_LABEL[d.outcome] || d.outcome })), [data]);
  const palette = useMemo(() => [theme.palette.success.main, theme.palette.info.main, theme.palette.warning.main, theme.palette.error.main, theme.palette.grey[500]], [theme]);

  const empty = !loading && data && (k.active || 0) === 0 && funnel.length === 0
    && (data.throughput_trend || []).length === 0 && outcomes.length === 0;

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <IntelIcon color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>NPD Intelligence</Typography>
        <Chip size="small" variant="outlined" color="primary" label="development analytics" />
        <Box sx={{ flexGrow: 1 }} />
        {!loading && !error && data && <ReportExportButton buildReport={() => buildNpdReport(data, { from, to })} label="Export" />}
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
        <Stack direction="row" spacing={0.5}>
          {PRESETS.map((p) => <Button key={p.l} size="small" variant="outlined" onClick={() => setPreset(p.d)}>{p.l}</Button>)}
        </Stack>
        <TextField type="date" size="small" label="From" InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField type="date" size="small" label="To" InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setTo(e.target.value)} />
        <TextField select size="small" label="Engineer" value={engineer} onChange={(e) => setEngineer(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="all">All engineers</MenuItem>
          {opts.engineers.map((e) => <MenuItem key={e} value={e}>{e}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Development type" value={devType} onChange={(e) => setDevType(e.target.value)} sx={{ minWidth: 170 }}>
          <MenuItem value="all">All types</MenuItem>
          {opts.devTypes.map((t) => <MenuItem key={t.v} value={t.v}>{t.l}</MenuItem>)}
        </TextField>
        <Tooltip title="Refresh"><span><IconButton onClick={load} disabled={loading}><RefreshIcon /></IconButton></span></Tooltip>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Pipeline health, stage aging, turnaround and customer-feedback outcomes across all developments. Snapshot
        metrics (funnel, aging, delayed, engineer load) reflect current state; throughput and approval-rate honor the date range.
      </Alert>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : error ? (
        <Alert severity="error">{error}</Alert>
      ) : empty ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 2.5 }}>
          <Typography color="text.secondary">No development activity for these filters. Create NPD projects or widen the dates.</Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <Kpi label="Active developments" value={num(k.active)} color="primary" />
            <Kpi label="Approved (in range)" value={num(k.approved_in_range)} color="success" />
            <Kpi label="Delayed" value={num(k.delayed)} color={k.delayed > 0 ? 'error' : 'success'} sub="past target, active" />
            <Kpi label="Awaiting feedback" value={num(k.awaiting_feedback)} color="info" />
            <Kpi label="Overdue feedback" value={num(k.overdue_feedback)} color={k.overdue_feedback > 0 ? 'error' : 'success'} />
            <Kpi label="Avg turnaround" value={k.avg_turnaround_days == null ? '—' : `${k.avg_turnaround_days} d`} color="secondary" sub="created → approved" />
            <Kpi label="Approval rate" value={k.approval_rate == null ? '—' : `${k.approval_rate}%`} color="success" />
            <Kpi label="Sample pass rate" value={k.sample_pass_rate == null ? '—' : `${k.sample_pass_rate}%`} color={(k.sample_pass_rate ?? 100) < 80 ? 'warning' : 'success'} />
          </Stack>

          <Card variant="outlined" sx={{ borderRadius: 2.5 }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Approvals per month</Typography>
              {(data.throughput_trend || []).length === 0 ? (
                <Typography variant="caption" color="text.secondary">No approvals in range.</Typography>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={data.throughput_trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.text.primary, 0.08)} />
                    <XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} allowDecimals={false} /><RTooltip />
                    <Line type="monotone" dataKey="approved" name="Approved" stroke={theme.palette.success.main} strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
            <ChartCard title="Pipeline by stage (active)" data={funnel} x="label" y="count" color={theme.palette.primary.main} theme={theme} />
            <ChartCard title="Avg days in stage" data={aging} x="label" y="avg_days" color={theme.palette.warning.main} theme={theme} />
            <Card variant="outlined" sx={{ borderRadius: 2.5 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Feedback outcomes</Typography>
                {outcomes.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">No feedback recorded.</Typography>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={outcomes} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={80} label>
                        {outcomes.map((o, i) => <Cell key={o.outcome} fill={palette[i % palette.length]} />)}
                      </Pie>
                      <RTooltip /><Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <ChartCard title="Active load by engineer" data={data.by_engineer} x="engineer" y="count" color={theme.palette.info.main} theme={theme} />
          </Box>

          <Card variant="outlined" sx={{ borderRadius: 2.5 }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Delayed developments</Typography>
              {(data.delayed_list || []).length === 0 ? (
                <Typography variant="caption" color="text.secondary">Nothing past its target date.</Typography>
              ) : (
                <TableContainer><Table size="small">
                  <TableHead><TableRow>{['Project', 'Product', 'Customer', 'Stage', 'Engineer', 'Target', 'Overdue'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>)}</TableRow></TableHead>
                  <TableBody>
                    {data.delayed_list.map((p) => (
                      <TableRow key={p.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/npd/${p.id}`)}>
                        <TableCell sx={{ fontWeight: 600 }}>{p.project_no}</TableCell>
                        <TableCell>{p.product}</TableCell>
                        <TableCell>{p.customer}</TableCell>
                        <TableCell><Chip size="small" variant="outlined" label={stageLabel(p.stage)} /></TableCell>
                        <TableCell>{p.engineer || '—'}</TableCell>
                        <TableCell>{p.target_date}</TableCell>
                        <TableCell><Chip size="small" color="error" label={`${num(p.days_overdue)}d`} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table></TableContainer>
              )}
            </CardContent>
          </Card>
        </Stack>
      )}
    </Box>
  );
}
