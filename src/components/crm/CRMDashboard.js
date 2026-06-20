import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  AccountBalanceWalletOutlined,
  AutorenewRounded,
  ChevronLeftRounded,
  ChevronRightRounded,
  EditOutlined,
  EmojiEventsOutlined,
  EventRepeatRounded,
  FlagOutlined,
  GroupsOutlined,
  PaidOutlined,
  PlaylistAddCheckRounded,
  ReceiptLongOutlined,
  ReplayRounded,
  ReportProblemOutlined,
  RequestQuoteOutlined,
  TrendingUpRounded,
  WarningAmberRounded,
} from '@mui/icons-material';
import { usePermissions } from '../../context/PermissionContext';
import {
  getCustomerAnalytics,
  getCurrentUserEmail,
  prospectDashboard,
  clientDashboard,
  listAssignableUsers,
  rfmDashboard,
  repScorecard,
  setRepTarget,
  walletDashboard,
  PROSPECT_STAGES,
  CLIENT_STAGES,
} from '../../services/crmPipelineService';
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

// Display name from an email — uses the resolved name map if available, else the
// email's local-part (prefix before @), title-cased lightly.
function ownerDisplay(email, nameMap) {
  if (!email) return 'Unassigned';
  const resolved = nameMap && nameMap[String(email).toLowerCase()];
  if (resolved) return resolved;
  const prefix = String(email).split('@')[0] || email;
  return prefix.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const KpiGrid = ({ children }) => (
  <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(2,1fr)', md: 'repeat(3,1fr)' } }}>
    {children}
  </Box>
);

const KpiSkeletons = ({ n = 6 }) => (
  <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(2,1fr)', md: 'repeat(3,1fr)' } }}>
    {[...Array(n)].map((_, i) => (
      <Skeleton key={i} variant="rounded" height={96} />
    ))}
  </Box>
);

// ---------------------------------------------------------------------------
// PROSPECTS TAB
// ---------------------------------------------------------------------------
function ProspectsTab() {
  const theme = useTheme();
  const COLORS = [
    theme.palette.primary.main,
    theme.palette.primary.dark,
    theme.palette.warning.main,
    theme.palette.primary.light,
    theme.palette.success.main,
    theme.palette.error.main,
    theme.palette.info.dark,
    theme.palette.text.secondary,
  ];
  const axis = { fontSize: 12, fill: theme.palette.text.secondary };
  const grid = theme.palette.divider;

  const [d, setD] = useState(null);
  const [nameMap, setNameMap] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const [dash, users] = await Promise.all([prospectDashboard(), listAssignableUsers()]);
        if (!alive) return;
        setD(dash || null);
        const map = {};
        (Array.isArray(users) ? users : []).forEach((u) => {
          if (u && u.email) map[String(u.email).toLowerCase()] = u.full_name || null;
        });
        setNameMap(map);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const funnel = useMemo(() => {
    const f = (d && d.funnel) || {};
    return PROSPECT_STAGES.map((st, i) => ({
      name: st.label,
      value: Number(f[st.key]) || 0,
      fill: COLORS[i % COLORS.length],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  const byOwner = useMemo(() => {
    const rows = (d && Array.isArray(d.by_owner) ? d.by_owner : [])
      .map((r) => ({ name: ownerDisplay(r.owner_email, nameMap), value: Number(r.n) || 0 }))
      .sort((a, b) => b.value - a.value);
    return rows;
  }, [d, nameMap]);

  if (loading) {
    return (
      <Box>
        <KpiSkeletons n={6} />
        <Skeleton variant="rounded" height={320} />
      </Box>
    );
  }

  if (!d) {
    return <Empty label="Prospect dashboard is unavailable right now." />;
  }

  const followupsDue = Number(d.followups_due) || 0;
  const kpis = [
    { label: 'Total Prospects', value: d.total_prospects ?? 0, sub: 'In pipeline', icon: GroupsOutlined, accent: theme.palette.primary.main },
    { label: 'New This Month', value: d.new_this_month ?? 0, sub: 'Added this month', icon: TrendingUpRounded, accent: theme.palette.primary.light },
    { label: 'Follow-ups Due', value: followupsDue, sub: `${d.followups_open ?? 0} open`, icon: WarningAmberRounded, accent: followupsDue > 0 ? theme.palette.error.main : theme.palette.success.main },
    { label: 'Pipeline Value', value: inrCompact(d.pipeline_value), sub: 'Total open', icon: ReceiptLongOutlined, accent: theme.palette.primary.dark },
    { label: 'Weighted Pipeline', value: inrCompact(d.weighted_pipeline), sub: 'Probability-weighted', icon: AccountBalanceWalletOutlined, accent: theme.palette.warning.main },
    { label: 'Conversion Rate', value: `${Number(d.conversion_rate) || 0}%`, sub: `${d.converted ?? 0} converted`, icon: EmojiEventsOutlined, accent: theme.palette.success.main },
  ];

  const funnelHasData = funnel.some((f) => f.value > 0);

  return (
    <Box>
      <KpiGrid>
        {kpis.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
      </KpiGrid>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' } }}>
        <Panel title="Stage-wise Funnel" subtitle="Lead → Converted · prospect lifecycle" height={360}>
          {funnelHasData ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={funnel} margin={{ top: 4, right: 28, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={false} />
                <XAxis type="number" tick={axis} tickLine={false} axisLine={{ stroke: grid }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={axis} tickLine={false} axisLine={false} width={120} />
                <RTooltip cursor={{ fill: `${theme.palette.primary.main}10` }} contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={22}>
                  {funnel.map((e) => (
                    <Cell key={e.name} fill={e.fill} />
                  ))}
                  <LabelList dataKey="value" position="right" fill={theme.palette.text.primary} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty label="No prospects in any stage yet." />
          )}
        </Panel>

        <Panel title="Prospects by Salesperson" subtitle="Owned prospect count" height={360}>
          {byOwner.length ? (
            <Stack spacing={1.25} sx={{ height: '100%', overflow: 'auto', pr: 0.5 }}>
              {byOwner.map((o, i) => {
                const max = byOwner[0]?.value || 1;
                return (
                  <Box key={o.name + i}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                        <Avatar sx={{ width: 26, height: 26, fontSize: 12, fontWeight: 700, bgcolor: COLORS[i % COLORS.length] }}>
                          {(o.name[0] || '?').toUpperCase()}
                        </Avatar>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 500, maxWidth: 150 }}>
                          {o.name}
                        </Typography>
                      </Stack>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{o.value}</Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min((o.value / max) * 100, 100)}
                      sx={{ mt: 0.5, height: 6, borderRadius: 3, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { bgcolor: COLORS[i % COLORS.length] } }}
                    />
                  </Box>
                );
              })}
            </Stack>
          ) : (
            <Empty label="No prospects assigned yet." />
          )}
        </Panel>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// CLIENTS TAB
// ---------------------------------------------------------------------------
function ClientsTab({ ownerScope }) {
  const theme = useTheme();
  const COLORS = [
    theme.palette.primary.main,
    theme.palette.primary.light,
    theme.palette.success.main,
    theme.palette.text.secondary,
    theme.palette.warning.main,
    theme.palette.error.main,
  ];
  const axis = { fontSize: 12, fill: theme.palette.text.secondary };
  const grid = theme.palette.divider;

  const [d, setD] = useState(null);
  const [nameMap, setNameMap] = useState({});
  const [loading, setLoading] = useState(true);

  // Share-of-Wallet dashboard, scoped exactly like RfmTab (null for CEO/managers,
  // else the rep's email). Loaded in its own effect so a wallet error never
  // blocks the rest of the clients view.
  const [wallet, setWallet] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const [dash, users] = await Promise.all([clientDashboard(), listAssignableUsers()]);
        if (!alive) return;
        setD(dash || null);
        const map = {};
        (Array.isArray(users) ? users : []).forEach((u) => {
          if (u && u.email) map[String(u.email).toLowerCase()] = u.full_name || null;
        });
        setNameMap(map);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const w = await walletDashboard(ownerScope);
        if (alive) setWallet(w || null);
      } catch {
        if (alive) setWallet(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ownerScope]);

  const lifecycle = useMemo(() => {
    const bs = (d && d.by_stage) || {};
    return CLIENT_STAGES.map((st, i) => ({
      name: st.label,
      value: Number(bs[st.key]) || 0,
      fill: COLORS[i % COLORS.length],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  const topCustomers = useMemo(
    () => (d && Array.isArray(d.top_customers) ? d.top_customers : []),
    [d],
  );

  if (loading) {
    return (
      <Box>
        <KpiSkeletons n={6} />
        <Skeleton variant="rounded" height={320} />
      </Box>
    );
  }

  if (!d) {
    return <Empty label="Client dashboard is unavailable right now." />;
  }

  const revenueTotal = Number(d.revenue_total) || 0;
  const kpis = [
    { label: 'Total Active Clients', value: d.total_clients ?? 0, sub: 'On the books', icon: GroupsOutlined, accent: theme.palette.primary.main },
    { label: 'Key Accounts', value: d.key_accounts ?? 0, sub: 'Strategic clients', icon: EmojiEventsOutlined, accent: theme.palette.success.main },
    { label: 'Dormant Clients', value: d.dormant ?? 0, sub: 'Inactive', icon: WarningAmberRounded, accent: (Number(d.dormant) || 0) > 0 ? theme.palette.warning.dark : theme.palette.success.main },
    { label: 'Revenue Total', value: revenueTotal > 0 ? inrCompact(revenueTotal) : '—', sub: revenueTotal > 0 ? 'Lifetime billed' : 'No revenue recorded yet', icon: PaidOutlined, accent: theme.palette.primary.dark },
    { label: 'Outstanding', value: inrCompact(d.outstanding), sub: 'To collect', icon: AccountBalanceWalletOutlined, accent: theme.palette.warning.main },
    { label: 'Overdue', value: inrCompact(d.overdue), sub: 'Past due', icon: ReportProblemOutlined, accent: theme.palette.error.main },
  ];

  const lifecycleHasData = lifecycle.some((l) => l.value > 0);

  return (
    <Box>
      <KpiGrid>
        {kpis.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
      </KpiGrid>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
        <Panel title="Clients by Lifecycle" subtitle="Active · Repeat · Key · Dormant" height={320}>
          {lifecycleHasData ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={lifecycle} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={{ stroke: grid }} />
                <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <RTooltip cursor={{ fill: `${theme.palette.primary.main}10` }} contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={48}>
                  {lifecycle.map((e) => (
                    <Cell key={e.name} fill={e.fill} />
                  ))}
                  <LabelList dataKey="value" position="top" fill={theme.palette.text.secondary} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty label="No clients on the books yet." />
          )}
        </Panel>

        <Panel title="Top Customers" subtitle="By lifetime revenue" height={320}>
          {topCustomers.length ? (
            <Stack divider={<Divider />} sx={{ height: '100%', overflow: 'auto' }}>
              {topCustomers.map((c, i) => (
                <Stack key={c.customer_code || c.company_name || i} direction="row" alignItems="center" justifyContent="space-between" spacing={1.5} sx={{ py: 1 }}>
                  <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
                    <Avatar sx={{ width: 28, height: 28, fontSize: 12, fontWeight: 700, bgcolor: COLORS[i % COLORS.length] }}>
                      {i + 1}
                    </Avatar>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight: 600, maxWidth: 200 }}>
                        {c.company_name || c.customer_code || 'Customer'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', maxWidth: 200 }}>
                        {c.customer_code || '—'} · {ownerDisplay(c.owner_email, nameMap)}
                      </Typography>
                    </Box>
                  </Stack>
                  <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {inrCompact(c.revenue)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : (
            <Empty label={revenueTotal > 0 ? 'No top customers yet.' : 'No revenue recorded yet'} />
          )}
        </Panel>
      </Box>

      {/* ---------------- Share of Wallet ---------------- */}
      <Box sx={{ mt: 4 }}>
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Share of Wallet</Typography>
          <Typography variant="caption" color="text.secondary">
            How much of each client&apos;s yearly spend we capture vs. their estimated potential
          </Typography>
        </Box>
        {(() => {
          if (!wallet) {
            return <Empty label="Share-of-wallet is unavailable right now." />;
          }
          const accountsWith = Number(wallet.accounts_with_potential) || 0;
          if (accountsWith === 0) {
            return (
              <Paper
                variant="outlined"
                sx={{
                  borderRadius: 2.5,
                  p: { xs: 2, sm: 3 },
                  textAlign: 'center',
                  bgcolor: alpha(theme.palette.primary.main, 0.04),
                }}
              >
                <AccountBalanceWalletOutlined sx={{ fontSize: 36, color: 'text.disabled', mb: 1 }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  No annual potential set yet
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460, mx: 'auto', mt: 0.5 }}>
                  Set an &apos;Annual potential&apos; on your client accounts (in the account drawer) to
                  unlock share-of-wallet.
                </Typography>
              </Paper>
            );
          }
          const captureRate = Number(wallet.capture_rate) || 0;
          const captureAccent =
            captureRate >= 50
              ? theme.palette.success.main
              : captureRate >= 25
              ? theme.palette.warning.main
              : theme.palette.error.main;
          const topUntapped = Array.isArray(wallet.top_untapped) ? wallet.top_untapped : [];
          const totalClients = Number(wallet.total_clients) || 0;
          return (
            <Box>
              {/* SOW KPI row */}
              <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(2,1fr)', md: 'repeat(4,1fr)' } }}>
                <StatCard
                  label="Accounts with potential"
                  value={`${accountsWith}/${totalClients}`}
                  sub="Clients with a target set"
                  icon={GroupsOutlined}
                  accent={theme.palette.primary.main}
                />
                <StatCard
                  label="Wallet capture"
                  value={`${Math.round(captureRate)}%`}
                  sub="Captured ÷ potential"
                  icon={TrendingUpRounded}
                  accent={captureAccent}
                />
                <StatCard
                  label="Untapped opportunity"
                  value={inrCompact(wallet.total_untapped)}
                  sub="Headroom left to win"
                  icon={WarningAmberRounded}
                  accent={theme.palette.warning.main}
                />
                <StatCard
                  label="Total potential"
                  value={inrCompact(wallet.total_potential)}
                  sub="Estimated yearly spend"
                  icon={PaidOutlined}
                  accent={theme.palette.primary.dark}
                />
              </Box>

              {/* Biggest untapped accounts */}
              <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
                <Box sx={{ px: 2, py: 1.5 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Biggest untapped accounts</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Clients with the most headroom between current spend and potential
                  </Typography>
                </Box>
                <Divider />
                {topUntapped.length ? (
                  <Stack divider={<Divider />} sx={{ maxHeight: 420, overflow: 'auto' }}>
                    {topUntapped.map((r, i) => {
                      const capturePct = Math.min(100, Number(r.capture_pct) || 0);
                      const meta = [r.customer_code, r.industry, r.city].filter(Boolean).join(' · ');
                      return (
                        <Box key={r.customer_code || r.company_name || i} sx={{ px: 2, py: 1.25 }}>
                          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" noWrap sx={{ fontWeight: 600, maxWidth: 240 }}>
                                {r.company_name || r.customer_code || 'Customer'}
                              </Typography>
                              {meta && (
                                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', maxWidth: 240 }}>
                                  {meta}
                                </Typography>
                              )}
                            </Box>
                            <Stack direction="row" spacing={2} alignItems="center" sx={{ flexShrink: 0 }}>
                              <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>12-mo</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>{inrCompact(r.value_12mo)}</Typography>
                              </Box>
                              <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Potential</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>{inrCompact(r.annual_potential)}</Typography>
                              </Box>
                              <Box sx={{ textAlign: 'right' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Untapped</Typography>
                                <Typography variant="body2" sx={{ fontWeight: 800, color: theme.palette.warning.dark }}>
                                  {inrCompact(r.untapped)}
                                </Typography>
                              </Box>
                            </Stack>
                          </Stack>
                          <LinearProgress
                            variant="determinate"
                            value={capturePct}
                            sx={{
                              mt: 0.75,
                              height: 5,
                              borderRadius: 3,
                              bgcolor: 'action.hover',
                              '& .MuiLinearProgress-bar': {
                                bgcolor:
                                  capturePct >= 50
                                    ? theme.palette.success.main
                                    : capturePct >= 25
                                    ? theme.palette.warning.main
                                    : theme.palette.error.main,
                              },
                            }}
                          />
                        </Box>
                      );
                    })}
                  </Stack>
                ) : (
                  <Box sx={{ py: 4 }}>
                    <Empty label="No untapped accounts — every client is at potential." />
                  </Box>
                )}
              </Paper>
            </Box>
          );
        })()}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// RFM & RETENTION TAB
// ---------------------------------------------------------------------------
// Segment key → label + color maps. Copied verbatim from
// src/pages/crm/RepWorklist.js so the two screens stay visually identical
// (same segment ordering, labels and theme-resolved colors).
const RFM_SEGMENTS = [
  { key: 'champion', label: 'Champion' },
  { key: 'loyal', label: 'Loyal' },
  { key: 'potential', label: 'Potential' },
  { key: 'at_risk', label: 'At Risk' },
  { key: 'hibernating', label: 'Hibernating' },
  { key: 'new', label: 'New' },
];

// Resolve a segment key → a concrete theme color (mirrors RepWorklist.js).
function rfmSegmentColor(theme, key) {
  switch (key) {
    case 'champion':
      return theme.palette.success.main;
    case 'loyal':
      return theme.palette.primary.main;
    case 'potential':
      return theme.palette.secondary.main;
    case 'at_risk':
      return theme.palette.error.main;
    case 'hibernating':
      return theme.palette.warning.main;
    case 'new':
    default:
      return theme.palette.text.secondary;
  }
}

const RFM_SEGMENT_LABELS = RFM_SEGMENTS.reduce((acc, s) => {
  acc[s.key] = s.label;
  return acc;
}, {});

function RfmTab({ ownerScope }) {
  const theme = useTheme();
  const navigate = useNavigate();

  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const dash = await rfmDashboard(ownerScope);
        if (!alive) return;
        setD(dash || null);
      } catch {
        if (alive) setD(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ownerScope]);

  // Build a lookup of the sparse grid: `${r}_${f}` → { count, value }.
  const gridMap = useMemo(() => {
    const m = {};
    const cells = d && Array.isArray(d.grid) ? d.grid : [];
    cells.forEach((c) => {
      m[`${c.r_score}_${c.f_score}`] = {
        count: Number(c.count) || 0,
        value: Number(c.value) || 0,
      };
    });
    return m;
  }, [d]);

  const maxCellCount = useMemo(() => {
    let max = 0;
    Object.values(gridMap).forEach((c) => {
      if (c.count > max) max = c.count;
    });
    return max;
  }, [gridMap]);

  const segments = useMemo(
    () => (d && Array.isArray(d.segments) ? d.segments : []),
    [d],
  );

  const totalSegValue = useMemo(
    () => segments.reduce((sum, s) => sum + (Number(s.total_value) || 0), 0),
    [segments],
  );

  if (loading) {
    return (
      <Box>
        <KpiSkeletons n={5} />
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
          <Skeleton variant="rounded" height={360} />
          <Skeleton variant="rounded" height={360} />
        </Box>
      </Box>
    );
  }

  if (!d) {
    return <Empty label="No client analytics yet — RFM needs order history." />;
  }

  const stats = d.stats || {};
  const cadence = stats.avg_cadence_days != null ? `${Math.round(Number(stats.avg_cadence_days))}d` : '—';

  const kpis = [
    {
      label: 'Total Clients',
      value: d.total_clients ?? 0,
      sub: `${stats.with_orders ?? 0} with orders`,
      icon: GroupsOutlined,
      accent: theme.palette.primary.main,
    },
    {
      label: 'Repeat Rate',
      value: `${Number(stats.repeat_rate) || 0}%`,
      sub: '≥2 orders',
      icon: ReplayRounded,
      accent: theme.palette.success.main,
    },
    {
      label: 'On-time Reorder',
      value: `${Number(stats.on_time_rate) || 0}%`,
      sub: 'of customers with orders',
      icon: EventRepeatRounded,
      accent: theme.palette.info.main,
    },
    {
      label: 'At-risk Value',
      value: inrCompact(stats.at_risk_value),
      sub: '12-mo value of overdue accounts',
      icon: ReportProblemOutlined,
      accent: theme.palette.error.main,
    },
    {
      label: 'Avg Reorder Cadence',
      value: cadence,
      sub: 'Between orders',
      icon: AutorenewRounded,
      accent: theme.palette.warning.main,
    },
  ];

  const hasGrid = maxCellCount > 0 || Object.keys(gridMap).length > 0;

  return (
    <Box>
      {/* KPI row */}
      <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(2,1fr)', md: 'repeat(5,1fr)' } }}>
        {kpis.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
        {/* RFM grid heatmap */}
        <Panel
          title="RFM grid"
          subtitle="High-R = ordered recently / on-cadence · High-F = orders frequently"
          height="auto"
        >
          {hasGrid ? (
            <Box>
              <Stack direction="row" spacing={1}>
                {/* Vertical "Recency →" axis label */}
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    writingMode: 'vertical-rl',
                    transform: 'rotate(180deg)',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: 'text.secondary',
                  }}
                >
                  Recency →
                </Box>

                <Box sx={{ flex: 1 }}>
                  {/* 5 rows: r = 5 (top) … 1 (bottom) */}
                  {[5, 4, 3, 2, 1].map((r) => (
                    <Stack key={r} direction="row" spacing={0.75} sx={{ mb: 0.75 }}>
                      <Box
                        sx={{
                          width: 16,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'text.secondary',
                        }}
                      >
                        {r}
                      </Box>
                      {/* 5 cols: f = 1 (left) … 5 (right) */}
                      {[1, 2, 3, 4, 5].map((f) => {
                        const cell = gridMap[`${r}_${f}`] || { count: 0, value: 0 };
                        const ratio = maxCellCount > 0 ? cell.count / maxCellCount : 0;
                        // Floor so 0-count cells read as a faint divider tint;
                        // populated cells scale up to a strong primary fill.
                        const intensity = cell.count > 0 ? 0.12 + ratio * 0.68 : 0.04;
                        const bg = alpha(theme.palette.primary.main, intensity);
                        const strong = intensity >= 0.45;
                        return (
                          <Tooltip
                            key={f}
                            title={`R${r} · F${f} — ${cell.count} clients · ${inrCompact(cell.value)}`}
                            arrow
                          >
                            <Box
                              sx={{
                                flex: 1,
                                aspectRatio: '1 / 1',
                                minWidth: 0,
                                borderRadius: 1,
                                bgcolor: bg,
                                border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 13,
                                fontWeight: 700,
                                color: strong
                                  ? theme.palette.getContrastText(theme.palette.primary.main)
                                  : theme.palette.text.primary,
                              }}
                            >
                              {cell.count || ''}
                            </Box>
                          </Tooltip>
                        );
                      })}
                    </Stack>
                  ))}

                  {/* Frequency column labels */}
                  <Stack direction="row" spacing={0.75} sx={{ mt: 0.25 }}>
                    <Box sx={{ width: 16 }} />
                    {[1, 2, 3, 4, 5].map((f) => (
                      <Box
                        key={f}
                        sx={{
                          flex: 1,
                          textAlign: 'center',
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'text.secondary',
                        }}
                      >
                        {f}
                      </Box>
                    ))}
                  </Stack>

                  {/* Horizontal "Frequency →" axis label */}
                  <Box
                    sx={{
                      textAlign: 'center',
                      mt: 0.5,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                      color: 'text.secondary',
                    }}
                  >
                    Frequency →
                  </Box>
                </Box>
              </Stack>

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                Top-right = best customers (recent + frequent); bottom-left = lapsing.
              </Typography>
            </Box>
          ) : (
            <Empty label="No scored clients yet — RFM needs order history." />
          )}
        </Panel>

        {/* Segment summary */}
        <Panel
          title="Segments"
          subtitle="Client base grouped by RFM segment · by value"
          height="auto"
        >
          {segments.length ? (
            <Box>
              <Stack divider={<Divider />}>
                {segments.map((seg, i) => {
                  const c = rfmSegmentColor(theme, seg.segment);
                  const label = RFM_SEGMENT_LABELS[seg.segment] || seg.segment;
                  const share = totalSegValue > 0 ? ((Number(seg.total_value) || 0) / totalSegValue) * 100 : 0;
                  const recency = seg.avg_recency != null ? `${Math.round(Number(seg.avg_recency))}d` : '—';
                  const freq = `${(Number(seg.avg_frequency) || 0).toFixed(1)} orders`;
                  return (
                    <Box key={seg.segment || i} sx={{ py: 1.25 }}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: c, flexShrink: 0 }} />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                              {label}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {seg.count ?? 0} clients · {freq} · {recency}
                            </Typography>
                          </Box>
                        </Stack>
                        <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {inrCompact(seg.total_value)}
                        </Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(share, 100)}
                        sx={{
                          mt: 0.75,
                          height: 6,
                          borderRadius: 3,
                          bgcolor: 'action.hover',
                          '& .MuiLinearProgress-bar': { bgcolor: c },
                        }}
                      />
                    </Box>
                  );
                })}
              </Stack>
              <Button
                variant="text"
                size="small"
                startIcon={<PlaylistAddCheckRounded />}
                onClick={() => navigate('/crm/worklist')}
                sx={{ mt: 1, textTransform: 'none' }}
              >
                Work these accounts in the Daily Worklist
              </Button>
            </Box>
          ) : (
            <Empty label="No client analytics yet — RFM needs order history." />
          )}
        </Panel>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// TARGETS TAB
// ---------------------------------------------------------------------------
// Month helpers — pure JS Date math, no extra deps. A month is stored as a
// 'YYYY-MM-01' string in state; we step by parsing the parts, not by mutating a
// Date (avoids timezone drift on the day-of-month).
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function currentMonthStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

function stepMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  // m is 1-based; build a 0-based index, add delta, re-derive y/m.
  const idx = (y * 12 + (m - 1)) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

function monthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// Soft stepping caps relative to the current month: ~12 months back, ~3 forward.
function monthsFromNow(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const now = new Date();
  return (y * 12 + (m - 1)) - (now.getFullYear() * 12 + now.getMonth());
}

// Threshold accent for an achievement % — green ≥100, amber ≥70, red below.
function achievementColor(theme, pct) {
  const n = Number(pct) || 0;
  if (n >= 100) return theme.palette.success.main;
  if (n >= 70) return theme.palette.warning.main;
  return theme.palette.error.main;
}

function TargetEditDialog({ open, row, onClose, onSaved, month, theme }) {
  const [value, setValue] = useState('');
  const [newAccounts, setNewAccounts] = useState('');
  const [orders, setOrders] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (open && row) {
      setValue(row.target_value != null ? String(row.target_value) : '');
      setNewAccounts(row.target_new_accounts != null ? String(row.target_new_accounts) : '');
      setOrders(row.target_orders != null ? String(row.target_orders) : '');
      setNotes(row.notes || '');
      setErr(null);
    }
  }, [open, row]);

  const handleSave = async () => {
    if (!row) return;
    setSaving(true);
    setErr(null);
    try {
      await setRepTarget({
        ownerEmail: row.email,
        month,
        value: Number(value) || 0,
        newAccounts: Math.round(Number(newAccounts) || 0),
        orders: Math.round(Number(orders) || 0),
        notes: notes.trim() ? notes.trim() : null,
      });
      await onSaved();
      onClose();
    } catch (e) {
      setErr(e?.message || 'Could not save the target.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Set target
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 500 }}>
          {row ? `${row.full_name || row.email} · ${monthLabel(month)}` : ''}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {err && (
            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, borderColor: 'error.main', bgcolor: alpha(theme.palette.error.main, 0.06) }}>
              <Typography variant="body2" color="error">{err}</Typography>
            </Paper>
          )}
          <TextField
            label="Revenue target (₹)"
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            fullWidth
            size="small"
            inputProps={{ min: 0 }}
          />
          <TextField
            label="New clients target"
            type="number"
            value={newAccounts}
            onChange={(e) => setNewAccounts(e.target.value)}
            fullWidth
            size="small"
            inputProps={{ min: 0 }}
          />
          <TextField
            label="Orders target"
            type="number"
            value={orders}
            onChange={(e) => setOrders(e.target.value)}
            fullWidth
            size="small"
            inputProps={{ min: 0 }}
          />
          <TextField
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            fullWidth
            size="small"
            multiline
            minRows={2}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving} sx={{ textTransform: 'none', fontWeight: 700 }}>
          {saving ? 'Saving…' : 'Save target'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function TargetsTab({ seesAll, myEmail }) {
  const theme = useTheme();
  const [month, setMonth] = useState(currentMonthStr);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editRow, setEditRow] = useState(null);

  const load = async (mStr) => {
    setLoading(true);
    setError(null);
    try {
      const data = await repScorecard(mStr);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message || 'Could not load the scorecard.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await repScorecard(month);
        if (!alive) return;
        setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (alive) {
          setError(e?.message || 'Could not load the scorecard.');
          setRows([]);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [month]);

  const fromNow = monthsFromNow(month);
  const canGoBack = fromNow > -12;
  const canGoForward = fromNow < 3;

  const summary = useMemo(() => {
    const teamTarget = rows.reduce((s, r) => s + (Number(r.target_value) || 0), 0);
    const teamActual = rows.reduce((s, r) => s + (Number(r.actual_value) || 0), 0);
    const teamAch = teamTarget > 0 ? (teamActual / teamTarget) * 100 : null;
    const withTarget = rows.filter((r) => (Number(r.target_value) || 0) > 0 || r.achievement_pct != null);
    const onTarget = rows.filter((r) => r.achievement_pct != null && Number(r.achievement_pct) >= 100);
    return {
      teamTarget,
      teamActual,
      teamAch,
      onTargetCount: onTarget.length,
      withTargetCount: withTarget.length,
    };
  }, [rows]);

  const stepperHeader = (
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 2.5, flexWrap: 'wrap', gap: 1 }}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>Monthly Targets &amp; Scorecard</Typography>
        <Typography variant="caption" color="text.secondary">
          Revenue, conversions and orders vs target by rep.
        </Typography>
      </Box>
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.5}
        sx={{ border: 1, borderColor: 'divider', borderRadius: 2, px: 0.5, py: 0.25 }}
      >
        <IconButton
          size="small"
          aria-label="Previous month"
          disabled={!canGoBack || loading}
          onClick={() => setMonth((m) => stepMonth(m, -1))}
        >
          <ChevronLeftRounded />
        </IconButton>
        <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 132, textAlign: 'center' }}>
          {monthLabel(month)}
        </Typography>
        <IconButton
          size="small"
          aria-label="Next month"
          disabled={!canGoForward || loading}
          onClick={() => setMonth((m) => stepMonth(m, 1))}
        >
          <ChevronRightRounded />
        </IconButton>
      </Stack>
    </Stack>
  );

  if (loading) {
    return (
      <Box>
        {stepperHeader}
        <KpiSkeletons n={4} />
        <Skeleton variant="rounded" height={320} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        {stepperHeader}
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, borderColor: 'error.main', bgcolor: alpha(theme.palette.error.main, 0.06) }}>
          <Typography variant="subtitle2" color="error" sx={{ fontWeight: 700 }}>Couldn’t load targets</Typography>
          <Typography variant="body2" color="text.secondary">{error}</Typography>
        </Paper>
      </Box>
    );
  }

  const teamAchAccent = summary.teamAch == null ? theme.palette.text.secondary : achievementColor(theme, summary.teamAch);

  return (
    <Box>
      {stepperHeader}

      {/* Summary KPIs */}
      <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(2,1fr)', md: 'repeat(4,1fr)' } }}>
        <StatCard label="Team target" value={inrCompact(summary.teamTarget)} sub="Sum of rep targets" icon={FlagOutlined} accent={theme.palette.primary.main} />
        <StatCard label="Team actual" value={inrCompact(summary.teamActual)} sub="Booked this month" icon={PaidOutlined} accent={theme.palette.primary.dark} />
        <StatCard
          label="Team achievement"
          value={summary.teamAch == null ? '—' : `${Math.round(summary.teamAch)}%`}
          sub={summary.teamAch == null ? 'No targets set' : 'Actual ÷ target'}
          icon={TrendingUpRounded}
          accent={teamAchAccent}
        />
        <StatCard
          label="Reps on target"
          value={`${summary.onTargetCount}/${summary.withTargetCount}`}
          sub="≥100% of target"
          icon={EmojiEventsOutlined}
          accent={theme.palette.success.main}
        />
      </Box>

      {/* Scorecard table */}
      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Rep scorecard</Typography>
          <Typography variant="caption" color="text.secondary">
            {monthLabel(month)} · {seesAll ? 'all reps' : 'your standing'}
          </Typography>
        </Box>
        <Divider />
        {rows.length ? (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Rep</TableCell>
                  <TableCell sx={{ fontWeight: 700, minWidth: 180 }}>Revenue</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="center">Achievement</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="center">New clients</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="center">Orders</TableCell>
                  {seesAll && <TableCell sx={{ fontWeight: 700 }} align="right">Target</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => {
                  const hasTarget = (Number(r.target_value) || 0) > 0 || r.achievement_pct != null;
                  const pct = r.achievement_pct == null ? null : Number(r.achievement_pct);
                  const barPct = Math.min(100, pct || 0);
                  const accent = achievementColor(theme, pct);
                  const isMe = myEmail && r.email && String(r.email).toLowerCase() === String(myEmail).toLowerCase();
                  return (
                    <TableRow
                      key={r.email}
                      hover
                      sx={{
                        bgcolor: isMe ? alpha(theme.palette.primary.main, 0.07) : 'inherit',
                        opacity: hasTarget ? 1 : 0.62,
                      }}
                    >
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                          {r.full_name || ownerDisplay(r.email)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                          {[r.department, r.role].filter(Boolean).join(' · ') || r.email}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {hasTarget ? (
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {inrCompact(r.actual_value)} <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>/ {inrCompact(r.target_value)}</Box>
                            </Typography>
                            <LinearProgress
                              variant="determinate"
                              value={barPct}
                              sx={{ mt: 0.5, height: 6, borderRadius: 3, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { bgcolor: accent } }}
                            />
                          </Box>
                        ) : (
                          <Typography variant="body2" color="text.disabled">— no target</Typography>
                        )}
                      </TableCell>
                      <TableCell align="center">
                        {pct == null ? (
                          <Typography variant="body2" color="text.disabled">—</Typography>
                        ) : (
                          <Chip
                            label={`${Math.round(pct)}%`}
                            size="small"
                            sx={{ bgcolor: alpha(accent, 0.14), color: accent, fontWeight: 700 }}
                          />
                        )}
                      </TableCell>
                      <TableCell align="center">
                        <Typography variant="body2">
                          {Number(r.actual_new_accounts) || 0}
                          <Box component="span" sx={{ color: 'text.secondary' }}> / {Number(r.target_new_accounts) || 0}</Box>
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Typography variant="body2">
                          {Number(r.actual_orders) || 0}
                          <Box component="span" sx={{ color: 'text.secondary' }}> / {Number(r.target_orders) || 0}</Box>
                        </Typography>
                      </TableCell>
                      {seesAll && (
                        <TableCell align="right">
                          <Tooltip title="Edit target" arrow>
                            <IconButton size="small" onClick={() => setEditRow(r)} aria-label={`Edit target for ${r.full_name || r.email}`}>
                              <EditOutlined fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <Box sx={{ py: 6 }}>
            <Empty label="No reps found." />
          </Box>
        )}
      </Paper>

      {seesAll && (
        <TargetEditDialog
          open={Boolean(editRow)}
          row={editRow}
          month={month}
          theme={theme}
          onClose={() => setEditRow(null)}
          onSaved={() => load(month)}
        />
      )}
    </Box>
  );
}

export default function CRMDashboard({ data, loading }) {
  const theme = useTheme();
  const [tab, setTab] = useState('overview');
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
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setAnalyticsLoading(true);
    (async () => {
      try {
        const [rows, email] = await Promise.all([
          getCustomerAnalytics(),
          getCurrentUserEmail(),
        ]);
        if (!alive) return;
        setAnalytics(Array.isArray(rows) ? rows : []);
        setMyEmail(email || null);
      } finally {
        if (alive) setAnalyticsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const seesAll =
    hasFullAccess || ['CEO', 'SUPER_ADMIN', 'SUPERADMIN'].includes(String(roleCode || '').toUpperCase());

  // Owner scope for the RPC-backed RFM tab — reuse the SAME decision as the
  // reorder/retention section above: CEO/managers (seesAll) pass null for the
  // whole client base; a rep passes their own email.
  const ownerScope = seesAll ? null : myEmail;

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

  const TabsBar = (
    <Tabs
      value={tab}
      onChange={(_e, v) => setTab(v)}
      sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      textColor="primary"
      indicatorColor="primary"
    >
      <Tab value="overview" label="Overview" sx={{ fontWeight: 700, textTransform: 'none' }} />
      <Tab value="prospects" label="Prospects" sx={{ fontWeight: 700, textTransform: 'none' }} />
      <Tab value="clients" label="Clients" sx={{ fontWeight: 700, textTransform: 'none' }} />
      <Tab value="rfm" label="RFM & Retention" sx={{ fontWeight: 700, textTransform: 'none' }} />
      <Tab value="targets" label="Targets" sx={{ fontWeight: 700, textTransform: 'none' }} />
    </Tabs>
  );

  if (tab === 'prospects') {
    return (
      <Box>
        {TabsBar}
        <ProspectsTab />
      </Box>
    );
  }

  if (tab === 'clients') {
    return (
      <Box>
        {TabsBar}
        <ClientsTab ownerScope={ownerScope} />
      </Box>
    );
  }

  if (tab === 'rfm') {
    return (
      <Box>
        {TabsBar}
        <RfmTab ownerScope={ownerScope} />
      </Box>
    );
  }

  if (tab === 'targets') {
    return (
      <Box>
        {TabsBar}
        <TargetsTab seesAll={seesAll} myEmail={myEmail} />
      </Box>
    );
  }

  if (loading && !data) {
    return (
      <Box>
        {TabsBar}
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,1fr)', lg: 'repeat(4,1fr)' } }}>
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} variant="rounded" height={96} />
          ))}
        </Box>
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
      {TabsBar}
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

        {analyticsLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 6, gap: 1.5, color: 'text.secondary' }}>
            <CircularProgress size={22} />
            <Typography variant="body2">Loading reorder &amp; retention analytics…</Typography>
          </Box>
        ) : (
          <>
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
          </>
        )}
      </Box>
    </Box>
  );
}
