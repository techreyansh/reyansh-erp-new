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
  PaymentsOutlined,
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
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { usePermissions } from "../context/PermissionContext";
import LoadingScreen from "../components/common/LoadingScreen";
import AccessDenied from "../components/auth/AccessDenied";
import { getExecutiveSummary } from "../services/executiveDashboardService";
import { listMyTasks, isTaskOverdue } from "../services/taskService";
import { StatCard, Panel, EmptyChart, CHART_COLORS, inrCompact } from "../components/common/kit";
import MyFollowups from "../components/dashboard/MyFollowups";
import MyDayDashboard from "../components/dashboard/MyDayDashboard";
import HomeWaWidget from "../components/whatsappMarketing/HomeWaWidget";

// Modules most relevant to each department — used to surface a person's own
// workspace first on the role-aware home.
const DEPT_MODULES = {
  Sales: ["sales", "crm", "tasks"],
  CRM: ["crm", "sales", "tasks"],
  Production: ["production", "inventory", "dispatch", "tasks"],
  Inventory: ["inventory", "dispatch", "tasks"],
  Accounts: ["accounts", "reports", "tasks"],
  Dispatch: ["dispatch", "inventory", "tasks"],
  HR: ["employees", "tasks", "reports"],
  Management: ["crm", "sales", "production", "inventory", "dispatch", "reports", "tasks"],
};

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

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

// Classify a user into a dashboard variant from their actual module
// permissions, so each role lands on a relevant home — not a generic
// CEO-style revenue view. Order matters: most specific wins.
function getAccessBucket(permissions) {
  const canSee = (key) =>
    permissions.canView?.(key) || permissions.canEdit?.(key);

  if (permissions.hasFullAccess) return "full";
  // Sales / CRM reps — show sales-relevant analytics (top customers, orders).
  if (canSee("crm") || canSee("sales")) return "sales";
  // Store managers / inventory — lighter, no company revenue charts.
  if (canSee("inventory")) return "inventory";
  // Process coordinators / production — lighter, no company revenue charts.
  if (permissions.canView?.("production")) return "production";
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

const COLLECTIONS_PATH = "/crm/collections";

/** Short, human due-date label for a collections row. */
function formatDueDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

/**
 * "Overdue & due payments" — surfaces outstanding AR straight on the home page
 * for the CEO and Sales/CRM reps so collections don't slip. Fetches once on
 * mount via the `ar_collections` RPC; degrades to an empty/clean state on error.
 *
 * @param {string|null} ownerEmail  null → all owners (CEO); else this rep's own.
 */
function CollectionsPanel({ ownerEmail }) {
  const theme = useTheme();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null); // null = loading
  const MAX_ROWS = 6;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("ar_collections", { p_owner: ownerEmail });
        if (error) throw error;
        if (active) setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        // Degrade silently — show a clean empty state rather than break the home.
        if (active) setRows([]);
      }
    })();
    return () => {
      active = false;
    };
    // ownerEmail is the only input; fetch once per owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerEmail]);

  const openCollections = () => navigate(COLLECTIONS_PATH);

  const loading = rows === null;
  const list = rows || [];
  const visible = list.slice(0, MAX_ROWS);
  const extra = Math.max(0, list.length - visible.length);

  return (
    <Paper
      variant="outlined"
      sx={{ borderRadius: 2.5, p: { xs: 1.5, sm: 2 }, height: "100%", display: "flex", flexDirection: "column" }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <PaymentsOutlined sx={{ fontSize: 20, color: "primary.main" }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Overdue &amp; due payments
          </Typography>
          {!loading && list.length > 0 && (
            <Chip
              label={list.length}
              size="small"
              sx={{
                height: 20,
                fontWeight: 700,
                fontSize: "0.65rem",
                color: "primary.main",
                bgcolor: alpha(theme.palette.primary.main, 0.12),
              }}
            />
          )}
        </Stack>
        <Typography
          variant="caption"
          onClick={openCollections}
          sx={{ color: "primary.main", fontWeight: 700, cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
        >
          Open collections
        </Typography>
      </Stack>

      {loading ? (
        <Stack spacing={1} sx={{ px: 1.25 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rounded" height={36} />
          ))}
        </Stack>
      ) : list.length === 0 ? (
        <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", py: 3, px: 2 }}>
          <Typography variant="body2" sx={{ color: "success.main", textAlign: "center", fontWeight: 600 }}>
            No overdue payments — collections are clean.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={0.25}>
          {visible.map((r) => {
            const overdue = Number(r.days_past_due) > 0;
            return (
              <Box
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={openCollections}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openCollections();
                  }
                }}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 1,
                  px: 1.25,
                  py: 0.9,
                  borderRadius: 1.5,
                  cursor: "pointer",
                  transition: "background-color 0.15s ease",
                  "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.08) },
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0 }} noWrap>
                    {r.customer_name || "—"}
                  </Typography>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25 }}>
                    <Typography variant="caption" color="text.secondary">
                      {inrCompact(r.balance)}
                    </Typography>
                    {r.due_date && (
                      <Typography variant="caption" color="text.secondary">
                        {" · due "}
                        {formatDueDate(r.due_date)}
                      </Typography>
                    )}
                  </Stack>
                </Box>
                <Chip
                  label={overdue ? `${r.days_past_due}d overdue` : "due"}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: "0.62rem",
                    fontWeight: 700,
                    flexShrink: 0,
                    color: overdue ? "error.main" : "text.secondary",
                    bgcolor: overdue ? alpha(theme.palette.error.main, 0.12) : "action.hover",
                  }}
                />
              </Box>
            );
          })}
          {extra > 0 && (
            <Typography
              variant="caption"
              onClick={openCollections}
              sx={{
                px: 1.25,
                pt: 0.5,
                color: "text.secondary",
                cursor: "pointer",
                "&:hover": { color: "primary.main", textDecoration: "underline" },
              }}
            >
              +{extra} more
            </Typography>
          )}
        </Stack>
      )}
    </Paper>
  );
}

function WelcomePage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const permissions = usePermissions();
  const [now, setNow] = useState(() => new Date());
  const [data, setData] = useState(null);
  const [myTasks, setMyTasks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const accessBucket = getAccessBucket(permissions);
  // Full executive analytics (revenue trend + dept snapshot) — CEO only.
  const showExecAnalytics = accessBucket === "full";
  // Sales-relevant analytics (orders pipeline + top customers) — CEO + sales.
  const showSalesAnalytics = accessBucket === "full" || accessBucket === "sales";
  // Anything that needs the executive summary fetched.
  const needsSummary = showExecAnalytics || showSalesAnalytics;
  // Collections reminder — CEO + Sales/CRM only (kept off lighter views).
  const showCollections = accessBucket === "full" || accessBucket === "sales";
  // CEO/super-admin see all outstanding AR (null owner); reps see only theirs.
  const collectionsOwner = accessBucket === "full" ? null : user?.email || "";

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      if (needsSummary) {
        const summary = await getExecutiveSummary();
        setData(summary);
      } else if (user?.email) {
        // Lighter buckets (inventory/production/employee) — real task KPIs.
        const tasks = await listMyTasks(user.email);
        setMyTasks(tasks);
      }
    } catch (e) {
      // degrade silently — page still renders quick actions
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [needsSummary, user]);

  useEffect(() => {
    load();
    const clock = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(clock);
  }, [load]);

  const displayName = getDisplayName(user);
  const roleLabel = permissions.role?.role_name || role || user?.roleCode || "Employee";
  const department = permissions.employee?.department || "";

  // Filter by access, then surface the person's own department modules first.
  const actions = useMemo(() => {
    const visible = allActions.filter((a) => {
      if (a.requireCreate) return permissions.canCreate?.(a.key);
      if (a.requireEdit) return permissions.canEdit?.(a.key);
      return permissions.canView?.(a.key);
    });

    // Decide which modules to highlight as "your area". Prefer the mapped
    // department modules; if the department is missing/unknown, fall back to
    // the modules the user actually has access to — not literally everything.
    let deptModules = DEPT_MODULES[department];
    if (!deptModules) {
      if (department) {
        console.warn(
          `[WelcomePage] Unknown department "${department}" — no DEPT_MODULES mapping; highlighting accessible modules instead.`
        );
      } else {
        console.warn(
          "[WelcomePage] Missing employee department — highlighting accessible modules instead of a default set."
        );
      }
      deptModules = visible.map((a) => a.key);
    }

    return visible
      .map((a) => ({ ...a, primary: deptModules.includes(a.key) }))
      .sort((x, y) => Number(y.primary) - Number(x.primary));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissions, department]);

  // Real task KPIs for the employee bucket.
  const taskKpis = useMemo(() => {
    const list = myTasks || [];
    const today = new Date();
    const isDone = (t) => String(t.task_status || "").toLowerCase() === "completed";
    const dueToday = list.filter((t) => t.due_date && isSameDay(new Date(t.due_date), today) && !isDone(t)).length;
    const pending = list.filter((t) => !isDone(t)).length;
    const completed = list.filter(isDone).length;
    const overdue = list.filter((t) => isTaskOverdue(t)).length;
    return { dueToday, pending, completed, overdue };
  }, [myTasks]);

  const k = data?.kpis || {};
  const mtdRevenue = data?.revenueTrend?.length ? data.revenueTrend[data.revenueTrend.length - 1].collected : 0;

  const kpiCards = useMemo(() => {
    if (showExecAnalytics) {
      // CEO — full financial + pipeline view.
      return [
        { label: "Revenue (This Month)", value: inrCompact(mtdRevenue), icon: PaidOutlined, accent: theme.palette.primary.main, path: "/dashboard" },
        { label: "Order Book", value: inrCompact(k.orderBook), icon: ReceiptLongOutlined, accent: theme.palette.primary.dark, path: "/crm/sales-orders" },
        { label: "Outstanding", value: inrCompact(k.outstanding), icon: AccountBalanceWalletOutlined, accent: theme.palette.warning.main, path: "/crm/collections" },
        { label: "Pending Dispatch", value: k.pendingDispatch ?? 0, sub: `${k.dispatchTotal ?? 0} total`, icon: LocalShippingOutlined, accent: theme.palette.primary.main, path: "/dispatch-management" },
        { label: "Active Leads", value: k.activeLeads ?? 0, sub: `${k.team ?? 0} team`, icon: GroupsOutlined, accent: "#DB2777", path: "/crm/follow-ups" },
        { label: "Active Clients", value: k.clients ?? 0, sub: `${k.prospects ?? 0} prospects`, icon: ContactMailOutlined, accent: theme.palette.success.main, path: "/clients" },
      ];
    }
    if (showSalesAnalytics) {
      // Sales / CRM reps — pipeline-focused, no company financials.
      return [
        { label: "Order Book", value: inrCompact(k.orderBook), icon: ReceiptLongOutlined, accent: theme.palette.primary.dark, path: "/crm/sales-orders" },
        { label: "Active Leads", value: k.activeLeads ?? 0, sub: `${k.team ?? 0} team`, icon: GroupsOutlined, accent: "#DB2777", path: "/crm/follow-ups" },
        { label: "Active Clients", value: k.clients ?? 0, sub: `${k.prospects ?? 0} prospects`, icon: ContactMailOutlined, accent: theme.palette.success.main, path: "/clients" },
        { label: "Pending Dispatch", value: k.pendingDispatch ?? 0, sub: `${k.dispatchTotal ?? 0} total`, icon: LocalShippingOutlined, accent: theme.palette.primary.main, path: "/dispatch-management" },
      ];
    }
    return [
      { label: "Due Today", value: taskKpis.dueToday, sub: "Assigned to you", icon: ChecklistOutlined, accent: theme.palette.primary.dark, path: "/my-tasks" },
      { label: "Pending", value: taskKpis.pending, sub: "Need action", icon: AssignmentTurnedInOutlined, accent: theme.palette.warning.main, path: "/my-tasks" },
      { label: "Completed", value: taskKpis.completed, sub: "All time", icon: TrendingUpOutlined, accent: theme.palette.success.main, path: "/my-tasks" },
      { label: "Overdue", value: taskKpis.overdue, sub: "Past due date", icon: BarChartOutlined, accent: taskKpis.overdue > 0 ? theme.palette.error.main : theme.palette.primary.main, path: "/my-tasks" },
    ];
  }, [showExecAnalytics, showSalesAnalytics, mtdRevenue, k, taskKpis, theme]);

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
          color: "common.white",
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
                <Chip label={roleLabel} size="small" sx={{ bgcolor: "rgba(255,255,255,0.22)", color: "common.white", fontWeight: 700 }} />
              </Stack>
              <Typography variant="body1" sx={{ opacity: 0.9, maxWidth: 560 }}>
                {needsSummary
                  ? "Welcome to your ERP command center. Review priorities, then jump into the module you need."
                  : `Here's your workspace${department ? ` for ${department}` : ""}. ${taskKpis.pending} task${taskKpis.pending === 1 ? "" : "s"} need your attention${taskKpis.overdue > 0 ? `, ${taskKpis.overdue} overdue` : ""}.`}
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
              {needsSummary && (
                <Tooltip title="Refresh">
                  <span>
                    <IconButton onClick={() => load(true)} disabled={refreshing} sx={{ color: "common.white", bgcolor: "rgba(255,255,255,0.18)", "&:hover": { bgcolor: "rgba(255,255,255,0.3)" } }}>
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
        {/* My Day — live personal dashboard (score + tasks + checklists).
            Sits at the very top so every user lands on what they need to do. */}
        <Box sx={{ mb: 3 }}>
          <MyDayDashboard email={user?.email} />
        </Box>

        {/* KPI strip */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {kpiCards.map((c) => (
            <Grid item xs={6} sm={4} md={showExecAnalytics ? 2 : 3} key={c.label}>
              <StatCard {...c} loading={loading} onClick={c.path ? () => navigate(c.path) : undefined} />
            </Grid>
          ))}
        </Grid>

        {/* My Follow-ups — CRM next-actions, visible without opening the CRM.
            Self-empties if nothing is scheduled, so it's safe to always render.
            Paired with the Collections reminder for CEO + Sales/CRM. */}
        <Grid container spacing={2} sx={{ mb: 3 }} alignItems="stretch">
          <Grid item xs={12} md={showCollections ? 7 : 12}>
            <MyFollowups email={user?.email} />
          </Grid>
          {showCollections && (
            <Grid item xs={12} md={5}>
              <CollectionsPanel ownerEmail={collectionsOwner} />
            </Grid>
          )}
        </Grid>

        {/* WhatsApp Marketing at-a-glance — marketing-view roles only (CEO,
            MARKETING_SCOPED, Admin). Gated directly by the `marketing` module
            permission rather than the accessBucket heuristic above, since
            marketing is its own RBAC module key independent of CRM/sales. */}
        {permissions.canView?.('marketing') && (
          <Box sx={{ mb: 3 }}>
            <HomeWaWidget />
          </Box>
        )}

        {/* Executive analytics — revenue + department health (CEO only) */}
        {showExecAnalytics && (
          <>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} md={7}>
                <Panel title="Revenue Trend" subtitle="Ordered vs Collected · last 12 months" height={280}>
                  {data?.revenueTrend?.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.revenueTrend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                        <defs>
                          <linearGradient id="wOrd" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={theme.palette.primary.main} stopOpacity={0.35} />
                            <stop offset="95%" stopColor={theme.palette.primary.main} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="wCol" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={theme.palette.primary.dark} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={theme.palette.primary.dark} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={alpha(theme.palette.text.primary, 0.06)} />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis tickFormatter={inrCompact} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={66} />
                        <RTooltip formatter={(v) => inrCompact(v)} />
                        <Area type="monotone" dataKey="ordered" stroke={theme.palette.primary.main} strokeWidth={2.5} fill="url(#wOrd)" name="Ordered" />
                        <Area type="monotone" dataKey="collected" stroke={theme.palette.primary.dark} strokeWidth={2.5} fill="url(#wCol)" name="Collected" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (loading ? <Skeleton variant="rounded" height="100%" /> : <EmptyChart label="No revenue data yet" />)}
                </Panel>
              </Grid>
              <Grid item xs={12} md={5}>
                <Panel title="Department Snapshot" subtitle="Activity & workforce across the business" height={280}>
                  {departments.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={departments.map((d) => ({ name: d.name, value: Number(d.metric) || 0 }))} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={alpha(theme.palette.text.primary, 0.06)} />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <RTooltip cursor={{ fill: alpha(theme.palette.primary.main, 0.06) }} />
                        <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={38}>
                          {departments.map((d, i) => <Cell key={d.key} fill={d.health === "warn" ? theme.palette.warning.main : CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (loading ? <Skeleton variant="rounded" height="100%" /> : <EmptyChart />)}
                </Panel>
              </Grid>
            </Grid>
          </>
        )}

        {/* Sales analytics — order pipeline + top customers (CEO + sales/CRM) */}
        {showSalesAnalytics && (
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} md={7}>
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
            <Grid item xs={12} md={5}>
              <Panel title="Top Customers" subtitle="By order value" height={280}>
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
        )}

        {/* Quick Actions */}
        <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1.5} sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: "-0.02em" }}>Quick Actions</Typography>
            <Typography variant="body2" color="text.secondary">Jump into a module in one click.</Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={() => navigate("/task-checklist")}>Go to Tasks</Button>
            {showExecAnalytics && <Button variant="outlined" onClick={() => navigate("/dashboard")}>Open Dashboard</Button>}
          </Stack>
        </Stack>

        <Grid container spacing={2}>
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Grid item xs={6} sm={4} md={3} key={`${action.key}-${action.title}`}>
                <Card variant="outlined" sx={{ height: "100%", borderColor: action.primary ? "primary.main" : "divider", bgcolor: action.primary ? alpha(theme.palette.primary.main, 0.04) : "background.paper" }}>
                  <CardActionArea onClick={() => navigate(action.path)} sx={{ height: "100%", alignItems: "stretch" }}>
                    <CardContent sx={{ height: "100%" }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                        <Box sx={{ width: 42, height: 42, borderRadius: 1.5, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: alpha(theme.palette.primary.main, 0.1), mb: 1.5 }}>
                          <Icon sx={{ color: "primary.main" }} />
                        </Box>
                        {action.primary && <Chip size="small" color="primary" label="Your area" sx={{ height: 20, fontSize: 10, fontWeight: 700 }} />}
                      </Stack>
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
