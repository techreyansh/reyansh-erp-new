import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Container,
  Divider,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  AccountBalanceWalletOutlined,
  AssignmentTurnedInOutlined,
  GroupsOutlined,
  Inventory2Outlined,
  LocalShippingOutlined,
  PaidOutlined,
  ReceiptLongOutlined,
  RefreshRounded,
  StorefrontOutlined,
  TrendingUpRounded,
} from '@mui/icons-material';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getExecutiveSummary } from '../../services/executiveDashboardService';
import {
  StatCard,
  Panel,
  EmptyChart,
  GridBox,
  CHART_COLORS,
  inrCompact,
  inrFull,
  statusChipColor,
} from '../common/kit';

const Dashboard = () => {
  const theme = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const summary = await getExecutiveSummary();
      setData(summary);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err?.message || 'Failed to load dashboard data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 60000); // live: refresh every 60s
    return () => clearInterval(id);
  }, [load]);

  const k = data?.kpis || {};

  const kpiCards = [
    { label: 'Order Book', value: inrCompact(k.orderBook), sub: 'Total order value', icon: ReceiptLongOutlined, accent: '#45ADE6' },
    { label: 'Revenue Collected', value: inrCompact(k.collected), sub: 'Payments received', icon: PaidOutlined, accent: '#059669' },
    { label: 'Outstanding', value: inrCompact(k.outstanding), sub: 'Yet to be collected', icon: AccountBalanceWalletOutlined, accent: '#D97706' },
    { label: 'Open Quotations', value: inrCompact(k.openQuoteValue), sub: 'Active quote value', icon: TrendingUpRounded, accent: '#1E7DBE' },
    { label: 'Active Clients', value: k.clients ?? 0, sub: `${k.prospects ?? 0} prospects`, icon: GroupsOutlined, accent: '#7C3AED' },
    { label: 'Vendors', value: k.vendors ?? 0, sub: 'Approved suppliers', icon: StorefrontOutlined, accent: '#475569' },
    { label: 'Pending Dispatch', value: k.pendingDispatch ?? 0, sub: `${k.dispatchTotal ?? 0} total`, icon: LocalShippingOutlined, accent: '#DC2626' },
    { label: 'Active Leads', value: k.activeLeads ?? 0, sub: `${k.team ?? 0} team members`, icon: AssignmentTurnedInOutlined, accent: '#DB2777' },
  ];

  const axisStyle = { fontSize: 12, fill: theme.palette.text.secondary };
  const grid = theme.palette.divider;

  return (
    <Container maxWidth="xl" sx={{ mt: { xs: 2, md: 3 }, mb: { xs: 4, md: 8 }, px: { xs: 1.5, sm: 2 } }}>
      {/* Header */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, sm: 3 },
          mb: 3,
          borderRadius: 3,
          color: 'primary.contrastText',
          background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 60%, ${theme.palette.info.main} 130%)`,
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
              Executive Dashboard
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.85 }}>
              Company-wide performance across sales, finance, procurement, production, dispatch & workforce.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
              <Typography variant="caption" sx={{ opacity: 0.8, display: 'block' }}>
                {refreshing ? 'Refreshing…' : 'Last updated'}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
              </Typography>
            </Box>
            <Tooltip title="Refresh now">
              <span>
                <IconButton
                  onClick={() => load(true)}
                  disabled={refreshing || loading}
                  sx={{ color: 'inherit', bgcolor: 'rgba(255,255,255,0.15)', '&:hover': { bgcolor: 'rgba(255,255,255,0.28)' } }}
                >
                  {refreshing ? <CircularProgress size={20} color="inherit" /> : <RefreshRounded />}
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* KPI row */}
      <GridBox min={220} sx={{ mb: 3 }}>
        {kpiCards.map((c) => (
          <StatCard key={c.label} {...c} loading={loading && !data} />
        ))}
      </GridBox>

      {/* Revenue trend + Order status */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          mb: 3,
          gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' },
        }}
      >
        <Panel title="Revenue Trend" subtitle="Ordered vs collected · last 12 months">
          {data ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.revenueTrend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gOrdered" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#45ADE6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#45ADE6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gCollected" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1E7DBE" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#1E7DBE" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={{ stroke: grid }} />
                <YAxis tick={axisStyle} tickLine={false} axisLine={false} tickFormatter={inrCompact} width={64} />
                <RTooltip formatter={(v) => inrFull(v)} contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
                <Area type="monotone" dataKey="ordered" name="Ordered" stroke="#45ADE6" strokeWidth={2.5} fill="url(#gOrdered)" />
                <Area type="monotone" dataKey="collected" name="Collected" stroke="#1E7DBE" strokeWidth={2.5} fill="url(#gCollected)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Skeleton variant="rounded" height="100%" />
          )}
        </Panel>

        <Panel title="Orders by Status">
          {data ? (
            data.ordersByStatus.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.ordersByStatus} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {data.ordersByStatus.map((e, i) => (
                      <Cell key={e.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <RTooltip contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )
          ) : (
            <Skeleton variant="circular" width={160} height={160} sx={{ mx: 'auto' }} />
          )}
          {data && (
            <Stack direction="row" flexWrap="wrap" gap={0.75} justifyContent="center" sx={{ mt: 1 }}>
              {data.ordersByStatus.map((e, i) => (
                <Chip
                  key={e.name}
                  size="small"
                  label={`${e.name} · ${e.value}`}
                  sx={{ bgcolor: `${CHART_COLORS[i % CHART_COLORS.length]}1a`, color: CHART_COLORS[i % CHART_COLORS.length], fontWeight: 600 }}
                />
              ))}
            </Stack>
          )}
        </Panel>
      </Box>

      {/* Sales funnel + Clients by state */}
      <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
        <Panel title="Sales Funnel" subtitle="Quoted → Ordered → Collected">
          {data ? (
            <ResponsiveContainer width="100%" height="100%">
              <FunnelChart>
                <RTooltip formatter={(v) => inrFull(v)} contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
                <Funnel dataKey="value" data={data.salesFunnel} isAnimationActive>
                  {data.salesFunnel.map((e, i) => (
                    <Cell key={e.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                  <LabelList position="right" fill={theme.palette.text.primary} stroke="none" dataKey="name" />
                  <LabelList position="left" fill={theme.palette.text.secondary} stroke="none" dataKey="value" formatter={inrCompact} />
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          ) : (
            <Skeleton variant="rounded" height="100%" />
          )}
        </Panel>

        <Panel title="Clients by State" subtitle="Geographic spread">
          {data ? (
            data.clientsByState.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.clientsByState} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={false} />
                  <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={92} />
                  <RTooltip cursor={{ fill: `${theme.palette.primary.main}10` }} contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>
                    {data.clientsByState.map((e, i) => (
                      <Cell key={e.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )
          ) : (
            <Skeleton variant="rounded" height="100%" />
          )}
        </Panel>
      </Box>

      {/* Dispatch + Procurement + Vendors */}
      <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
        <Panel title="Dispatch Status" height={260}>
          {data && data.dispatchByStatus.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.dispatchByStatus} dataKey="value" nameKey="name" outerRadius={88}>
                  {data.dispatchByStatus.map((e, i) => (
                    <Cell key={e.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <RTooltip contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </Panel>

        <Panel title="Procurement Pipeline" subtitle="By status" height={260}>
          {data && data.procurementByStatus.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.procurementByStatus} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="name" tick={axisStyle} tickLine={false} axisLine={{ stroke: grid }} />
                <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                <RTooltip cursor={{ fill: `${theme.palette.primary.main}10` }} contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={36} fill="#1E7DBE" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </Panel>

        <Panel title="Vendors by Category" height={260}>
          {data && data.vendorsByCategory.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.vendorsByCategory} dataKey="value" nameKey="name" innerRadius={48} outerRadius={88} paddingAngle={2}>
                  {data.vendorsByCategory.map((e, i) => (
                    <Cell key={e.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <RTooltip contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </Panel>
      </Box>

      {/* Department snapshot + recent orders */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
        <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Department Snapshot
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Live operational health across the organization
            </Typography>
          </Box>
          <Divider />
          <Stack divider={<Divider />}>
            {(data?.departments || []).map((d) => (
              <Stack key={d.key} direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.5 }}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box sx={{ p: 1, borderRadius: 2, bgcolor: 'action.hover', display: 'flex' }}>
                    <Inventory2Outlined fontSize="small" color="action" />
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {d.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {typeof d.secondary === 'number' && d.secondaryMoney ? inrCompact(d.secondary) : d.secondary}
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1 }}>
                      {d.metric}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {d.metricLabel}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    label={d.health === 'ok' ? 'On track' : 'Attention'}
                    color={d.health === 'ok' ? 'success' : 'warning'}
                    variant="outlined"
                    sx={{ fontWeight: 600 }}
                  />
                </Stack>
              </Stack>
            ))}
            {!data && [0, 1, 2, 3].map((i) => (
              <Box key={i} sx={{ px: 2, py: 1.5 }}>
                <Skeleton variant="rounded" height={40} />
              </Box>
            ))}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Recent Orders
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Latest client orders
            </Typography>
          </Box>
          <Divider />
          <TableContainer sx={{ maxHeight: 360 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow sx={{ '& th': { bgcolor: 'grey.50', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'text.secondary' } }}>
                  <TableCell>Order</TableCell>
                  <TableCell>Client</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.recentOrders || []).map((o, i) => (
                  <TableRow key={o.id || i} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{o.number}</TableCell>
                    <TableCell>{o.client}</TableCell>
                    <TableCell>{o.date || '—'}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{inrCompact(o.amount)}</TableCell>
                    <TableCell>
                      <Chip size="small" label={o.status} color={statusChipColor(o.status)} sx={{ fontWeight: 600 }} />
                    </TableCell>
                  </TableRow>
                ))}
                {data && data.recentOrders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                      No orders yet.
                    </TableCell>
                  </TableRow>
                )}
                {!data && [0, 1, 2, 3].map((i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}>
                      <Skeleton variant="rounded" height={28} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Box>

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 3, textAlign: 'center' }}>
        Live data from Supabase · auto-refreshes every 60 seconds
      </Typography>
    </Container>
  );
};

export default Dashboard;
