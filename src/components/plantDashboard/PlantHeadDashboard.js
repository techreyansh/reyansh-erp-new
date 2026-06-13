import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Container,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  CheckCircleOutlineRounded,
  FactoryOutlined,
  PrecisionManufacturingOutlined,
  RefreshRounded,
  ReportProblemOutlined,
  RuleOutlined,
  PlaylistAddCheckOutlined,
  LocalShippingOutlined,
  InfoOutlined,
} from '@mui/icons-material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePermissions } from '../../context/PermissionContext';
import LoadingScreen from '../common/LoadingScreen';
import AccessDenied from '../auth/AccessDenied';
import { getPlantSummary } from '../../services/plantDashboardService';
import {
  StatCard,
  Panel,
  AttentionCard,
  EmptyChart,
  sortBySeverity,
  CHART_COLORS,
  pct,
  greeting,
} from '../common/kit';

/** Turn the plant summary into ranked "what needs attention now" cards. */
function derivePlantAttention(d) {
  if (!d) return [];
  const k = d.kpis || {};
  const items = [];

  if (k.shortagePlans > 0) {
    items.push({
      id: 'shortage',
      severity: 'critical',
      title: `${k.shortagePlans} plan${k.shortagePlans > 1 ? 's' : ''} flagged material shortage`,
      detail: 'Production plans cannot proceed without material. Expedite procurement to avoid delays.',
      cta: 'Check inventory',
      path: '/inventory',
    });
  }
  if (k.blockedPlans > 0) {
    items.push({
      id: 'blocked',
      severity: 'critical',
      title: `${k.blockedPlans} production plan${k.blockedPlans > 1 ? 's' : ''} blocked`,
      detail: 'Plans are stalled. Resolve the blocker to keep the line moving.',
      cta: 'Open production plan',
      path: '/ppc/production-plan',
    });
  }
  if (k.rejectionRate >= 0.05) {
    items.push({
      id: 'rejection',
      severity: k.rejectionRate >= 0.1 ? 'critical' : 'warning',
      title: `Rejection rate at ${pct(k.rejectionRate)}`,
      detail: 'Defect rate is above the 5% threshold. Investigate the worst-offending machine.',
      cta: 'Quality control',
      path: '/ppc/quality-control',
    });
  }
  if (k.failedJobs > 0) {
    items.push({
      id: 'failed',
      severity: 'warning',
      title: `${k.failedJobs} work order${k.failedJobs > 1 ? 's' : ''} failed`,
      detail: 'Failed jobs need rework or re-planning to recover the output.',
      cta: 'View work orders',
      path: '/ppc/work-orders',
    });
  }
  if (k.targetQty > 0 && k.achievement < 0.8) {
    items.push({
      id: 'achievement',
      severity: k.achievement < 0.6 ? 'critical' : 'warning',
      title: `Output at ${pct(k.achievement)} of target`,
      detail: 'Production is tracking behind plan. Review machine loading and shift performance.',
      cta: 'Production tracking',
      path: '/ppc/production-tracking',
    });
  }
  if (k.pendingDispatch > 0) {
    items.push({
      id: 'dispatch',
      severity: 'warning',
      title: `${k.pendingDispatch} shipment${k.pendingDispatch > 1 ? 's' : ''} pending dispatch`,
      detail: 'Finished goods are waiting to ship. Confirm dispatch readiness.',
      cta: 'Open dispatch',
      path: '/dispatch-management',
    });
  }
  if (k.pendingJobs > 0) {
    items.push({
      id: 'pending',
      severity: 'info',
      title: `${k.pendingJobs} job${k.pendingJobs > 1 ? 's' : ''} pending start`,
      detail: 'Queued work orders are waiting to begin. Assign machines and operators.',
      cta: 'Schedule jobs',
      path: '/ppc/work-orders',
    });
  }

  return sortBySeverity(items);
}

const STATUS_COLORS = {
  RUNNING: '#1E7DBE',
  PENDING: '#D97706',
  COMPLETED: '#059669',
  FAILED: '#DC2626',
  Unknown: '#475569',
};

const PlantHeadDashboard = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { loading: permissionsLoading, employee, authorized } = usePermissions();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const summary = await getPlantSummary();
      setData(summary);
      setLastUpdated(new Date());
    } catch (e) {
      // service degrades each metric to empty internally
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 60000);
    return () => clearInterval(id);
  }, [load]);

  const attention = useMemo(() => derivePlantAttention(data), [data]);
  const k = data?.kpis || {};

  if (permissionsLoading) {
    return <LoadingScreen message="Loading plant dashboard…" fullScreen />;
  }
  if (!authorized || !employee) {
    return <AccessDenied />;
  }

  const achievementColor = k.achievement >= 0.9 ? '#059669' : k.achievement >= 0.7 ? '#D97706' : '#DC2626';
  const rejectionColor = k.rejectionRate < 0.05 ? '#059669' : k.rejectionRate < 0.1 ? '#D97706' : '#DC2626';

  const kpiCards = [
    { label: 'Output Today', value: Math.round(k.producedToday ?? 0).toLocaleString('en-IN'), sub: 'units produced', icon: PrecisionManufacturingOutlined, accent: '#45ADE6', path: '/ppc/production-tracking' },
    { label: 'Plan Achievement', value: pct(k.achievement ?? 0), sub: `${Math.round(k.producedQty ?? 0).toLocaleString('en-IN')} / ${Math.round(k.targetQty ?? 0).toLocaleString('en-IN')}`, icon: RuleOutlined, accent: achievementColor, path: '/ppc/production-plan' },
    { label: 'Rejection %', value: pct(k.rejectionRate ?? 0), sub: 'defects / total', icon: ReportProblemOutlined, accent: rejectionColor, path: '/ppc/quality-control' },
    { label: 'Running Jobs', value: k.running ?? 0, sub: `${k.pendingJobs ?? 0} pending`, icon: FactoryOutlined, accent: '#1E7DBE', path: '/ppc/work-orders' },
    { label: 'Plans In Progress', value: k.inProgressPlans ?? 0, sub: `${k.planCount ?? 0} total`, icon: PlaylistAddCheckOutlined, accent: '#7C3AED', path: '/ppc/production-plan' },
    { label: 'Pending Dispatch', value: k.pendingDispatch ?? 0, sub: 'ready to ship', icon: LocalShippingOutlined, accent: '#DB2777', path: '/dispatch-management' },
  ];

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 8 }}>
      {/* Hero */}
      <Box
        sx={{
          background: `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, transparent 100%)`,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Container maxWidth="xl" sx={{ py: { xs: 3, md: 4 }, px: { xs: 2, sm: 3 } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={2}>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
                {greeting()}, {employee?.name?.split(' ')[0] || 'Plant Head'}
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
                Plant Floor — production, quality and dispatch at a glance.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} />
                <Typography variant="caption" color="text.secondary">
                  Live · {lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                </Typography>
              </Stack>
              <Tooltip title="Refresh">
                <span>
                  <IconButton onClick={() => load(true)} disabled={refreshing} size="small">
                    <RefreshRounded sx={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none', '@keyframes spin': { to: { transform: 'rotate(360deg)' } } }} />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ px: { xs: 2, sm: 3 }, mt: 3 }}>
        {/* No-data hint */}
        {!loading && data && !data.hasData && (
          <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2.5, display: 'flex', gap: 1.5, alignItems: 'center', bgcolor: alpha('#1E7DBE', 0.04), borderColor: alpha('#1E7DBE', 0.3) }}>
            <InfoOutlined sx={{ color: '#1E7DBE' }} />
            <Typography variant="body2" color="text.secondary">
              No production plans or work orders found yet. This dashboard populates from the PPC module (production plans → work orders → QC). Create a plan to see live metrics.
            </Typography>
          </Paper>
        )}

        {/* ATTENTION RAIL */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: '0.1em' }}>
            Needs attention now
          </Typography>
          {!loading && (
            <Chip
              size="small"
              label={attention.length}
              sx={{ height: 20, fontWeight: 800, bgcolor: attention.length ? alpha('#DC2626', 0.12) : alpha('#059669', 0.12), color: attention.length ? '#DC2626' : '#059669' }}
            />
          )}
        </Stack>

        {loading ? (
          <Grid container spacing={2} sx={{ mb: 4 }}>
            {[0, 1, 2].map((i) => (
              <Grid item xs={12} sm={6} md={4} key={i}>
                <Skeleton variant="rounded" height={150} sx={{ borderRadius: 2.5 }} />
              </Grid>
            ))}
          </Grid>
        ) : attention.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 3, mb: 4, borderRadius: 2.5, display: 'flex', alignItems: 'center', gap: 2, borderLeft: '4px solid #059669' }}>
            <CheckCircleOutlineRounded sx={{ color: '#059669', fontSize: 32 }} />
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>Line running clean</Typography>
              <Typography variant="body2" color="text.secondary">No shortages, blocks, quality alerts, or behind-target plans right now.</Typography>
            </Box>
          </Paper>
        ) : (
          <Grid container spacing={2} sx={{ mb: 4 }}>
            {attention.map((item) => (
              <Grid item xs={12} sm={6} md={4} key={item.id}>
                <AttentionCard item={item} onAction={navigate} />
              </Grid>
            ))}
          </Grid>
        )}

        {/* KPI STRIP */}
        <Grid container spacing={2} sx={{ mb: 4 }}>
          {kpiCards.map((c) => (
            <Grid item xs={6} sm={4} md={2} key={c.label}>
              <StatCard {...c} loading={loading} onClick={() => navigate(c.path)} />
            </Grid>
          ))}
        </Grid>

        {/* ROW 1: Production vs Target (per plan) + Job status */}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={7}>
            <Panel title="Production vs Target" subtitle="Active plans · produced vs planned" height={280}>
              {data?.planProgress?.length ? (
                <Stack spacing={1.5} sx={{ height: '100%', overflowY: 'auto', pr: 0.5 }}>
                  {data.planProgress.map((p) => {
                    const ratio = p.target > 0 ? Math.min(p.produced / p.target, 1) : 0;
                    const barColor = ratio >= 0.9 ? '#059669' : ratio >= 0.6 ? '#1E7DBE' : '#D97706';
                    return (
                      <Box key={p.id}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={600} noWrap>{p.label}</Typography>
                            {p.shortage && <Chip size="small" label="Shortage" sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, bgcolor: alpha('#DC2626', 0.12), color: '#DC2626' }} />}
                          </Stack>
                          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                            {Math.round(p.produced).toLocaleString('en-IN')} / {Math.round(p.target).toLocaleString('en-IN')}
                          </Typography>
                        </Stack>
                        <LinearProgress
                          variant="determinate"
                          value={ratio * 100}
                          sx={{ height: 8, borderRadius: 1, bgcolor: alpha(theme.palette.text.primary, 0.06), '& .MuiLinearProgress-bar': { bgcolor: barColor, borderRadius: 1 } }}
                        />
                      </Box>
                    );
                  })}
                </Stack>
              ) : (
                <EmptyChart label="No active production plans" />
              )}
            </Panel>
          </Grid>
          <Grid item xs={12} md={5}>
            <Panel title="Job Status" subtitle="Work orders by state" height={280} action={<Button size="small" onClick={() => navigate('/ppc/work-orders')}>Open</Button>}>
              {data?.jobsByStatus?.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.jobsByStatus} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {data.jobsByStatus.map((entry) => (
                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#475569'} />
                      ))}
                    </Pie>
                    <RTooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart label="No work orders yet" />
              )}
            </Panel>
          </Grid>
        </Grid>

        {/* ROW 2: Machine loading + Rejection by machine (Pareto) */}
        <Grid container spacing={2} sx={{ mb: 4 }}>
          <Grid item xs={12} md={7}>
            <Panel title="Machine Loading" subtitle="Work orders per machine" height={260}>
              {data?.machineLoad?.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.machineLoad} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={alpha(theme.palette.text.primary, 0.06)} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <RTooltip cursor={{ fill: alpha(theme.palette.primary.main, 0.06) }} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={36}>
                      {data.machineLoad.map((entry, i) => (
                        <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart label="No machine assignments yet" />
              )}
            </Panel>
          </Grid>
          <Grid item xs={12} md={5}>
            <Panel title="Rejections by Machine" subtitle="Where defects concentrate" height={260}>
              {data?.rejectionByMachine?.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.rejectionByMachine} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={alpha(theme.palette.text.primary, 0.06)} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={80} />
                    <RTooltip cursor={{ fill: alpha('#DC2626', 0.06) }} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16} fill="#DC2626" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart label="No defects recorded — clean run" />
              )}
            </Panel>
          </Grid>
        </Grid>

        {/* Instrumentation note — honest about what isn't measured yet */}
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, display: 'flex', gap: 1.5, alignItems: 'flex-start', borderStyle: 'dashed' }}>
          <InfoOutlined sx={{ color: 'text.disabled', mt: 0.25 }} />
          <Box>
            <Typography variant="subtitle2" fontWeight={700}>Not shown yet — needs shop-floor instrumentation</Typography>
            <Typography variant="caption" color="text.secondary">
              OEE, machine downtime, and shift attendance aren't captured in the database today (the machine monitor uses simulated data). Adding a <strong>machine_status_log</strong> / downtime table would light up real OEE, availability and downtime KPIs here.
            </Typography>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
};

export default PlantHeadDashboard;
