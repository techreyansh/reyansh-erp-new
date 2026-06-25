import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Stack, Card, CardContent, Typography, IconButton, Chip, CircularProgress, Tooltip, Divider, useTheme, alpha,
} from '@mui/material';
import { Insights as DashIcon, Refresh as RefreshIcon, CheckCircle as DoneIcon } from '@mui/icons-material';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, Cell,
} from 'recharts';
import mesCapacityService from '../../services/mesCapacityService';

const MESDashboard = () => {
  const theme = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await mesCapacityService.getDashboard()); }
    catch (e) { setData({ error: e.message }); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const Kpi = ({ label, value, sub, color }) => (
    <Card sx={{ flex: 1, minWidth: 140, borderRadius: 2 }}><CardContent sx={{ py: 1.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.58rem', fontWeight: 700, display: 'block' }}>{label}</Typography>
      <Typography variant="h5" sx={{ fontWeight: 800, color: color || 'text.primary' }}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </CardContent></Card>
  );
  const k = data?.kpis || {};

  return (
    <Box sx={{ p: 3 }}>
      <Card sx={{ background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`, color: 'white', borderRadius: 3, mb: 2 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <DashIcon sx={{ fontSize: 32 }} />
            <Box><Typography variant="h5" sx={{ fontWeight: 700 }}>Production Board</Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>Live work-order load + today's job-card output.</Typography></Box>
          </Box>
          <Tooltip title="Refresh"><IconButton onClick={load} sx={{ color: 'white' }}><RefreshIcon /></IconButton></Tooltip>
        </CardContent>
      </Card>

      {loading ? <Box sx={{ textAlign: 'center', py: 8 }}><CircularProgress /></Box> : data?.error ? (
        <Card sx={{ borderRadius: 2 }}><CardContent><Typography color="error">{data.error}</Typography></CardContent></Card>
      ) : (
        <Stack spacing={2}>
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
            <Kpi label="Open work orders" value={k.openWos} sub={`${k.running} stages running`} />
            <Kpi label="Good today" value={(k.todayGood || 0).toLocaleString('en-IN')} color={theme.palette.success.main} />
            <Kpi label="Reject today" value={(k.todayReject || 0).toLocaleString('en-IN')} sub={`${k.rejectPct || 0}% reject rate`} color={theme.palette.error.main} />
            <Kpi label="Downtime today" value={`${k.todayDowntime || 0}m`} color={theme.palette.warning.main} />
          </Stack>

          {data.moldAlerts && data.moldAlerts.length > 0 && (
            <Card sx={{ borderRadius: 2, border: '1px solid', borderColor: 'error.main', bgcolor: alpha(theme.palette.error.main, 0.05) }}><CardContent sx={{ py: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'error.main', mb: 0.5 }}>⚠ Mold maintenance due</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {data.moldAlerts.map((m) => (
                  <Chip key={m.mold_number} color={m.wear >= 100 ? 'error' : 'warning'} variant={m.wear >= 100 ? 'filled' : 'outlined'}
                    label={`${m.mold_number}: ${m.wear}% of tool life (${(m.shots_done || 0).toLocaleString('en-IN')}/${(m.tool_life_shots || 0).toLocaleString('en-IN')} shots)`} />
                ))}
              </Stack>
            </CardContent></Card>
          )}

          {data.outputByPart && (
            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
              {data.outputByPart.map((p) => (
                <Card key={p.part} sx={{ flex: 1, minWidth: 150, borderRadius: 2, borderLeft: '4px solid', borderColor: p.part === 'Molding' ? 'error.main' : p.part === 'Packing' ? 'warning.main' : 'primary.main' }}>
                  <CardContent sx={{ py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.58rem', display: 'block' }}>{p.part} (today)</Typography>
                    <Typography variant="h5" sx={{ fontWeight: 800 }}>{(p.good || 0).toLocaleString('en-IN')}</Typography>
                    <Typography variant="caption" color="text.secondary">{p.reject || 0} reject{p.part === 'Molding' ? ' · bottleneck' : ''}</Typography>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Card sx={{ borderRadius: 2, flex: 1, minWidth: 0 }}><CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Stage load <Typography component="span" variant="caption" color="text.secondary">(open work across stages)</Typography></Typography>
              {(!data.stageLoad || data.stageLoad.length === 0) ? <Typography variant="body2" color="text.secondary">No open stages.</Typography> : (
                <ResponsiveContainer width="100%" height={Math.max(180, data.stageLoad.length * 34)}>
                  <BarChart layout="vertical" data={data.stageLoad} margin={{ left: 10, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.text.primary, 0.08)} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="stage" tick={{ fontSize: 11 }} width={120} />
                    <RTooltip />
                    <Bar dataKey="running" stackId="a" name="Running" fill={theme.palette.primary.main} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="pending" stackId="a" name="Pending" fill={alpha(theme.palette.text.primary, 0.25)} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent></Card>

            <Card sx={{ borderRadius: 2, flex: 1, minWidth: 0 }}><CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Today's output by stage</Typography>
              {(!data.outputByStage || data.outputByStage.length === 0) ? <Typography variant="body2" color="text.secondary">No output logged today.</Typography> : (
                <ResponsiveContainer width="100%" height={Math.max(180, data.outputByStage.length * 34)}>
                  <BarChart layout="vertical" data={data.outputByStage} margin={{ left: 10, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.text.primary, 0.08)} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="stage" tick={{ fontSize: 11 }} width={120} />
                    <RTooltip />
                    <Bar dataKey="good" name="Good" fill={theme.palette.success.main} radius={[0, 4, 4, 0]}>
                      {data.outputByStage.map((_, i) => <Cell key={i} fill={theme.palette.success.main} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent></Card>
          </Stack>

          {data.downtimeByReason && data.downtimeByReason.length > 0 && (
            <Card sx={{ borderRadius: 2 }}><CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Downtime by reason (today)</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {data.downtimeByReason.map((d) => <Chip key={d.reason} label={`${d.reason}: ${d.minutes}m`} color="warning" variant="outlined" />)}
              </Stack>
            </CardContent></Card>
          )}

          <Card sx={{ borderRadius: 2 }}><CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Recent job-card entries</Typography>
            <Divider sx={{ mb: 1 }} />
            {(!data.recent || data.recent.length === 0) ? <Typography variant="body2" color="text.secondary">No entries today — operators log on the Job Cards screen.</Typography> : (
              <Stack spacing={0.5}>
                {data.recent.map((e, i) => (
                  <Stack key={i} direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <DoneIcon fontSize="small" color="success" />
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{e.stage}</Typography>
                    <Typography variant="body2">{e.output_qty} good{e.reject_qty ? ` · ${e.reject_qty} reject` : ''}{e.downtime_min ? ` · ${e.downtime_min}m down` : ''}</Typography>
                    <Typography variant="caption" color="text.secondary">{e.operator_name || '—'} · {new Date(e.logged_at).toLocaleTimeString('en-IN')}</Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </CardContent></Card>
        </Stack>
      )}
    </Box>
  );
};

export default MESDashboard;
