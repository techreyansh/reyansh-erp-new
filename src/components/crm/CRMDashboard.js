import React from 'react';
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
  EmojiEventsOutlined,
  GroupsOutlined,
  PaidOutlined,
  ReceiptLongOutlined,
  RequestQuoteOutlined,
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

const COLORS = ['#45ADE6', '#1E7DBE', '#D97706', '#7C3AED', '#059669', '#DC2626', '#475569', '#DB2777'];

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
  const s = data?.summary;
  const k = s?.kpis || {};
  const axis = { fontSize: 12, fill: theme.palette.text.secondary };
  const grid = theme.palette.divider;

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
    { label: 'Total Leads', value: k.totalLeads ?? 0, sub: `${k.activeLeads ?? 0} active`, icon: GroupsOutlined, accent: '#45ADE6' },
    { label: 'Customers', value: k.totalCustomers ?? 0, sub: 'Active accounts', icon: GroupsOutlined, accent: '#7C3AED' },
    { label: 'Order Value', value: inrCompact(k.orderValue), sub: 'Total booked', icon: ReceiptLongOutlined, accent: '#1E7DBE' },
    { label: 'Collected', value: inrCompact(k.collected), sub: 'Payments in', icon: PaidOutlined, accent: '#059669' },
    { label: 'Outstanding', value: inrCompact(k.outstanding), sub: 'To collect', icon: AccountBalanceWalletOutlined, accent: '#D97706' },
    { label: 'Open Quotes', value: inrCompact(k.openQuoteValue), sub: `${k.openQuotations ?? 0} quotations`, icon: RequestQuoteOutlined, accent: '#DB2777' },
    { label: 'Conversion', value: `${k.conversionRate ?? 0}%`, sub: 'Lead → order', icon: TrendingUpRounded, accent: '#45ADE6' },
    { label: 'Won Deals', value: k.wonLeads ?? 0, sub: 'Qualified/converted', icon: EmojiEventsOutlined, accent: '#059669' },
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
                    <stop offset="5%" stopColor="#45ADE6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#45ADE6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="cgCol" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1E7DBE" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#1E7DBE" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: grid }} />
                <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={inrCompact} width={62} />
                <RTooltip formatter={(v) => inrFull(v)} contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
                <Area type="monotone" dataKey="ordered" name="Ordered" stroke="#45ADE6" strokeWidth={2.5} fill="url(#cgOrd)" />
                <Area type="monotone" dataKey="collected" name="Collected" stroke="#1E7DBE" strokeWidth={2.5} fill="url(#cgCol)" />
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
                <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={34} fill="#45ADE6" />
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
            const color = e.type === 'Order' ? '#1E7DBE' : e.type === 'Payment' ? '#059669' : e.type === 'Quotation' ? '#DB2777' : '#45ADE6';
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
    </Box>
  );
}
