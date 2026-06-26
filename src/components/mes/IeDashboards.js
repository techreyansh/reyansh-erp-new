// IE management dashboards (the 5 from the brief + a management summary), rendered
// over the current plan's computed data — no extra fetching. Pure presentation:
// line balance · machine utilization · manpower · bottleneck · cost comparison.
import React from 'react';
import { Box, Paper, Stack, Typography, Chip, Grid, useTheme } from '@mui/material';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine, CartesianGrid,
} from 'recharts';

const fmt = (x) => Math.round(Number(x) || 0).toLocaleString('en-IN');
const money = (x) => `₹${(Number(x) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function Metric({ label, value, color }) {
  return (
    <Box sx={{ minWidth: 110 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" sx={{ fontWeight: 800, color: color || 'text.primary' }}>{value}</Typography>
    </Box>
  );
}

function Panel({ title, children }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Typography sx={{ fontWeight: 700, mb: 1 }}>{title}</Typography>
      {children}
    </Paper>
  );
}

export default function IeDashboards({ result, scenarios = [], moldSchedule = [], moldPool, target, shiftHours, headcountPool }) {
  const theme = useTheme();
  if (!result || !result.plan) {
    return <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>Set a target to see the dashboards.</Typography>;
  }
  const stations = result.plan.stations || [];
  const labour = stations.filter((s) => !s.machine);
  const achievable = result.achievableUph || 0;
  const required = result.requiredUph || 0;
  const dailyOut = achievable * (Number(shiftHours) || 0);
  const completion = achievable > 0 ? (Number(target) || 0) / achievable : 0;
  const efficiency = required > 0 ? Math.min(100, Math.round((achievable / required) * 100)) : 0;
  const recommended = scenarios.find((s) => s.recommended);
  // Rough WIP proxy: pieces that faster stations could pile up ahead of the line
  // rate over a half-hour build-ahead window. Display-only.
  const wip = Math.round(stations.reduce((sum, s) => sum + Math.max(0, (s.capacity || 0) - achievable), 0) * 0.5);

  const barColor = theme.palette.primary.main;
  const lineBalanceData = stations.map((s) => ({ name: s.label, capacity: Math.round(s.capacity || 0), bottleneck: result.bottleneck && result.bottleneck.key === s.key }));
  const machineData = moldSchedule.map((r) => ({ name: r.machine.machine_code, util: r.utilization }));
  const manpowerData = labour.map((s) => ({ name: s.label, operators: s.operators || 0 }));
  const costData = scenarios.filter((s) => s.result.feasible).map((s) => ({ name: s.label, cost: s.result.cost?.costPerPc || 0, recommended: s.recommended }));

  return (
    <Stack spacing={2}>
      {/* Management summary */}
      <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
        <Typography sx={{ fontWeight: 700, mb: 1.5 }}>Management summary</Typography>
        <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
          <Metric label="Daily target" value={fmt(target)} />
          <Metric label="Achievable / day" value={fmt(dailyOut)} color={result.feasible ? 'success.main' : 'error.main'} />
          <Metric label="Recommended" value={recommended ? recommended.label : '—'} />
          <Metric label="Completes in" value={`${completion.toFixed(1)}h`} />
          <Metric label="Operators" value={`${result.plan.totalOperators}/${headcountPool}`} />
          <Metric label="Overtime" value={`${result.overtimeHours}h`} />
          <Metric label="Labour cost" value={money(result.cost?.labourCost)} />
          <Metric label="Overtime cost" value={money(result.cost?.overtimeCost)} />
          <Metric label="Cost / pc" value={money(result.cost?.costPerPc)} color="primary.main" />
          <Metric label="Line efficiency" value={`${efficiency}%`} />
          <Metric label="Est. WIP" value={`≈${fmt(wip)}`} />
        </Stack>
      </Paper>

      <Grid container spacing={2}>
        {/* Line balance */}
        <Grid item xs={12} md={6}>
          <Panel title="Line balance — station capacity vs required rate">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={lineBalanceData} margin={{ top: 8, right: 8, bottom: 8, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => `${fmt(v)}/hr`} />
                <ReferenceLine y={Math.round(required)} stroke={theme.palette.error.main} strokeDasharray="4 4" label={{ value: `req ${fmt(required)}`, fontSize: 10, position: 'insideTopRight' }} />
                <Bar dataKey="capacity" radius={[3, 3, 0, 0]}>
                  {lineBalanceData.map((d, i) => <Cell key={i} fill={d.bottleneck ? theme.palette.error.main : barColor} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </Grid>

        {/* Machine utilization */}
        <Grid item xs={12} md={6}>
          <Panel title="Molding machine utilization">
            {machineData.length === 0 ? <Typography variant="body2" color="text.secondary">No molding load for this plan.</Typography> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={machineData} margin={{ top: 8, right: 8, bottom: 8, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <ReferenceLine y={100} stroke={theme.palette.error.main} strokeDasharray="4 4" />
                  <Bar dataKey="util" radius={[3, 3, 0, 0]}>
                    {machineData.map((d, i) => <Cell key={i} fill={d.util >= 95 ? theme.palette.error.main : d.util >= 75 ? theme.palette.warning.main : theme.palette.success.main} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>
        </Grid>

        {/* Manpower */}
        <Grid item xs={12} md={6}>
          <Panel title={`Manpower — ${result.plan.totalOperators} of ${headcountPool} operators`}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={manpowerData} margin={{ top: 8, right: 8, bottom: 8, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="operators" fill={theme.palette.info.main} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </Grid>

        {/* Bottleneck */}
        <Grid item xs={12} md={6}>
          <Panel title="Bottleneck">
            {result.bottleneck ? (
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip color="error" label={result.bottleneck.label} />
                  <Chip size="small" variant="outlined" label={result.bottleneck.kind} sx={{ textTransform: 'capitalize' }} />
                </Stack>
                <Typography variant="body2" color="text.secondary">{result.reason}</Typography>
                <Stack direction="row" spacing={3}>
                  <Metric label="Required" value={`${fmt(required)}/hr`} />
                  <Metric label="Achievable" value={`${fmt(achievable)}/hr`} color={result.feasible ? 'success.main' : 'error.main'} />
                  <Metric label="Gap" value={`${fmt(Math.max(0, required - achievable))}/hr`} color="error.main" />
                </Stack>
              </Stack>
            ) : (
              <Typography variant="body2" color="success.main">No binding bottleneck — the line meets the target comfortably.</Typography>
            )}
          </Panel>
        </Grid>

        {/* Cost comparison */}
        <Grid item xs={12}>
          <Panel title="Cost comparison — cost per piece by scenario">
            {costData.length === 0 ? <Typography variant="body2" color="text.secondary">No feasible scenario to compare.</Typography> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={costData} margin={{ top: 8, right: 8, bottom: 8, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => money(v)} />
                  <Bar dataKey="cost" radius={[3, 3, 0, 0]}>
                    {costData.map((d, i) => <Cell key={i} fill={d.recommended ? theme.palette.success.main : theme.palette.grey[500]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>
        </Grid>
      </Grid>
    </Stack>
  );
}
