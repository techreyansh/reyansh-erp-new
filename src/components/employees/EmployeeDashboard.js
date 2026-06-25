import React, { useMemo } from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Skeleton,
  Stack,
  Typography,
  alpha,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  AddRounded,
  ArrowForwardRounded,
  ApartmentRounded,
  BadgeOutlined,
  CheckCircleOutlineRounded,
  EventAvailableRounded,
  FileDownloadOutlined,
  FileUploadOutlined,
  GroupsOutlined,
  HourglassEmptyRounded,
  PendingActionsRounded,
  PersonAddAlt1Rounded,
  VpnKeyOutlined,
} from '@mui/icons-material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { StatCard, Panel, EmptyChart, CHART_COLORS, SEMANTIC } from '../common/kit';

/* ---------------------------------------------------------------- helpers */

/** Defensive date parse — accepts ISO, dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd. Returns Date | null. */
function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const str = String(value).trim();
  if (!str) return null;
  // Native parse first (handles ISO + yyyy-mm-dd).
  const native = new Date(str);
  if (!isNaN(native.getTime())) return native;
  // dd/mm/yyyy or dd-mm-yyyy
  const m = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = `20${y}`;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d));
    if (!isNaN(dt.getTime())) return dt;
  }
  return null;
}

/** "X ago" relative label. */
function timeAgo(date) {
  if (!date) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 0) return 'upcoming';
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diff / day);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/** Two-letter initials from a name (or email fallback). */
function initials(emp) {
  const name = (emp?.full_name || '').trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase();
  }
  const email = (emp?.email || '').trim();
  return email ? email.slice(0, 2).toUpperCase() : '??';
}

/** Stable accent color per employee for avatars. */
function avatarColor(emp, i) {
  const key = String(emp?.id ?? emp?.employee_code ?? emp?.email ?? i);
  let hash = 0;
  for (let c = 0; c < key.length; c += 1) hash = (hash * 31 + key.charCodeAt(c)) >>> 0;
  return CHART_COLORS[hash % CHART_COLORS.length];
}

const isActiveEmp = (e) =>
  e?.is_active === true ||
  /^active$/i.test(String(e?.status || '').trim());

const isOnLeave = (e) => /^(on\s*leave|leave)$/i.test(String(e?.status || '').trim());

const hasNoAccess = (e) =>
  (e?.moduleCount != null && Number(e.moduleCount) === 0) ||
  (isActiveEmp(e) && (e?.role_id == null || e?.role_id === ''));

const missingManager = (e) => {
  const m = e?.reporting_manager;
  return m == null || String(m).trim() === '';
};

/* ----------------------------------------------------------------- view */

export default function EmployeeDashboard({
  employees = [],
  loading,
  onOpenEmployee,
  onAddEmployee,
  onImport,
  onAssignAccess,
  onExport,
}) {
  const theme = useTheme();
  const list = Array.isArray(employees) ? employees : [];
  const axis = { fontSize: 12, fill: theme.palette.text.secondary };
  const grid = theme.palette.divider;

  /* --------- KPIs --------- */
  const kpis = useMemo(() => {
    const now = new Date();
    const curMonth = now.getMonth();
    const curYear = now.getFullYear();

    let active = 0;
    let onLeave = 0;
    let newJoiners = 0;
    const departments = new Set();

    list.forEach((e) => {
      if (isActiveEmp(e)) active += 1;
      if (isOnLeave(e)) onLeave += 1;
      const dept = (e?.department || '').trim();
      if (dept) departments.add(dept.toLowerCase());
      const jd = parseDate(e?.joining_date);
      if (jd && jd.getMonth() === curMonth && jd.getFullYear() === curYear) newJoiners += 1;
    });

    return {
      total: list.length,
      active,
      onLeave,
      newJoiners,
      departments: departments.size,
      pendingApprovals: 0, // placeholder / future
    };
  }, [list]);

  /* --------- Headcount by department --------- */
  const deptData = useMemo(() => {
    const counts = new Map();
    list.forEach((e) => {
      const dept = (e?.department || '').trim() || 'Unassigned';
      counts.set(dept, (counts.get(dept) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [list]);

  /* --------- Needs attention --------- */
  const attention = useMemo(() => {
    const noAccess = list.filter(hasNoAccess);
    const noManager = list.filter(missingManager);
    const inactive = list.filter((e) => !isActiveEmp(e));

    const items = [];
    if (noAccess.length) {
      items.push({
        key: 'access',
        severity: 'critical',
        icon: VpnKeyOutlined,
        title: `${noAccess.length} employee${noAccess.length === 1 ? '' : 's'} with no system access`,
        detail: 'Active people without a role or module access assigned.',
        targets: noAccess,
      });
    }
    if (noManager.length) {
      items.push({
        key: 'manager',
        severity: 'warning',
        icon: BadgeOutlined,
        title: `${noManager.length} missing a reporting manager`,
        detail: 'Set a reporting line to complete the org chart.',
        targets: noManager,
      });
    }
    if (inactive.length) {
      items.push({
        key: 'inactive',
        severity: 'info',
        icon: HourglassEmptyRounded,
        title: `${inactive.length} inactive employee${inactive.length === 1 ? '' : 's'}`,
        detail: 'Review and offboard or reactivate as needed.',
        targets: inactive,
      });
    }
    return items;
  }, [list]);

  const sevColor = {
    critical: SEMANTIC.critical,
    warning: SEMANTIC.warning,
    info: SEMANTIC.info,
  };

  /* --------- Recently joined --------- */
  const recentlyJoined = useMemo(() => {
    return list
      .map((e) => ({ emp: e, jd: parseDate(e?.joining_date) }))
      .filter((x) => x.jd)
      .sort((a, b) => b.jd.getTime() - a.jd.getTime())
      .slice(0, 6);
  }, [list]);

  /* --------- loading skeleton --------- */
  if (loading && list.length === 0) {
    return (
      <Box>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            mb: 3,
            gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3,1fr)', lg: 'repeat(6,1fr)' },
          }}
        >
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} variant="rounded" height={104} sx={{ borderRadius: 2.5 }} />
          ))}
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' } }}>
          <Skeleton variant="rounded" height={320} sx={{ borderRadius: 2.5 }} />
          <Skeleton variant="rounded" height={320} sx={{ borderRadius: 2.5 }} />
        </Box>
      </Box>
    );
  }

  /* --------- KPI card config --------- */
  const kpiCards = [
    {
      label: 'Total Employees',
      value: kpis.total,
      sub: 'On the roster',
      icon: GroupsOutlined,
      accent: theme.palette.primary.main,
    },
    {
      label: 'Active',
      value: kpis.active,
      sub: `${kpis.total ? Math.round((kpis.active / kpis.total) * 100) : 0}% of roster`,
      icon: CheckCircleOutlineRounded,
      accent: SEMANTIC.success,
    },
    {
      label: 'New This Month',
      value: kpis.newJoiners,
      sub: 'Joined this month',
      icon: PersonAddAlt1Rounded,
      accent: SEMANTIC.primary,
    },
    {
      label: 'On Leave',
      value: kpis.onLeave,
      sub: 'Currently away',
      icon: EventAvailableRounded,
      accent: SEMANTIC.warning,
    },
    {
      label: 'Departments',
      value: kpis.departments,
      sub: 'Distinct teams',
      icon: ApartmentRounded,
      accent: theme.palette.primary.dark,
    },
    {
      label: 'Pending Approvals',
      value: kpis.pendingApprovals,
      sub: 'Awaiting review',
      icon: PendingActionsRounded,
      accent: SEMANTIC.info,
    },
  ];

  return (
    <Box>
      {/* ------------- Header / quick actions ------------- */}
      <Paper
        variant="outlined"
        sx={{
          borderRadius: 2.5,
          p: { xs: 1.5, sm: 2 },
          mb: 3,
          position: { md: 'sticky' },
          top: { md: 8 },
          zIndex: 3,
          backdropFilter: 'blur(6px)',
          backgroundColor: alpha(theme.palette.background.paper, 0.9),
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', md: 'center' }}
          spacing={1.5}
        >
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
              Employees
            </Typography>
            <Typography variant="caption" color="text.secondary">
              People, access &amp; org overview · {kpis.total} on roster
            </Typography>
          </Box>
          <Stack
            direction="row"
            spacing={1}
            flexWrap="wrap"
            useFlexGap
            justifyContent={{ xs: 'flex-start', md: 'flex-end' }}
          >
            <Button
              variant="contained"
              disableElevation
              startIcon={<AddRounded />}
              onClick={onAddEmployee}
              sx={{ fontWeight: 700, borderRadius: 2 }}
            >
              Add Employee
            </Button>
            <Button
              variant="outlined"
              startIcon={<FileUploadOutlined />}
              onClick={onImport}
              sx={{ fontWeight: 700, borderRadius: 2 }}
            >
              Import
            </Button>
            <Button
              variant="outlined"
              startIcon={<VpnKeyOutlined />}
              onClick={onAssignAccess}
              sx={{ fontWeight: 700, borderRadius: 2 }}
            >
              Assign access
            </Button>
            <Button
              variant="outlined"
              endIcon={<FileDownloadOutlined />}
              onClick={onExport}
              sx={{ fontWeight: 700, borderRadius: 2 }}
            >
              Export
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* ------------- KPI cards ------------- */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          mb: 3,
          gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3,1fr)', lg: 'repeat(6,1fr)' },
        }}
      >
        {kpiCards.map((c) => (
          <StatCard key={c.label} {...c} loading={loading} />
        ))}
      </Box>

      {/* ------------- Headcount + Needs attention ------------- */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          mb: 3,
          gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' },
          alignItems: 'stretch',
        }}
      >
        <Panel
          title="Headcount by department"
          subtitle="Distribution of people across teams"
          height={Math.max(260, deptData.length * 40)}
        >
          {deptData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={deptData}
                layout="vertical"
                margin={{ top: 4, right: 28, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={false} />
                <XAxis type="number" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={axis}
                  tickLine={false}
                  axisLine={{ stroke: grid }}
                  width={120}
                />
                <RTooltip
                  cursor={{ fill: alpha(theme.palette.primary.main, 0.06) }}
                  contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }}
                />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={20}>
                  {deptData.map((e, i) => (
                    <Cell key={e.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                  <LabelList dataKey="value" position="right" fill={theme.palette.text.secondary} fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart label="No employees to chart yet" />
          )}
        </Panel>

        <Panel title="Needs attention" subtitle="Action items across your people data" height="auto">
          {attention.length ? (
            <Stack spacing={1.25}>
              {attention.map((item) => {
                const color = sevColor[item.severity] || SEMANTIC.info;
                const Icon = item.icon;
                const first = item.targets[0];
                return (
                  <Paper
                    key={item.key}
                    variant="outlined"
                    onClick={() => first && onOpenEmployee?.(first)}
                    sx={{
                      p: 1.5,
                      borderRadius: 2,
                      borderLeft: `4px solid ${color}`,
                      cursor: first ? 'pointer' : 'default',
                      transition: 'box-shadow 0.2s ease, transform 0.2s ease',
                      '&:hover': first
                        ? { boxShadow: `0 8px 20px -12px ${alpha(color, 0.5)}`, transform: 'translateY(-1px)' }
                        : undefined,
                    }}
                  >
                    <Stack direction="row" spacing={1.25} alignItems="flex-start">
                      <Box
                        sx={{
                          mt: 0.25,
                          p: 0.75,
                          borderRadius: 1.5,
                          bgcolor: alpha(color, 0.12),
                          color,
                          display: 'flex',
                        }}
                      >
                        <Icon sx={{ fontSize: 18 }} />
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                          {item.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                          {item.detail}
                        </Typography>
                      </Box>
                      {first && (
                        <ArrowForwardRounded sx={{ fontSize: 18, color: 'text.disabled', mt: 0.5 }} />
                      )}
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          ) : (
            <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ py: 4, height: '100%' }}>
              <CheckCircleOutlineRounded sx={{ fontSize: 36, color: SEMANTIC.success }} />
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                All clear
              </Typography>
              <Typography variant="caption" color="text.secondary" textAlign="center">
                Everyone has access, a manager, and an active record.
              </Typography>
            </Stack>
          )}
        </Panel>
      </Box>

      {/* ------------- Recently joined ------------- */}
      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Recently joined
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Newest additions to the team
          </Typography>
        </Box>
        <Divider />
        {recentlyJoined.length ? (
          <Stack divider={<Divider />}>
            {recentlyJoined.map(({ emp, jd }, i) => {
              const active = isActiveEmp(emp);
              const dot = active ? SEMANTIC.success : theme.palette.text.disabled;
              return (
                <Stack
                  key={emp.id ?? emp.employee_code ?? emp.email ?? i}
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={1.5}
                  onClick={() => onOpenEmployee?.(emp)}
                  sx={{
                    px: 2,
                    py: 1.25,
                    cursor: 'pointer',
                    transition: 'background-color 0.15s ease',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                    <Box sx={{ position: 'relative' }}>
                      <Avatar
                        src={emp.profile_photo || undefined}
                        sx={{
                          width: 40,
                          height: 40,
                          fontSize: 14,
                          fontWeight: 700,
                          bgcolor: avatarColor(emp, i),
                        }}
                      >
                        {initials(emp)}
                      </Avatar>
                      <Box
                        sx={{
                          position: 'absolute',
                          right: -1,
                          bottom: -1,
                          width: 11,
                          height: 11,
                          borderRadius: '50%',
                          bgcolor: dot,
                          border: `2px solid ${theme.palette.background.paper}`,
                        }}
                      />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                        {emp.full_name || emp.email || 'Unnamed'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {[emp.designation, emp.department].filter(Boolean).join(' · ') || 'No department'}
                      </Typography>
                    </Box>
                  </Stack>
                  <Stack alignItems="flex-end" spacing={0.5} sx={{ flexShrink: 0 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      joined {timeAgo(jd)}
                    </Typography>
                    {emp.employment_type && (
                      <Chip
                        label={emp.employment_type}
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          bgcolor: alpha(theme.palette.primary.main, 0.1),
                          color: theme.palette.primary.main,
                        }}
                      />
                    )}
                  </Stack>
                </Stack>
              );
            })}
          </Stack>
        ) : (
          <Box sx={{ px: 2, py: 5, textAlign: 'center', color: 'text.secondary' }}>
            <Typography variant="body2">No joining dates on record yet.</Typography>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
