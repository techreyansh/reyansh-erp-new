import React, { useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';
import {
  AccountBalanceWalletOutlined,
  AutorenewRounded,
  EmojiEventsOutlined,
  GroupsOutlined,
  PaidOutlined,
  ReceiptLongOutlined,
  ReportProblemOutlined,
  RequestQuoteOutlined,
  TrendingUpRounded,
  WarningAmberRounded,
} from '@mui/icons-material';
import { usePermissions } from '../../context/PermissionContext';
import { getCustomerAnalytics, getCurrentUserEmail } from '../../services/crmPipelineService';
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

function inrCompact(v) {
  const n = Number(v) || 0;
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${n.toLocaleString('en-IN')}`;
}
const inrFull = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

function StatCard({ label, value, sub, icon: Icon, accent }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2.5, height: '100%' }}>
      <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {label}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5, lineHeight: 1.15 }}>
              {value}
            </Typography>
            {sub && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                {sub}
              </Typography>
            )}
          </Box>
          <Box sx={{ p: 1, borderRadius: 2, bgcolor: `${accent}1a`, color: accent, display: 'flex' }}>
            <Icon />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

function Panel({ title, subtitle, children, height = 300 }) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 1.5, sm: 2 }, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{title}</Typography>
        {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
      </Box>
      <Box sx={{ flex: 1, height }}>{children}</Box>
    </Paper>
  );
}

const Empty = ({ label = 'No data yet' }) => (
  <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', color: 'text.disabled' }}>
    <Typography variant="body2">{label}</Typography>
  </Stack>
);

export default function CRMDashboard({ data, loading }) {
  const theme = useTheme();
  const COLORS = [
    theme.palette.primary.main,
    theme.palette.primary.dark,
    theme.palette.warning.main,
    theme.palette.primary.light,
    theme.palette.success.main,
    theme.palette.error.main,
    theme.palette.text.secondary,
    theme.palette.info.dark,
  ];
  const s = data?.summary;
  const k = s?.kpis || {};
  const axis = { fontSize: 12, fill: theme.palette.text.secondary };
  const grid = theme.palette.divider;

  // --- Reorder & Retention: analytics + ownership scoping ---
  // CEO / super-admin / full-access users see every customer; a normal rep sees
  // only rows they own (case-insensitive) or unassigned rows. roleCode/hasFullAccess
  // come from the RBAC permission context; the current email from Supabase auth.
  const { roleCode, hasFullAccess } = usePermissions();
  const [analytics, setAnalytics] = useState([]);
  const [myEmail, setMyEmail] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [rows, email] = await Promise.all([
        getCustomerAnalytics(),
        getCurrentUserEmail(),
      ]);
      if (!alive) return;
      setAnalytics(Array.isArray(rows) ? rows : []);
      setMyEmail(email || null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const seesAll =
    hasFullAccess || ['CEO', 'SUPER_ADMIN', 'SUPERADMIN'].includes(String(roleCode || '').toUpperCase());

  const scopedAnalytics = useMemo(() => {
    if (seesAll) return analytics;
    const me = String(myEmail || '').toLowerCase();
    return analytics.filter((r) => {
      const owner = r.owner_email;
      return owner == null || (me && String(owner).toLowerCase() === me);
    });
  }, [analytics, myEmail, seesAll]);

  const dueStatusMeta = {
    overdue: { label: 'Overdue', color: theme.palette.error.main, rank: 0 },
    due: { label: 'Due', color: theme.palette.warning.main, rank: 1 },
    due_soon: { label: 'Due soon', color: theme.palette.info.main, rank: 2 },
    ok: { label: 'On cadence', color: theme.palette.success.main, rank: 3 },
    new: { label: 'New', color: theme.palette.text.secondary, rank: 4 },
  };

  const reorderRows = useMemo(() => {
    const subset = scopedAnalytics.filter((r) =>
      ['due_soon', 'due', 'overdue'].includes(r.due_status),
    );
    return subset.sort((a, b) => {
      const ra = dueStatusMeta[a.due_status]?.rank ?? 9;
      const rb = dueStatusMeta[b.due_status]?.rank ?? 9;
      if (ra !== rb) return ra - rb;
      return (Number(b.recency_days) || 0) - (Number(a.recency_days) || 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedAnalytics]);

  const churnLeaders = useMemo(
    () =>
      [...scopedAnalytics]
        .sort((a, b) => (Number(b.churn_score) || 0) - (Number(a.churn_score) || 0))
        .slice(0, 8),
    [scopedAnalytics],
  );

  const dueDistribution = useMemo(() => {
    const order = ['new', 'ok', 'due_soon', 'due', 'overdue'];
    const counts = order.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    scopedAnalytics.forEach((r) => {
      if (counts[r.due_status] != null) counts[r.due_status] += 1;
    });
    return order.map((key) => ({
      name: dueStatusMeta[key].label,
      value: counts[key],
      fill: dueStatusMeta[key].color,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedAnalytics]);

  const retentionKpis = useMemo(() => {
    const count = (fn) => scopedAnalytics.filter(fn).length;
    return {
      dueToReorder: count((r) => ['due_soon', 'due'].includes(r.due_status)),
      overdue: count((r) => r.due_status === 'overdue'),
      atRisk: count((r) => (Number(r.churn_score) || 0) >= 50),
      active: scopedAnalytics.length,
    };
  }, [scopedAnalytics]);

  if (loading && !data) {
    return (
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,1fr)', lg: 'repeat(4,1fr)' } }}>
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} variant="rounded" height={96} />
        ))}
      </Box>
    );
  }

  const kpiCards = [
    { label: 'Total Leads', value: k.totalLeads ?? 0, sub: `${k.activeLeads ?? 0} active`, icon: GroupsOutlined, accent: theme.palette.primary.main },
    { label: 'Customers', value: k.totalCustomers ?? 0, sub: 'Active accounts', icon: GroupsOutlined, accent: theme.palette.primary.light },
    { label: 'Order Value', value: inrCompact(k.orderValue), sub: 'Total booked', icon: ReceiptLongOutlined, accent: theme.palette.primary.dark },
    { label: 'Collected', value: inrCompact(k.collected), sub: 'Payments in', icon: PaidOutlined, accent: theme.palette.success.main },
    { label: 'Outstanding', value: inrCompact(k.outstanding), sub: 'To collect', icon: AccountBalanceWalletOutlined, accent: theme.palette.warning.main },
    { label: 'Open Quotes', value: inrCompact(k.openQuoteValue), sub: `${k.openQuotations ?? 0} quotations`, icon: RequestQuoteOutlined, accent: theme.palette.error.main },
    { label: 'Conversion', value: `${k.conversionRate ?? 0}%`, sub: 'Lead → order', icon: TrendingUpRounded, accent: theme.palette.primary.main },
    { label: 'Won Deals', value: k.wonLeads ?? 0, sub: 'Qualified/converted', icon: EmojiEventsOutlined, accent: theme.palette.success.main },
  ];

  return (
    <Box>
      {/* KPI row */}
      <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(2,1fr)', md: 'repeat(4,1fr)' } }}>
        {kpiCards.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
      </Box>

      {/* Revenue trend + funnel */}
      <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' } }}>
        <Panel title="Revenue Trend" subtitle="Ordered vs collected · last 12 months">
          {s ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={s.revenueTrend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="cgOrd" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={theme.palette.primary.main} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={theme.palette.primary.main} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="cgCol" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={theme.palette.primary.dark} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={theme.palette.primary.dark} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: grid }} />
                <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={inrCompact} width={62} />
                <RTooltip formatter={(v) => inrFull(v)} contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
                <Area type="monotone" dataKey="ordered" name="Ordered" stroke={theme.palette.primary.main} strokeWidth={2.5} fill="url(#cgOrd)" />
                <Area type="monotone" dataKey="collected" name="Collected" stroke={theme.palette.primary.dark} strokeWidth={2.5} fill="url(#cgCol)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Panel>

        <Panel title="Sales Funnel" subtitle="Leads → Quotations → Orders → Won">
          {s && s.funnel.some((f) => f.value > 0) ? (
            <ResponsiveContainer width="100%" height="100%">
              <FunnelChart>
                <RTooltip contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
                <Funnel dataKey="value" data={s.funnel} isAnimationActive>
                  {s.funnel.map((e, i) => (
                    <Cell key={e.name} fill={COLORS[i % COLORS.length]} />
                  ))}
                  <LabelList position="right" fill={theme.palette.text.primary} stroke="none" dataKey="name" />
                  <LabelList position="left" fill={theme.palette.text.secondary} stroke="none" dataKey="value" />
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Panel>
      </Box>

      {/* Lead source + pipeline + top customers */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3,1fr)' } }}>
        <Panel title="Leads by Source" height={260}>
          {s && s.leadsBySource.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={s.leadsBySource} dataKey="value" nameKey="name" innerRadius={48} outerRadius={86} paddingAngle={2}>
                  {s.leadsBySource.map((e, i) => (
                    <Cell key={e.name} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <RTooltip contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Panel>

        <Panel title="Lead Pipeline" subtitle="By qualification status" height={260}>
          {s && s.pipelineByStatus.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={s.pipelineByStatus} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={{ stroke: grid }} />
                <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <RTooltip cursor={{ fill: `${theme.palette.primary.main}10` }} contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={34} fill={theme.palette.primary.main} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Panel>

        <Panel title="Top Customers" subtitle="By order value" height={260}>
          {s && s.topCustomers.length ? (
            <Stack spacing={1.25} sx={{ height: '100%', overflow: 'auto', pr: 0.5 }}>
              {s.topCustomers.map((c, i) => {
                const max = s.topCustomers[0]?.value || 1;
                return (
                  <Box key={c.name}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                        <Avatar sx={{ width: 26, height: 26, fontSize: 12, fontWeight: 700, bgcolor: COLORS[i % COLORS.length] }}>
                          {i + 1}
                        </Avatar>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 500, maxWidth: 130 }}>
                          {c.name}
                        </Typography>
                      </Stack>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{inrCompact(c.value)}</Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min((c.value / max) * 100, 100)}
                      sx={{ mt: 0.5, height: 6, borderRadius: 3, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { bgcolor: COLORS[i % COLORS.length] } }}
                    />
                  </Box>
                );
              })}
            </Stack>
          ) : <Empty />}
        </Panel>
      </Box>

      {/* Activity timeline */}
      <Paper variant="outlined" sx={{ borderRadius: 2.5, mt: 3, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Recent Activity</Typography>
          <Typography variant="caption" color="text.secondary">Latest leads, quotations, orders & payments across the ERP</Typography>
        </Box>
        <Divider />
        <Stack divider={<Divider />} sx={{ maxHeight: 380, overflow: 'auto' }}>
          {(data?.timeline || []).map((e, i) => {
            const color = e.type === 'Order' ? theme.palette.primary.dark : e.type === 'Payment' ? theme.palette.success.main : e.type === 'Quotation' ? theme.palette.error.main : theme.palette.primary.main;
            return (
              <Stack key={i} direction="row" alignItems="center" justifyContent="space-between" spacing={1.5} sx={{ px: 2, py: 1.25 }}>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                  <Chip label={e.type} size="small" sx={{ bgcolor: `${color}1a`, color, fontWeight: 700, minWidth: 86 }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>{e.title}</Typography>
                    <Typography variant="caption" color="text.secondary">{e.date}</Typography>
                  </Box>
                </Stack>
                {e.amount != null && (
                  <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{inrCompact(e.amount)}</Typography>
                )}
              </Stack>
            );
          })}
          {data && data.timeline.length === 0 && (
            <Box sx={{ px: 2, py: 4, textAlign: 'center', color: 'text.secondary' }}>
              <Typography variant="body2">No recent activity.</Typography>
            </Box>
          )}
        </Stack>
      </Paper>

      {/* Reorder & Retention */}
      <Box sx={{ mt: 4 }}>
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Reorder &amp; Retention</Typography>
          <Typography variant="caption" color="text.secondary">
            Repeat-customer order cadence, reorder timing &amp; churn risk
            {seesAll ? ' · all customers' : ' · your accounts'}
          </Typography>
        </Box>

        {/* Retention KPIs */}
        <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(2,1fr)', md: 'repeat(4,1fr)' } }}>
          <StatCard label="Due to reorder" value={retentionKpis.dueToReorder} sub="Due soon + due" icon={AutorenewRounded} accent={theme.palette.warning.main} />
          <StatCard label="Overdue" value={retentionKpis.overdue} sub="Past expected reorder" icon={ReportProblemOutlined} accent={theme.palette.error.main} />
          <StatCard label="At-risk" value={retentionKpis.atRisk} sub="Churn score ≥ 50" icon={WarningAmberRounded} accent={theme.palette.warning.dark} />
          <StatCard label="Active customers" value={retentionKpis.active} sub="Repeat accounts" icon={GroupsOutlined} accent={theme.palette.primary.main} />
        </Box>

        {/* Reorder due list + churn leaderboard */}
        <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' } }}>
          <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
            <Box sx={{ px: 2, py: 1.5 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Reorder due</Typography>
              <Typography variant="caption" color="text.secondary">Customers approaching or past their next order</Typography>
            </Box>
            <Divider />
            {reorderRows.length ? (
              <Stack divider={<Divider />} sx={{ maxHeight: 380, overflow: 'auto' }}>
                {reorderRows.map((r, i) => {
                  const meta = dueStatusMeta[r.due_status] || dueStatusMeta.ok;
                  return (
                    <Stack key={r.client_code || i} direction="row" alignItems="center" justifyContent="space-between" spacing={1.5} sx={{ px: 2, py: 1.25 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{r.company_name || r.client_code || 'Customer'}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {(Number(r.recency_days) || 0)} d ago · cadence {(Number(r.cadence_days) || 0)} d
                          {r.next_expected ? ` · next ${r.next_expected}` : ''}
                        </Typography>
                      </Box>
                      <Stack alignItems="flex-end" spacing={0.5} sx={{ flexShrink: 0 }}>
                        <Chip label={meta.label} size="small" sx={{ bgcolor: `${meta.color}1a`, color: meta.color, fontWeight: 700 }} />
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{inrCompact(r.total_value)}</Typography>
                      </Stack>
                    </Stack>
                  );
                })}
              </Stack>
            ) : (
              <Box sx={{ px: 2, py: 4, textAlign: 'center', color: 'text.secondary' }}>
                <Typography variant="body2">No reorders due — all customers on cadence.</Typography>
              </Box>
            )}
          </Paper>

          <Panel title="Churn risk" subtitle="Top accounts by churn score" height={340}>
            {churnLeaders.length ? (
              <Stack spacing={1.25} sx={{ height: '100%', overflow: 'auto', pr: 0.5 }}>
                {churnLeaders.map((c, i) => {
                  const score = Math.max(0, Math.min(Number(c.churn_score) || 0, 100));
                  const barColor = score >= 70 ? theme.palette.error.main : score >= 50 ? theme.palette.warning.main : theme.palette.success.main;
                  return (
                    <Box key={c.client_code || i}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 500, minWidth: 0, maxWidth: 150 }}>
                          {c.company_name || c.client_code || 'Customer'}
                        </Typography>
                        <Chip label={Math.round(score)} size="small" sx={{ bgcolor: `${barColor}1a`, color: barColor, fontWeight: 700 }} />
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={score}
                        sx={{ mt: 0.5, height: 6, borderRadius: 3, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { bgcolor: barColor } }}
                      />
                    </Box>
                  );
                })}
              </Stack>
            ) : <Empty label="No customer analytics yet" />}
          </Panel>
        </Box>

        {/* Reorder status distribution */}
        <Panel title="Reorder status distribution" subtitle="Customers by reorder timing" height={260}>
          {scopedAnalytics.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dueDistribution} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={{ stroke: grid }} />
                <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <RTooltip cursor={{ fill: `${theme.palette.primary.main}10` }} contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={48}>
                  {dueDistribution.map((e) => (
                    <Cell key={e.name} fill={e.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty label="No customer analytics yet" />}
        </Panel>
      </Box>
    </Box>
  );
}
