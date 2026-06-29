import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Stack, Card, CardContent, Typography, Button, IconButton, Chip, TextField, MenuItem,
  CircularProgress, Tooltip, Divider, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Paper, useTheme, alpha, Tabs, Tab, Autocomplete,
} from '@mui/material';
import {
  Insights as IntelIcon, Refresh as RefreshIcon, UploadFile as UploadIcon,
  WarningAmber as WarnIcon, ErrorOutline as CritIcon, InfoOutlined as InfoIcon,
  AutoAwesome as AiIcon,
} from '@mui/icons-material';
import { Alert } from '@mui/material';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip as RTooltip, CartesianGrid, Cell,
} from 'recharts';
import productionIntelligenceService from '../../services/productionIntelligenceService';
import { analyzeRows } from '../../services/productionLogService';
import productionMetricsService from '../../services/productionMetricsService';

const iso = (d) => d.toISOString().slice(0, 10);
const SEV_ICON = { critical: <CritIcon color="error" />, warning: <WarnIcon color="warning" />, info: <InfoIcon color="info" /> };
const SEV_COLOR = { critical: 'error', warning: 'warning', info: 'info' };
const AI_PRESETS = [
  { tool: 'daily_summary', label: 'Summarise this period' },
  { tool: 'line_performance', label: 'Underperforming lines?' },
  { tool: 'anomalies', label: 'Explain the anomalies' },
  { tool: 'material_impact', label: 'Material-shortage impact' },
  { tool: 'machine_utilization', label: 'Bottlenecks & utilisation' },
  { tool: 'shift_comparison', label: 'Compare time-slots' },
];

const UploadedLogsTab = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const today = new Date();
  const monthAgo = new Date(Date.now() - 35 * 86400000);
  const [from, setFrom] = useState(iso(monthAgo));
  const [to, setTo] = useState(iso(today));
  const [department, setDepartment] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ai, setAi] = useState({ loading: false, result: null, error: null });
  const [chat, setChat] = useState([]); // {role:'user'|'ai', text?, sections?, error?}
  const [q, setQ] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  // Send a question (free-form) or a preset tool to the production AI, using the
  // already-loaded dashboard as context (no re-query).
  const sendChat = useCallback(async (tool, label) => {
    if (chatBusy || !data || !data.rows) return;
    const userText = label || q.trim();
    if (!userText) return;
    const ctx = { from, to, department, kpis: data.kpis, trendByDate: data.trendByDate, downtimeByReason: data.downtimeByReason, byLine: data.byLine, anomalies: data.anomalies };
    setChat((c) => [...c, { role: 'user', text: userText }]);
    if (!tool) setQ('');
    setChatBusy(true);
    const res = await productionIntelligenceService.askProduction(tool || 'ask', tool ? '' : userText, ctx);
    setChat((c) => [...c, { role: 'ai', sections: res.sections, error: res.error }]);
    setChatBusy(false);
  }, [chatBusy, data, q, from, to, department]);

  const runAI = useCallback(async () => {
    setAi({ loading: true, result: null, error: null });
    try {
      const rows = await productionIntelligenceService.getRows({ from, to, department });
      if (!rows.length) { setAi({ loading: false, result: null, error: 'No data in this range to analyse.' }); return; }
      const result = await analyzeRows(rows.slice(0, 400));
      setAi({ loading: false, result, error: null });
    } catch (e) { setAi({ loading: false, result: null, error: e.message }); }
  }, [from, to, department]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await productionIntelligenceService.getDashboard({ from, to, department })); }
    catch (e) { setData({ error: e.message, rows: 0 }); }
    setLoading(false);
  }, [from, to, department]);
  useEffect(() => { load(); }, [load]);

  const achColor = (p) => (p >= 90 ? theme.palette.success.main : p >= 75 ? theme.palette.warning.main : theme.palette.error.main);

  const Kpi = ({ label, value, sub, color }) => (
    <Card sx={{ flex: 1, minWidth: 150, borderRadius: 2 }}><CardContent>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Typography>
      <Typography variant="h5" sx={{ fontWeight: 700, color: color || 'text.primary', mt: 0.5 }}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </CardContent></Card>
  );

  return (
    <Box sx={{ p: 3 }}>
      <Card sx={{ background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`, color: 'white', borderRadius: 3, mb: 2 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, py: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IntelIcon sx={{ fontSize: 34 }} />
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>Production Intelligence</Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>KPIs, trends and anomalies from your daily production logs.</Typography>
            </Box>
          </Box>
          <Button onClick={() => navigate('/production-log')} startIcon={<UploadIcon />} variant="contained" color="inherit" sx={{ color: theme.palette.primary.main }}>Upload a log</Button>
        </CardContent>
      </Card>

      {/* Filters */}
      <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap' }} alignItems="center">
        <TextField size="small" type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField size="small" type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField size="small" select label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} sx={{ width: 160 }}>
          {['all', 'assembly', 'cable', 'molding', 'other'].map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
        </TextField>
        <Tooltip title="Refresh"><IconButton onClick={load}><RefreshIcon /></IconButton></Tooltip>
      </Stack>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : !data || data.rows === 0 ? (
        <Card sx={{ borderRadius: 2 }}><CardContent sx={{ textAlign: 'center', py: 8 }}>
          <IntelIcon sx={{ fontSize: 46, color: 'text.disabled', mb: 1 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>No production data in this range</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
            {data?.error ? data.error : 'Upload a daily production report and the AI will structure it — then the KPIs, trends and anomalies appear here.'}
          </Typography>
          <Button variant="contained" startIcon={<UploadIcon />} onClick={() => navigate('/production-log')}>Upload a log</Button>
        </CardContent></Card>
      ) : (
        <Stack spacing={2}>
          {/* KPIs */}
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
            <Kpi label="Achievement" value={`${data.kpis.achievementPct}%`} color={achColor(data.kpis.achievementPct)} sub={`${data.kpis.totalAchieved.toLocaleString('en-IN')} / ${data.kpis.totalTarget.toLocaleString('en-IN')} units`} />
            <Kpi label="Downtime" value={`${Math.round(data.kpis.totalDowntime / 60)}h`} sub={`${data.kpis.totalDowntime.toLocaleString('en-IN')} min total`} color={theme.palette.error.main} />
            <Kpi label="Top loss reason" value={data.kpis.topReason} sub="most downtime" color={theme.palette.warning.main} />
            <Kpi label="Coverage" value={`${data.kpis.days}d`} sub={`${data.kpis.lines} lines`} />
          </Stack>

          {/* AI Analysis */}
          <Card sx={{ borderRadius: 2, border: '1px solid', borderColor: alpha(theme.palette.primary.main, 0.3) }}><CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: ai.result || ai.error ? 1 : 0 }} flexWrap="wrap" gap={1}>
              <Stack direction="row" spacing={1} alignItems="center">
                <AiIcon color="primary" />
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>AI analysis</Typography>
                <Typography variant="caption" color="text.secondary">Gemini reads this period and explains the misses.</Typography>
              </Stack>
              <Button size="small" variant="contained" onClick={runAI} disabled={ai.loading} startIcon={ai.loading ? <CircularProgress size={16} color="inherit" /> : <AiIcon />}>
                {ai.loading ? 'Analysing…' : 'Analyse with AI'}
              </Button>
            </Stack>
            {ai.error && <Alert severity="info" sx={{ mt: 1 }}>{ai.error}</Alert>}
            {ai.result && (
              <Box sx={{ mt: 1 }}>
                <Divider sx={{ mb: 1.5 }} />
                {ai.result.summary && <Typography variant="body2" sx={{ mb: 1.5 }}>{ai.result.summary}</Typography>}
                {Array.isArray(ai.result.root_causes) && ai.result.root_causes.length > 0 && (
                  <Box sx={{ mb: 1.5 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>Root causes</Typography>
                    <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                      {ai.result.root_causes.map((rc, i) => (
                        <Typography key={i} variant="body2">• <b>{rc.title}</b>{rc.detail ? ` — ${rc.detail}` : ''}{rc.line_no ? ` (${rc.line_no}${rc.time_slot ? ' ' + rc.time_slot : ''})` : ''}{rc.lost_units ? ` · ${rc.lost_units} units lost` : ''}</Typography>
                      ))}
                    </Stack>
                  </Box>
                )}
                {Array.isArray(ai.result.recommendations) && ai.result.recommendations.length > 0 && (
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>Recommendations</Typography>
                    <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                      {ai.result.recommendations.map((r, i) => (
                        <Typography key={i} variant="body2">→ {typeof r === 'string' ? r : (r.detail || r.title)}</Typography>
                      ))}
                    </Stack>
                  </Box>
                )}
              </Box>
            )}
          </CardContent></Card>

          {/* Ask the production AI (chat over this period's data) */}
          <Card sx={{ borderRadius: 2, border: '1px solid', borderColor: alpha(theme.palette.secondary.main, 0.35) }}><CardContent>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <AiIcon color="secondary" />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Ask the production AI</Typography>
              <Typography variant="caption" color="text.secondary">Questions answered over this period's data.</Typography>
            </Stack>
            <Stack direction="row" spacing={0.75} sx={{ mb: 1.5, flexWrap: 'wrap' }} useFlexGap>
              {AI_PRESETS.map((p) => (
                <Chip key={p.tool} label={p.label} size="small" variant="outlined" disabled={chatBusy} onClick={() => sendChat(p.tool, p.label)} sx={{ cursor: 'pointer' }} />
              ))}
            </Stack>
            {chat.length > 0 && (
              <Stack spacing={1.5} sx={{ mb: 1.5, maxHeight: 440, overflow: 'auto' }}>
                {chat.map((m, i) => (m.role === 'user' ? (
                  <Box key={i} sx={{ alignSelf: 'flex-end', maxWidth: '85%', bgcolor: alpha(theme.palette.primary.main, 0.1), px: 1.5, py: 0.75, borderRadius: 2 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.text}</Typography>
                  </Box>
                ) : (
                  <Box key={i} sx={{ alignSelf: 'flex-start', maxWidth: '92%' }}>
                    {m.error ? <Alert severity="info">{m.error}</Alert> : (m.sections || []).map((s, j) => (
                      <Box key={j} sx={{ mb: 1 }}>
                        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>{s.heading}</Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{s.body}</Typography>
                      </Box>
                    ))}
                  </Box>
                )))}
                {chatBusy && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={16} /><Typography variant="caption" color="text.secondary">Thinking…</Typography></Stack>}
              </Stack>
            )}
            <Stack direction="row" spacing={1}>
              <TextField size="small" fullWidth placeholder="Ask e.g. “Why did Assembly miss target last week?”" value={q}
                onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim() && !chatBusy) sendChat(); }} disabled={chatBusy} />
              <Button variant="contained" onClick={() => sendChat()} disabled={chatBusy || !q.trim()}>Ask</Button>
            </Stack>
          </CardContent></Card>

          {/* Charts */}
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Card sx={{ borderRadius: 2, flex: 2, minWidth: 0 }}><CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Achievement trend</Typography>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.trendByDate} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.text.primary, 0.08)} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d?.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} domain={[0, 110]} />
                  <RTooltip />
                  <Line type="monotone" dataKey="achievementPct" name="Achievement %" stroke={theme.palette.primary.main} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent></Card>
            <Card sx={{ borderRadius: 2, flex: 1, minWidth: 0 }}><CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Downtime by reason</Typography>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.downtimeByReason} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.text.primary, 0.08)} />
                  <XAxis dataKey="reason" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RTooltip />
                  <Bar dataKey="minutes" name="Downtime (min)" radius={[4, 4, 0, 0]}>
                    {data.downtimeByReason.map((_, i) => <Cell key={i} fill={theme.palette.warning.main} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent></Card>
          </Stack>

          {/* Anomalies */}
          <Card sx={{ borderRadius: 2 }}><CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Anomalies ({data.anomalies.length})</Typography>
            <Divider sx={{ mb: 1 }} />
            {data.anomalies.length === 0 ? <Typography variant="body2" color="text.secondary">Nothing flagged — all lines tracking to target.</Typography> : (
              <Stack spacing={1}>
                {data.anomalies.map((a, i) => (
                  <Stack key={i} direction="row" spacing={1.5} alignItems="center" sx={{ p: 1, borderRadius: 1, bgcolor: alpha(theme.palette[SEV_COLOR[a.severity]].main, 0.06) }}>
                    {SEV_ICON[a.severity]}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{a.title}</Typography>
                      <Typography variant="caption" color="text.secondary">{a.detail}</Typography>
                    </Box>
                    <Chip size="small" label={a.severity} color={SEV_COLOR[a.severity]} sx={{ height: 18 }} />
                  </Stack>
                ))}
              </Stack>
            )}
          </CardContent></Card>

          {/* Line ranking */}
          <Card sx={{ borderRadius: 2 }}><CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Line performance (worst first)</Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
              <Table size="small">
                <TableHead><TableRow>
                  {['Line', 'Dept', 'Achieved', 'Target', 'Achievement', 'Downtime'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}
                </TableRow></TableHead>
                <TableBody>
                  {data.byLine.map((b) => (
                    <TableRow key={b.department + b.line} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{b.line}</TableCell>
                      <TableCell>{b.department}</TableCell>
                      <TableCell>{b.achieved.toLocaleString('en-IN')}</TableCell>
                      <TableCell>{b.target.toLocaleString('en-IN')}</TableCell>
                      <TableCell><Chip size="small" label={`${b.achievementPct}%`} sx={{ height: 20, bgcolor: alpha(achColor(b.achievementPct), 0.15), color: achColor(b.achievementPct), fontWeight: 700 }} /></TableCell>
                      <TableCell>{Math.round(b.downtime)} min</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent></Card>
        </Stack>
      )}
    </Box>
  );
};

// ---------------------------------------------------------------------------
// Operations tab — analytics over the REAL captured job-card data (prod_intel_summary)
// ---------------------------------------------------------------------------
const PRESETS = [{ d: 7, l: '7d' }, { d: 30, l: '30d' }, { d: 90, l: '90d' }];
const num = (v) => Number(v || 0).toLocaleString('en-IN');

function OpsKpi({ label, value, color, sub }) {
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

const OperationsTab = () => {
  const theme = useTheme();
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(iso(today));
  const [lineId, setLineId] = useState('all');
  const [product, setProduct] = useState(null);
  const [opts, setOpts] = useState({ lines: [], products: [] });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { productionMetricsService.filterOptions().then(setOpts).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await productionMetricsService.summary({
        from, to, lineId: lineId === 'all' ? null : lineId, productId: product?.id || null,
      });
      setData(res);
    } catch (e) {
      setError(e?.message || 'Failed to load production metrics.');
      setData(null);
    } finally { setLoading(false); }
  }, [from, to, lineId, product]);
  useEffect(() => { load(); }, [load]);

  const setPreset = (days) => { setFrom(iso(new Date(Date.now() - days * 86400000))); setTo(iso(new Date())); };
  const k = data?.kpis || {};
  const empty = !loading && (k.entries || 0) === 0;
  const palette = useMemo(() => [theme.palette.primary.main, theme.palette.success.main, theme.palette.warning.main, theme.palette.error.main, theme.palette.info.main, theme.palette.secondary.main], [theme]);

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
        <Stack direction="row" spacing={0.5}>
          {PRESETS.map((p) => <Button key={p.l} size="small" variant="outlined" onClick={() => setPreset(p.d)}>{p.l}</Button>)}
        </Stack>
        <TextField type="date" size="small" label="From" InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField type="date" size="small" label="To" InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setTo(e.target.value)} />
        <TextField select size="small" label="Line" value={lineId} onChange={(e) => setLineId(e.target.value)} sx={{ minWidth: 140 }}>
          <MenuItem value="all">All lines</MenuItem>
          {opts.lines.map((l) => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
        </TextField>
        <Autocomplete
          options={opts.products} value={product} onChange={(_, v) => setProduct(v)}
          getOptionLabel={(o) => o?.label || ''} isOptionEqualToValue={(o, v) => o.id === v.id}
          sx={{ minWidth: 220 }}
          renderInput={(p) => <TextField {...p} size="small" label="Product (all)" />}
        />
        <Tooltip title="Refresh"><span><IconButton onClick={load} disabled={loading}><RefreshIcon /></IconButton></span></Tooltip>
      </Stack>

      <Alert severity="info" icon={<InfoIcon />} sx={{ mb: 2 }}>
        OEE, machine utilization and operator efficiency aren't shown — machine-status and attendance aren't instrumented yet. These KPIs come from captured job cards (output, reject, downtime, defects).
      </Alert>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : error ? (
        <Alert severity="error">{error}</Alert>
      ) : empty ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 2.5 }}>
          <Typography color="text.secondary">No job-card activity in this range. Post job cards on the floor (MES) or widen the dates.</Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <OpsKpi label="Units produced" value={num(k.units)} color="primary" sub={`${num(k.entries)} job-card entries`} />
            <OpsKpi label="Open WOs (WIP)" value={num(k.wip)} color="info" />
            <OpsKpi label="Scrap rate" value={`${k.scrap_rate ?? 0}%`} color={k.scrap_rate > 5 ? 'error' : 'success'} sub={`${num(k.scrap)} rejected`} />
            <OpsKpi label="On-time" value={k.on_time_pct == null ? '—' : `${k.on_time_pct}%`} color={(k.on_time_pct ?? 100) < 80 ? 'warning' : 'success'} sub={`${num(k.completed_wos)} completed`} />
            <OpsKpi label="Downtime" value={`${k.downtime_hrs ?? 0} h`} color="warning" />
            <OpsKpi label="Mold alerts" value={num(k.mold_alerts)} color={k.mold_alerts > 0 ? 'error' : 'success'} sub="≥85% tool life" />
          </Stack>

          <Card variant="outlined" sx={{ borderRadius: 2.5 }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Production trend</Typography>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.trend || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.text.primary, 0.08)} />
                  <XAxis dataKey="date" fontSize={11} /><YAxis fontSize={11} /><RTooltip />
                  <Line type="monotone" dataKey="output" name="Output" stroke={theme.palette.primary.main} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="reject" name="Reject" stroke={theme.palette.error.main} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
            <ChartCard title="Output by product" data={data.output_by_product} x="code" y="units" color={theme.palette.primary.main} theme={theme} />
            <ChartCard title="Stage throughput (bottlenecks)" data={data.stage_throughput} x="stage" y="output" color={theme.palette.info.main} theme={theme} />
            <ChartCard title="Defects (Pareto)" data={data.defect_pareto} x="name" y="qty" color={theme.palette.error.main} theme={theme} />
            <ChartCard title="Downtime by reason (min)" data={data.downtime_pareto} x="name" y="minutes" color={theme.palette.warning.main} theme={theme} />
          </Box>

          <Card variant="outlined" sx={{ borderRadius: 2.5 }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Overdue / late work orders</Typography>
              {(data.late_wos || []).length === 0 ? (
                <Typography variant="caption" color="text.secondary">None overdue in this range.</Typography>
              ) : (
                <TableContainer><Table size="small">
                  <TableHead><TableRow>{['WO', 'Product', 'Due', 'Status', 'Completed'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>)}</TableRow></TableHead>
                  <TableBody>
                    {data.late_wos.map((w, i) => (
                      <TableRow key={i} hover>
                        <TableCell sx={{ fontWeight: 600 }}>{w.wo_number}</TableCell>
                        <TableCell>{w.product}</TableCell>
                        <TableCell>{w.due_date}</TableCell>
                        <TableCell><Chip size="small" label={w.status} color={w.status === 'done' ? 'default' : 'warning'} variant="outlined" /></TableCell>
                        <TableCell>{w.completed_at ? String(w.completed_at).slice(0, 10) : '—'}</TableCell>
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
};

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
              <XAxis dataKey={x} fontSize={11} interval={0} angle={-20} textAnchor="end" height={50} /><YAxis fontSize={11} /><RTooltip />
              <Bar dataKey={y} fill={color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProductionIntelligence() {
  const theme = useTheme();
  const [tab, setTab] = useState(0);
  return (
    <Box>
      <Box sx={{ px: 3, pt: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <IntelIcon sx={{ color: theme.palette.primary.main, fontSize: 28 }} />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Production Intelligence Center</Typography>
      </Box>
      <Box sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab label="Operations" />
          <Tab label="Uploaded logs" />
        </Tabs>
      </Box>
      {tab === 0 ? <OperationsTab /> : <UploadedLogsTab />}
    </Box>
  );
}
