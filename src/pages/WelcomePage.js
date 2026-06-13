import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
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
} from "@mui/material";
import {
  AccountBalanceWalletOutlined,
  AssignmentTurnedInOutlined,
  BarChartOutlined,
  ChecklistOutlined,
  ContactMailOutlined,
  FactoryOutlined,
  GroupsOutlined,
  HomeRepairServiceOutlined,
  Inventory2Outlined,
  LocalShippingOutlined,
  NotificationsActiveOutlined,
  PaidOutlined,
  ReceiptLongOutlined,
  RefreshRounded,
  TrendingUpOutlined,
} from "@mui/icons-material";
import {
  Area,
  AreaChart,
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
} from "recharts";
import { useAuth } from "../context/AuthContext";
import { usePermissions } from "../context/PermissionContext";
import LoadingScreen from "../components/common/LoadingScreen";
import AccessDenied from "../components/auth/AccessDenied";
import { getExecutiveSummary } from "../services/executiveDashboardService";
import { StatCard, Panel, EmptyChart, CHART_COLORS, inrCompact } from "../components/common/kit";

function getDisplayName(user) {
  if (user?.name) return user.name;
  const emailName = user?.email?.split("@")?.[0];
  if (!emailName) return "there";
  return emailName.split(/[._-]/).filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

function getGreeting(date) {
  const hour = date.getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

function getAccessBucket(permissions) {
  if (permissions.hasFullAccess) return "full";
  if (permissions.canCreate("tasks") || permissions.canEdit("tasks") ||
      permissions.canCreate("employees") || permissions.canEdit("employees")) return "manager";
  return "employee";
}

const allActions = [
  { key: "crm", title: "CRM", description: "Leads, customers, follow-ups and sales pipeline.", path: "/crm/dashboard", icon: ContactMailOutlined },
  { key: "production", title: "PPC", description: "Production planning, work orders and dispatch readiness.", path: "/ppc/production-plan", icon: FactoryOutlined },
  { key: "inventory", title: "Inventory", description: "Stock, inward, outward and material availability.", path: "/inventory", icon: Inventory2Outlined },
  { key: "sales", title: "Sales", description: "Sales workflow, quotations and order progress.", path: "/sales-flow", icon: ReceiptLongOutlined },
  { key: "dispatch", title: "Dispatch", description: "Plan and track shipments to customers.", path: "/dispatch-management", icon: LocalShippingOutlined },
  { key: "employees", title: "Employees", description: "Workforce records, profiles and department details.", path: "/employee-dashboard", icon: HomeRepairServiceOutlined },
  { key: "tasks", title: "Team Tasks", description: "View, filter, edit and reassign all team tasks.", path: "/team-tasks", icon: AssignmentTurnedInOutlined, requireEdit: true },
  { key: "tasks", title: "My Tasks", description: "Your assigned tasks — update status when complete.", path: "/my-tasks", icon: ChecklistOutlined },
  { key: "reports", title: "Reports", description: "Operational snapshots and performance summaries.", path: "/ppc/reports", icon: BarChartOutlined },
];

function WelcomePage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const permissions = usePermissions();
  const [now, setNow] = useState(() => new Date());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const accessBucket = getAccessBucket(permissions);
  const showAnalytics = accessBucket !== "employee";

  const load = useCallback(async (isRefresh = false) => {
    if (!showAnalytics) { setLoading(false); return; }
    if (isRefresh) setRefreshing(true);
    try {
      const summary = await getExecutiveSummary();
      setData(summary);
    } catch (e) {
      // degrade silently — page still renders quick actions
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showAnalytics]);

  useEffect(() => {
    load();
    const clock = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(clock);
  }, [load]);

  const displayName = getDisplayName(user);
  const roleLabel = permissions.role?.role_name || role || user?.roleCode || "Employee";
  const actions = allActions.filter((a) => {
    if (a.requireCreate) return permissions.canCreate?.(a.key);
    if (a.requireEdit) return permissions.canEdit?.(a.key);
    return permissions.canView?.(a.key);
  });

  const k = data?.kpis || {};
  const mtdRevenue = data?.revenueTrend?.length ? data.revenueTrend[data.revenueTrend.length - 1].collected : 0;

  const kpiCards = useMemo(() => {
    if (showAnalytics) {
      return [
        { label: "Revenue (This Month)", value: inrCompact(mtdRevenue), icon: PaidOutlined, accent: "#45ADE6", path: "/dashboard" },
        { label: "Order Book", value: inrCompact(k.orderBook), icon: ReceiptLongOutlined, accent: "#1E7DBE", path: "/crm/sales-orders" },
        { label: "Outstanding", value: inrCompact(k.outstanding), icon: AccountBalanceWalletOutlined, accent: "#D97706", path: "/crm/collections" },
        { label: "Pending Dispatch", value: k.pendingDispatch ?? 0, sub: `${k.dispatchTotal ?? 0} total`, icon: LocalShippingOutlined, accent: "#7C3AED", path: "/dispatch-management" },
        { label: "Active Leads", value: k.activeLeads ?? 0, sub: `${k.team ?? 0} team`, icon: GroupsOutlined, accent: "#DB2777", path: "/crm/follow-ups" },
        { label: "Active Clients", value: k.clients ?? 0, sub: `${k.prospects ?? 0} prospects`, icon: ContactMailOutlined, accent: "#059669", path: "/clients" },
      ];
    }
    return [
      { label: "Today's Tasks", value: "—", sub: "Assigned to you", icon: ChecklistOutlined, accent: "#1E7DBE", path: "/task-checklist" },
      { label: "Pending", value: "—", sub: "Need action", icon: AssignmentTurnedInOutlined, accent: "#D97706", path: "/my-tasks" },
      { label: "Completed", value: "—", sub: "This shift", icon: TrendingUpOutlined, accent: "#059669", path: "/my-tasks" },
      { label: "Compliance", value: "—", sub: "Current score", icon: BarChartOutlined, accent: "#7C3AED", path: "/task-checklist" },
    ];
  }, [showAnalytics, mtdRevenue, k]);

  if (permissions.loading) return <LoadingScreen message="Loading dashboard…" />;
  if (!permissions.authorized || !permissions.employee) return <AccessDenied />;

  const ordersByStatus = (data?.ordersByStatus || []).filter((x) => x.value > 0);
  const dispatchByStatus = (data?.dispatchByStatus || []).filter((x) => x.value > 0);
  const departments = data?.departments || [];

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", pb: 6 }}>
      {/* Hero */}
      <Box
        sx={{
          background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 55%, ${theme.palette.primary.light} 120%)`,
          color: "#fff",
          px: { xs: 2, sm: 3 },
          py: { xs: 3, md: 4 },
        }}
      >
        <Container maxWidth="xl" disableGutters>
          <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }} gap={2}>
            <Box>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, flexWrap: "wrap" }}>
                <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: "-0.03em", fontSize: { xs: "1.6rem", md: "2rem" } }}>
                  {getGreeting(now)}, {displayName.split(" ")[0]}
                </Typography>
                <Chip label={roleLabel} size="small" sx={{ bgcolor: "rgba(255,255,255,0.22)", color: "#fff", fontWeight: 700 }} />
              </Stack>
              <Typography variant="body1" sx={{ opacity: 0.9, maxWidth: 560 }}>
                Welcome to your ERP command center. Review priorities, then jump into the module you need.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box sx={{ textAlign: "right" }}>
                <Typography variant="caption" sx={{ opacity: 0.85, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em", display: "block" }}>
                  {refreshing ? "Refreshing…" : "Current time"}
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {now.toLocaleString(undefined, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </Typography>
              </Box>
              {showAnalytics && (
                <Tooltip title="Refresh">
                  <span>
                    <IconButton onClick={() => load(true)} disabled={refreshing} sx={{ color: "#fff", bgcolor: "rgba(255,255,255,0.18)", "&:hover": { bgcolor: "rgba(255,255,255,0.3)" } }}>
                      <RefreshRounded />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
            </Stack>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ px: { xs: 2, sm: 3 }, mt: -3 }}>
        {/* KPI strip */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {kpiCards.map((c) => (
            <Grid item xs={6} sm={4} md={showAnalytics ? 2 : 3} key={c.label}>
              <StatCard {...c} loading={loading} onClick={c.path ? () => navigate(c.path) : undefined} />
            </Grid>
          ))}
        </Grid>

        {/* Analytics (managers + CEO) */}
        {showAnalytics && (
          <>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} md={7}>
                <Panel title="Revenue Trend" subtitle="Ordered vs Collected · last 12 months" height={280}>
                  {data?.revenueTrend?.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.revenueTrend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                        <defs>
                          <linearGradient id="wOrd" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#45ADE6" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#45ADE6" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="wCol" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#1E7DBE" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#1E7DBE" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={alpha(theme.palette.text.primary, 0.06)} />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis tickFormatter={inrCompact} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={66} />
                        <RTooltip formatter={(v) => inrCompact(v)} />
                        <Area type="monotone" dataKey="ordered" stroke="#45ADE6" strokeWidth={2.5} fill="url(#wOrd)" name="Ordered" />
                        <Area type="monotone" dataKey="collected" stroke="#1E7DBE" strokeWidth={2.5} fill="url(#wCol)" name="Collected" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (loading ? <Skeleton variant="rounded" height="100%" /> : <EmptyChart label="No revenue data yet" />)}
                </Panel>
              </Grid>
              <Grid item xs={12} md={5}>
                <Panel title="Orders by Status" subtitle="Live order pipeline" height={280}>
                  {ordersByStatus.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={ordersByStatus} dataKey="value" nameKey="name" innerRadius={55} outerRadius={92} paddingAngle={2}>
                          {ordersByStatus.map((e, i) => <Cell key={e.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Pie>
                        <RTooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (loading ? <Skeleton variant="rounded" height="100%" /> : <EmptyChart label="No orders yet" />)}
                </Panel>
              </Grid>
            </Grid>

            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={7}>
                <Panel title="Department Snapshot" subtitle="Activity & workforce across the business" height={260}>
                  {departments.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={departments.map((d) => ({ name: d.name, value: Number(d.metric) || 0 }))} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={alpha(theme.palette.text.primary, 0.06)} />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <RTooltip cursor={{ fill: alpha(theme.palette.primary.main, 0.06) }} />
                        <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={38}>
                          {departments.map((d, i) => <Cell key={d.key} fill={d.health === "warn" ? "#D97706" : CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (loading ? <Skeleton variant="rounded" height="100%" /> : <EmptyChart />)}
                </Panel>
              </Grid>
              <Grid item xs={12} md={5}>
                <Panel title="Top Customers" subtitle="By order value" height={260}>
                  {data?.topCustomers?.length ? (
                    <Stack spacing={1.25} sx={{ height: "100%", overflowY: "auto", pr: 0.5 }}>
                      {data.topCustomers.map((c, i) => {
                        const max = data.topCustomers[0]?.value || 1;
                        return (
                          <Box key={c.name}>
                            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                              <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: "62%" }}>{i + 1}. {c.name}</Typography>
                              <Typography variant="body2" fontWeight={700}>{inrCompact(c.value)}</Typography>
                            </Stack>
                            <Box sx={{ height: 6, borderRadius: 1, bgcolor: alpha(theme.palette.text.primary, 0.06), overflow: "hidden" }}>
                              <Box sx={{ height: "100%", width: `${(c.value / max) * 100}%`, borderRadius: 1, bgcolor: CHART_COLORS[i % CHART_COLORS.length] }} />
                            </Box>
                          </Box>
                        );
                      })}
                    </Stack>
                  ) : (loading ? <Skeleton variant="rounded" height="100%" /> : <EmptyChart label="No customer revenue yet" />)}
                </Panel>
              </Grid>
            </Grid>
          </>
        )}

        {/* Quick Actions */}
        <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1.5} sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: "-0.02em" }}>Quick Actions</Typography>
            <Typography variant="body2" color="text.secondary">Jump into a module in one click.</Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={() => navigate("/task-checklist")}>Go to Tasks</Button>
            {showAnalytics && <Button variant="outlined" onClick={() => navigate("/dashboard")}>Open Dashboard</Button>}
          </Stack>
        </Stack>

        <Grid container spacing={2}>
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Grid item xs={6} sm={4} md={3} key={`${action.key}-${action.title}`}>
                <Card variant="outlined" sx={{ height: "100%" }}>
                  <CardActionArea onClick={() => navigate(action.path)} sx={{ height: "100%", alignItems: "stretch" }}>
                    <CardContent sx={{ height: "100%" }}>
                      <Box sx={{ width: 42, height: 42, borderRadius: 1.5, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: alpha(theme.palette.primary.main, 0.1), mb: 1.5 }}>
                        <Icon sx={{ color: "primary.main" }} />
                      </Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{action.title}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{action.description}</Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      </Container>
    </Box>
  );
}

export default WelcomePage;
