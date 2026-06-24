import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Stack, Card, CardContent, Typography, Button, IconButton, Chip, TextField, MenuItem,
  CircularProgress, Tooltip, Divider, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Paper, useTheme, alpha,
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

const iso = (d) => d.toISOString().slice(0, 10);
const SEV_ICON = { critical: <CritIcon color="error" />, warning: <WarnIcon color="warning" />, info: <InfoIcon color="info" /> };
const SEV_COLOR = { critical: 'error', warning: 'warning', info: 'info' };

const ProductionIntelligence = () => {
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

export default ProductionIntelligence;
