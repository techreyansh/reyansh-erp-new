import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Container,
  Grid,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  AccountBalanceWalletOutlined,
  CheckCircleOutlineRounded,
  GroupsOutlined,
  LocalShippingOutlined,
  PaidOutlined,
  ReceiptLongOutlined,
  RefreshRounded,
  TrendingUpRounded,
  WarningAmberRounded,
  People,
  AdminPanelSettings,
  Assignment,
} from '@mui/icons-material';
import {
  Area,
  AreaChart,
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
import { getExecutiveSummary } from '../../services/executiveDashboardService';
import {
  StatCard,
  Panel,
  AttentionCard,
  EmptyChart,
  sortBySeverity,
  CHART_COLORS,
  inrCompact,
  pct,
  greeting,
} from '../common/kit';

/**
 * Attention engine — turns the raw executive summary into a ranked list of
 * "what needs a decision right now", each with a one-click action.
 * Pure function of the summary data; rendered via the shared <AttentionCard/>.
 */
function deriveAttention(d) {
  if (!d) return [];
  const k = d.kpis || {};
  const items = [];

  if (k.outstanding > 0) {
    const severe = k.outstanding > k.collected;
    items.push({
      id: 'ar',
      severity: severe ? 'critical' : 'warning',
      title: `${inrCompact(k.outstanding)} outstanding in receivables`,
      detail: severe
        ? 'Outstanding now exceeds what has been collected — cash flow risk.'
        : 'Money booked but not yet collected. Push collections.',
      cta: 'Review collections',
      path: '/crm/collections',
    });
  }

  if (k.pendingDispatch > 0) {
    items.push({
      id: 'dispatch',
      severity: k.pendingDispatch > 5 ? 'critical' : 'warning',
      title: `${k.pendingDispatch} shipment${k.pendingDispatch > 1 ? 's' : ''} pending dispatch`,
      detail: 'Orders are ready but not yet shipped. Risk of delivery delays.',
      cta: 'Open dispatch',
      path: '/dispatch-management',
    });
  }

  const c = d.concentration || {};
  if (c.top1Share >= 0.25 && c.top1Name) {
    items.push({
      id: 'concentration',
      severity: c.top1Share >= 0.35 ? 'critical' : 'warning',
      title: `${c.top1Name} is ${pct(c.top1Share)} of revenue`,
      detail: `Top 3 customers = ${pct(c.top3Share)} of revenue. High customer-concentration risk.`,
      cta: 'View customers',
      path: '/crm/customers',
    });
  }

  const tr = d.taskRisk || {};
  if (tr.overdue > 0) {
    items.push({
      id: 'overdue',
      severity: tr.overdue > 5 ? 'critical' : 'warning',
      title: `${tr.overdue} task${tr.overdue > 1 ? 's' : ''} overdue`,
      detail: 'Assigned work is past its due date across the team.',
      cta: 'Open team tasks',
      path: '/team-tasks',
    });
  }
  if (tr.blocked > 0) {
    items.push({
      id: 'blocked',
      severity: 'warning',
      title: `${tr.blocked} task${tr.blocked > 1 ? 's' : ''} blocked`,
      detail: 'Work is stalled and waiting on a dependency or decision.',
      cta: 'Unblock work',
      path: '/team-tasks',
    });
  }

  if (k.openQuoteValue > 0) {
    items.push({
      id: 'quotes',
      severity: 'info',
      title: `${inrCompact(k.openQuoteValue)} in open quotations`,
      detail: 'Quotations sent and awaiting customer response. Follow up to convert.',
      cta: 'View quotations',
      path: '/crm/quotations',
    });
  }

  if (k.activeLeads > 0) {
    items.push({
      id: 'leads',
      severity: 'info',
      title: `${k.activeLeads} active lead${k.activeLeads > 1 ? 's' : ''} in pipeline`,
      detail: 'Leads need follow-up to keep the pipeline moving.',
      cta: 'View follow-ups',
      path: '/crm/follow-ups',
    });
  }

  return sortBySeverity(items);
}

const CEOExecutiveDashboard = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const {
    loading: permissionsLoading,
    employee,
    authorized,
    canManageEmployees,
    canManageTasks,
  } = usePermissions();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const summary = await getExecutiveSummary();
      setData(summary);
      setLastUpdated(new Date());
    } catch (e) {
      // service degrades each metric to empty internally; nothing fatal here
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

  const attention = useMemo(() => deriveAttention(data), [data]);
  const k = data?.kpis || {};
  const mtdRevenue = data?.revenueTrend?.length
    ? data.revenueTrend[data.revenueTrend.length - 1].collected
    : 0;

  if (permissionsLoading) {
    return <LoadingScreen message="Loading command center…" fullScreen />;
  }
  if (!authorized || !employee) {
    return <AccessDenied />;
  }

  const kpiCards = [
    { label: 'Revenue (This Month)', value: inrCompact(mtdRevenue), icon: PaidOutlined, accent: '#45ADE6', path: '/dashboard' },
    { label: 'Order Book', value: inrCompact(k.orderBook), icon: ReceiptLongOutlined, accent: '#1E7DBE', path: '/crm/sales-orders' },
    { label: 'Collected', value: inrCompact(k.collected), icon: AccountBalanceWalletOutlined, accent: '#059669', path: '/crm/collections' },
    { label: 'Outstanding', value: inrCompact(k.outstanding), icon: TrendingUpRounded, accent: '#D97706', path: '/crm/collections' },
    { label: 'Pending Dispatch', value: k.pendingDispatch ?? 0, sub: `${k.dispatchTotal ?? 0} total`, icon: LocalShippingOutlined, accent: '#7C3AED', path: '/dispatch-management' },
    { label: 'Active Leads', value: k.activeLeads ?? 0, sub: `${k.team ?? 0} team members`, icon: GroupsOutlined, accent: '#DB2777', path: '/crm/follow-ups' },
  ];

  const managementLinks = [
    canManageEmployees && { title: 'Employee Management', path: '/employee-dashboard', icon: People },
    canManageEmployees && { title: 'Access Management', path: '/access-management', icon: AdminPanelSettings },
    canManageTasks && { title: 'Task Scheduler', path: '/task-scheduler', icon: Assignment },
    canManageTasks && { title: 'Team Tasks', path: '/team-tasks', icon: Assignment },
  ].filter(Boolean);

  const dispatchData = (data?.dispatchByStatus || []).filter((x) => x.value > 0);

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
                {greeting()}, {employee?.name?.split(' ')[0] || 'Chief'}
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
                Command Center — here's what needs your attention right now.
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
              <Typography variant="subtitle1" fontWeight={700}>All clear</Typography>
              <Typography variant="body2" color="text.secondary">No outstanding risks, delays, or overdue work detected right now.</Typography>
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

        {/* CHARTS ROW 1 */}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={7}>
            <Panel title="Revenue Trend" subtitle="Ordered vs Collected · last 12 months" height={280}>
              {data?.revenueTrend?.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.revenueTrend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="cc-ord" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1E7DBE" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#1E7DBE" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="cc-col" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#45ADE6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#45ADE6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={alpha(theme.palette.text.primary, 0.06)} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={inrCompact} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={70} />
                    <RTooltip formatter={(v) => inrCompact(v)} />
                    <Area type="monotone" dataKey="ordered" stroke="#1E7DBE" strokeWidth={2} fill="url(#cc-ord)" name="Ordered" />
                    <Area type="monotone" dataKey="collected" stroke="#45ADE6" strokeWidth={2} fill="url(#cc-col)" name="Collected" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart label="No revenue data yet" />
              )}
            </Panel>
          </Grid>
          <Grid item xs={12} md={5}>
            <Panel title="Dispatch Readiness" subtitle={`${k.pendingDispatch ?? 0} pending of ${k.dispatchTotal ?? 0}`} height={280} action={<Button size="small" onClick={() => navigate('/dispatch-management')}>Open</Button>}>
              {dispatchData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={dispatchData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {dispatchData.map((entry, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <RTooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart label="No dispatch data yet" />
              )}
            </Panel>
          </Grid>
        </Grid>

        {/* CHARTS ROW 2 */}
        <Grid container spacing={2} sx={{ mb: 4 }}>
          <Grid item xs={12} md={7}>
            <Panel title="Top Customers" subtitle="By order value" height={260}>
              {data?.topCustomers?.length ? (
                <Stack spacing={1.25} sx={{ height: '100%', overflowY: 'auto', pr: 0.5 }}>
                  {data.topCustomers.map((cust, i) => {
                    const max = data.topCustomers[0]?.value || 1;
                    return (
                      <Box key={cust.name}>
                        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                          <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: '60%' }}>{i + 1}. {cust.name}</Typography>
                          <Typography variant="body2" fontWeight={700}>{inrCompact(cust.value)}</Typography>
                        </Stack>
                        <Box sx={{ height: 6, borderRadius: 1, bgcolor: alpha(theme.palette.text.primary, 0.06), overflow: 'hidden' }}>
                          <Box sx={{ height: '100%', width: `${(cust.value / max) * 100}%`, borderRadius: 1, bgcolor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        </Box>
                      </Box>
                    );
                  })}
                </Stack>
              ) : (
                <EmptyChart label="No customer revenue data yet" />
              )}
            </Panel>
          </Grid>
          <Grid item xs={12} md={5}>
            <Panel title="Concentration Risk" subtitle="Revenue dependency" height={260}>
              {data?.concentration?.top1Name ? (
                <Stack spacing={2} justifyContent="center" sx={{ height: '100%' }}>
                  <Box>
                    <Typography variant="h3" fontWeight={800} sx={{ color: data.concentration.top1Share >= 0.35 ? '#DC2626' : data.concentration.top1Share >= 0.25 ? '#D97706' : '#059669', letterSpacing: '-0.03em' }}>
                      {pct(data.concentration.top1Share)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      of revenue from <strong>{data.concentration.top1Name}</strong>
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="h5" fontWeight={800} sx={{ letterSpacing: '-0.02em' }}>{pct(data.concentration.top3Share)}</Typography>
                    <Typography variant="body2" color="text.secondary">from top 3 customers · {data.concentration.customerCount} total</Typography>
                  </Box>
                  {data.concentration.top1Share >= 0.25 && (
                    <Chip size="small" icon={<WarningAmberRounded />} label="Diversify customer base" sx={{ alignSelf: 'flex-start', fontWeight: 700, bgcolor: alpha('#D97706', 0.12), color: '#D97706' }} />
                  )}
                </Stack>
              ) : (
                <EmptyChart label="No customer revenue data yet" />
              )}
            </Panel>
          </Grid>
        </Grid>

        {/* DEPARTMENT SNAPSHOT */}
        {data?.departments?.length > 0 && (
          <Box sx={{ mb: 4 }}>
            <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: '0.1em', display: 'block', mb: 1.5 }}>
              Department snapshot
            </Typography>
            <Grid container spacing={2}>
              {data.departments.map((dep) => {
                const warn = dep.health === 'warn';
                return (
                  <Grid item xs={6} sm={4} md={2} key={dep.key}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, height: '100%', borderTop: `3px solid ${warn ? '#D97706' : '#059669'}` }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{dep.name}</Typography>
                      <Typography variant="h5" fontWeight={800} sx={{ mt: 0.5, letterSpacing: '-0.02em' }}>{dep.metric}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{dep.metricLabel}</Typography>
                      <Chip
                        size="small"
                        label={warn ? 'Attention' : 'On track'}
                        sx={{ mt: 1, height: 20, fontWeight: 700, fontSize: '0.65rem', bgcolor: alpha(warn ? '#D97706' : '#059669', 0.12), color: warn ? '#D97706' : '#059669' }}
                      />
                    </Paper>
                  </Grid>
                );
              })}
            </Grid>
          </Box>
        )}

        {/* MANAGEMENT LINKS */}
        {managementLinks.length > 0 && (
          <Box>
            <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: '0.1em', display: 'block', mb: 1.5 }}>
              Management
            </Typography>
            <Grid container spacing={2}>
              {managementLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <Grid item xs={6} sm={3} key={link.path}>
                    <Paper
                      variant="outlined"
                      onClick={() => navigate(link.path)}
                      sx={{ p: 2, borderRadius: 2.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1.5, transition: 'border-color 0.2s ease', '&:hover': { borderColor: alpha(theme.palette.primary.main, 0.4) } }}
                    >
                      <Box sx={{ width: 40, height: 40, borderRadius: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                        <Icon sx={{ color: 'primary.main' }} />
                      </Box>
                      <Typography variant="subtitle2" fontWeight={700}>{link.title}</Typography>
                    </Paper>
                  </Grid>
                );
              })}
            </Grid>
          </Box>
        )}
      </Container>
    </Box>
  );
};

export default CEOExecutiveDashboard;
