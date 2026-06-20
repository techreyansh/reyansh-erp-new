import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress,
  Collapse, Divider, FormControl, FormControlLabel, Grid, IconButton, InputLabel,
  LinearProgress, Menu, MenuItem, Paper, Select, Snackbar, Stack, Switch, Tab, Tabs,
  TextField, Tooltip, Typography, alpha, useTheme,
} from '@mui/material';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from 'recharts';
import {
  ArrowBack, Edit as EditIcon, MoreVert, Save as SaveIcon, FlashOn,
  ExpandMore, ExpandLess, Block, ContentCopy, VerifiedUser, Visibility,
  Dashboard, ShoppingCart, Groups, Factory, Inventory2, LocalShipping,
  AccountBalance, Badge, AssignmentTurnedIn, Assessment, Settings, ViewModule,
  AccountBalanceWallet, School, FolderOpen, SupervisorAccount, Email as EmailIcon,
  Phone as PhoneIcon, WorkOutline, EventAvailable, BeachAccess, TrendingUp,
  History, CloudUpload, InsertDriveFile, PersonOutline, BusinessCenter,
  CheckCircle,
} from '@mui/icons-material';
import { usePermissions } from '../../context/PermissionContext';
import { DEPARTMENT_OPTIONS } from '../../config/departments';
import { supabase } from '../../lib/supabaseClient';
import {
  listEmployeePermissionOverrides, listEmployees, listModules,
  saveEmployee, saveEmployeeModuleAccess, setEmployeeActive,
} from '../../services/rbacService';
import {
  personScore, listCommitments, getCurrentWeekStart, addWeeks,
} from '../../services/perfService';

// ---- Access matrix config (lifted from EmployeeManagement) -----------------
const ROLE_PRESETS = {
  Sales: ['dashboard', 'sales', 'crm', 'tasks'],
  CRM: ['dashboard', 'crm', 'sales', 'tasks'],
  Production: ['dashboard', 'production', 'inventory', 'dispatch', 'tasks'],
  Inventory: ['dashboard', 'inventory', 'dispatch', 'tasks'],
  Accounts: ['dashboard', 'accounts', 'reports', 'tasks'],
  Dispatch: ['dashboard', 'dispatch', 'inventory', 'tasks'],
  HR: ['dashboard', 'employees', 'tasks', 'reports'],
  Manager: ['dashboard', 'crm', 'sales', 'production', 'inventory', 'dispatch', 'tasks', 'reports'],
};
const ACTIONS = ['can_view', 'can_create', 'can_edit', 'can_delete'];
const ACTION_LABEL = { can_view: 'View', can_create: 'Create', can_edit: 'Edit', can_delete: 'Delete' };

const MODULE_META = {
  dashboard: { icon: Dashboard, color: 'primary' },
  crm: { icon: Groups, color: 'info' },
  sales: { icon: ShoppingCart, color: 'success' },
  production: { icon: Factory, color: 'secondary' },
  inventory: { icon: Inventory2, color: 'warning' },
  dispatch: { icon: LocalShipping, color: 'info' },
  accounts: { icon: AccountBalance, color: 'success' },
  employees: { icon: Badge, color: 'secondary' },
  tasks: { icon: AssignmentTurnedIn, color: 'primary' },
  reports: { icon: Assessment, color: 'info' },
  settings: { icon: Settings, color: 'secondary' },
};
const moduleMeta = (key) => MODULE_META[key] || { icon: ViewModule, color: 'primary' };

const EMPLOYEE_TYPES = ['Full-time', 'Part-time', 'Contract', 'Intern', 'Consultant', 'Freelancer'];

const initials = (name, email) => (name || email || '?').trim().slice(0, 1).toUpperCase();

// buildModuleDraft — lifted verbatim from EmployeeManagement.
function buildModuleDraft(modules, overrides) {
  const overrideMap = new Map((overrides || []).map((row) => [row.module_id, row]));
  return modules.map((module) => {
    const existing = overrideMap.get(module.id);
    return {
      module_id: module.id,
      module_key: module.module_key,
      module_name: module.module_name,
      can_view: Boolean(existing?.can_view),
      can_create: Boolean(existing?.can_create),
      can_edit: Boolean(existing?.can_edit),
      can_delete: Boolean(existing?.can_delete),
    };
  });
}

// Blank profile (PascalCase mirrors the employees_data view columns).
const emptyProfile = {
  EmployeeName: '', Email: '', Phone: '', Department: '', Designation: '',
  EmployeeType: 'Full-time', JoiningDate: '', DateOfBirth: '', Address: '',
  ReportingManager: '', SalaryGrade: '', Status: 'Active',
  HighestQualification: '', University: '', GraduationYear: '', Specialization: '',
  Experience: '', Skills: '', Certifications: '',
  UpiId: '', BankName: '', AccountNumber: '', IfscCode: '', BankBranch: '',
  AccountHolderName: '',
};

// Map a public.employees row → the profile form (lifted from EmployeeManagement).
const profileFromEmployee = (emp) => {
  if (!emp) return { ...emptyProfile };
  return {
    ...emptyProfile,
    EmployeeName: emp.full_name || '',
    Email: emp.email || '',
    Phone: emp.phone || '',
    Department: emp.department || '',
    Designation: emp.designation || '',
    EmployeeType: emp.employment_type || 'Full-time',
    JoiningDate: emp.joining_date || '',
    DateOfBirth: emp.date_of_birth || '',
    Address: emp.address || '',
    ReportingManager: emp.reporting_manager || '',
    SalaryGrade: emp.salary_grade || '',
    Status: emp.status || (emp.is_active === false ? 'Inactive' : 'Active'),
    HighestQualification: emp.highest_qualification || '',
    University: emp.university || '',
    GraduationYear: emp.graduation_year || '',
    Specialization: emp.specialization || '',
    Experience: emp.experience || '',
    Skills: emp.skills || '',
    Certifications: emp.certifications || '',
    UpiId: emp.upi_id || '',
    BankName: emp.bank_name || '',
    AccountNumber: emp.account_number || '',
    IfscCode: emp.ifsc_code || '',
    BankBranch: emp.bank_branch || '',
    AccountHolderName: emp.account_holder_name || '',
  };
};

const fmtDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

// Small label/value pair used across the read-only Overview cards.
function InfoRow({ icon: Icon, label, value }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      {Icon && (
        <Box sx={{ color: 'text.disabled', mt: 0.25 }}>
          <Icon fontSize="small" />
        </Box>
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>
          {value || '—'}
        </Typography>
      </Box>
    </Stack>
  );
}

function SummaryCard({ title, icon: Icon, children, action }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3, height: '100%' }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.75}>
          <Stack direction="row" alignItems="center" spacing={1}>
            {Icon && <Icon fontSize="small" color="action" />}
            <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
          </Stack>
          {action}
        </Stack>
        <Stack spacing={1.75}>{children}</Stack>
      </CardContent>
    </Card>
  );
}

function ComingSoonPanel({ icon: Icon, title, line }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent sx={{ py: 8, textAlign: 'center' }}>
        <Avatar sx={{ width: 56, height: 56, mx: 'auto', mb: 2, bgcolor: (t) => alpha(t.palette.primary.main, 0.12), color: 'primary.main' }}>
          <Icon />
        </Avatar>
        <Typography variant="h6" fontWeight={700}>{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, mx: 'auto', mt: 0.5 }}>
          {line}
        </Typography>
        <Chip size="small" variant="outlined" label="Coming soon — future-ready" sx={{ mt: 2 }} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PERFORMANCE TAB — live weekly scorecard for this employee, sourced from the
// Performance Review system (perfService). All data is keyed on employee.email.
// ---------------------------------------------------------------------------

// Category config: key → label + weight% + which raw-count fields to surface.
const PERF_CATEGORIES = [
  { key: 'work_completed', label: 'Work Completed', weight: 40 },
  { key: 'on_time', label: 'On Time', weight: 25 },
  { key: 'checklist', label: 'Checklist', weight: 15 },
  { key: 'workflow', label: 'Workflow', weight: 10 },
  { key: 'meeting', label: 'Meeting', weight: 5 },
  { key: 'manager', label: 'Manager', weight: 5 },
];

// Band metadata. The RPC returns a band key; if absent we derive one from the
// numeric score using the documented thresholds (>=90 / >=75 / >=60 / <60).
const PERF_BANDS = {
  outstanding: { label: 'Outstanding Achiever', paletteKey: 'success' },
  rising_star: { label: 'Rising Star', paletteKey: 'success' },
  consistent: { label: 'Consistent Contributor', paletteKey: 'warning' },
  needs_attention: { label: 'Needs Attention', paletteKey: 'error' },
  no_data: { label: 'No data', paletteKey: 'grey' },
};

const PERF_COMMIT_STATUS = {
  committed: { label: 'Committed', color: 'info' },
  delivered: { label: 'Delivered', color: 'success' },
  missed: { label: 'Missed', color: 'error' },
  carried_over: { label: 'Carried over', color: 'warning' },
};

function perfBandKey(score) {
  if (score?.band && PERF_BANDS[score.band]) return score.band;
  const n = score?.score;
  if (n == null) return 'no_data';
  if (n >= 90) return 'outstanding';
  if (n >= 75) return 'rising_star';
  if (n >= 60) return 'consistent';
  return 'needs_attention';
}

function perfBandColor(theme, bandKey) {
  const meta = PERF_BANDS[bandKey] || PERF_BANDS.no_data;
  if (meta.paletteKey === 'grey') return theme.palette.text.disabled;
  return theme.palette[meta.paletteKey]?.main || theme.palette.text.disabled;
}

function perfCatSub(key, data) {
  if (!data) return '';
  if (key === 'work_completed' && (data.done != null || data.due != null)) {
    return `${data.done ?? 0}/${data.due ?? 0} done`;
  }
  if (key === 'on_time' && data.on_time != null) return `${data.on_time} on time`;
  if ((key === 'checklist' || key === 'workflow') && (data.ok != null || data.due != null)) {
    return `${data.ok ?? 0}/${data.due ?? 0} ok`;
  }
  return '';
}

function perfWeekLabel(weekStart) {
  const [y, m, d] = String(weekStart).split('-').map(Number);
  if (!y) return String(weekStart || '');
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function PerfCategoryRow({ cfg, data }) {
  const theme = useTheme();
  const pct = data && data.pct != null ? Math.max(0, Math.min(100, Number(data.pct))) : null;
  const hasData = pct != null;
  const accent = !hasData
    ? theme.palette.text.disabled
    : pct >= 80
    ? theme.palette.success.main
    : pct >= 60
    ? theme.palette.warning.main
    : theme.palette.error.main;
  const sub = perfCatSub(cfg.key, data);

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 1.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.75 }}>
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary' }}
        >
          {cfg.label}
        </Typography>
        <Chip label={`weight ${cfg.weight}%`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.68rem', fontWeight: 600 }} />
      </Stack>
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <LinearProgress
            variant="determinate"
            value={hasData ? pct : 0}
            sx={{
              height: 8, borderRadius: 4, bgcolor: alpha(accent, 0.14),
              '& .MuiLinearProgress-bar': { borderRadius: 4, bgcolor: accent },
            }}
          />
        </Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, minWidth: 56, textAlign: 'right', color: hasData ? 'text.primary' : 'text.disabled' }}>
          {hasData ? `${pct}%` : 'no data'}
        </Typography>
      </Stack>
      {sub && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{sub}</Typography>
      )}
    </Paper>
  );
}

function PerformanceTab({ employee }) {
  const theme = useTheme();
  const email = employee?.email || null;
  const weekStart = useMemo(() => getCurrentWeekStart(), []);

  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState(null);
  const [trend, setTrend] = useState([]);
  const [commitments, setCommitments] = useState([]);

  useEffect(() => {
    if (!email) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    (async () => {
      // Last ~6 weeks (current + 5 back) for the trend, plus this week's commitments.
      const weeks = [0, 1, 2, 3, 4, 5].map((n) => addWeeks(weekStart, -n));
      const [scores, commits] = await Promise.all([
        Promise.all(weeks.map((w) => personScore(email, w))),
        listCommitments(email, weekStart),
      ]);
      if (!active) return;
      setScore(scores[0] || null);
      const series = weeks
        .map((w, i) => ({ week: w, label: perfWeekLabel(w), score: scores[i]?.score }))
        .filter((p) => p.score != null)
        .reverse(); // oldest → newest, left → right
      setTrend(series);
      setCommitments(Array.isArray(commits) ? commits : []);
      setLoading(false);
    })().catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [email, weekStart]);

  if (!email) {
    return (
      <ComingSoonPanel
        icon={TrendingUp}
        title="Performance"
        line="This employee has no email on file, so their performance scorecard can't be loaded."
      />
    );
  }

  if (loading) {
    return (
      <Card variant="outlined" sx={{ borderRadius: 3 }}>
        <CardContent sx={{ py: 8, textAlign: 'center' }}>
          <CircularProgress size={32} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Loading performance data…
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const hasScore = score && score.score != null;
  const bandKey = perfBandKey(score);
  const accent = perfBandColor(theme, bandKey);
  const bandLabel = (PERF_BANDS[bandKey] || PERF_BANDS.no_data).label;
  const cats = (score && score.categories) || {};

  return (
    <Grid container spacing={2.5}>
      {/* a) Current-week score header */}
      <Grid item xs={12}>
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={1} mb={2}>
              <TrendingUp color="action" />
              <Typography variant="h6" fontWeight={700}>Performance</Typography>
              <Box sx={{ flex: 1 }} />
              <Chip size="small" variant="outlined" label={`Week of ${perfWeekLabel(weekStart)}`} />
            </Stack>

            {!hasScore ? (
              <Alert severity="info" variant="outlined">
                No performance data yet for this week.
              </Alert>
            ) : (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} alignItems={{ sm: 'center' }}>
                <Box
                  sx={{
                    width: 104, height: 104, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    bgcolor: alpha(accent, 0.12), border: `2px solid ${alpha(accent, 0.5)}`,
                  }}
                >
                  <Typography variant="h3" sx={{ fontWeight: 800, lineHeight: 1, color: accent }}>
                    {score.score}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">/ 100</Typography>
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Chip
                    label={bandLabel}
                    sx={{
                      fontWeight: 700, letterSpacing: '0.02em',
                      bgcolor: alpha(accent, 0.14), color: accent, border: `1px solid ${alpha(accent, 0.4)}`,
                    }}
                  />
                  {score.manager_remarks && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, fontStyle: 'italic' }}>
                      “{score.manager_remarks}”
                    </Typography>
                  )}
                </Box>
              </Stack>
            )}
          </CardContent>
        </Card>
      </Grid>

      {/* b) Category breakdown */}
      {hasScore && (
        <Grid item xs={12} md={7}>
          <Card variant="outlined" sx={{ borderRadius: 3, height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} mb={1.5}>Category breakdown</Typography>
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
                {PERF_CATEGORIES.map((cfg) => (
                  <PerfCategoryRow key={cfg.key} cfg={cfg} data={cats[cfg.key]} />
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      )}

      {/* c) Trend over the last ~6 weeks */}
      <Grid item xs={12} md={hasScore ? 5 : 12}>
        <Card variant="outlined" sx={{ borderRadius: 3, height: '100%' }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} mb={1.5}>Score trend</Typography>
            {trend.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                Not enough history yet — weekly scores will chart here over time.
              </Typography>
            ) : (
              <Box sx={{ width: '100%', height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.text.primary, 0.08)} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: theme.palette.text.secondary }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: theme.palette.text.secondary }} />
                    <RTooltip
                      contentStyle={{
                        background: theme.palette.background.paper,
                        border: `1px solid ${theme.palette.divider}`,
                        borderRadius: 8, fontSize: 12,
                      }}
                    />
                    <Line
                      type="monotone" dataKey="score" name="Score"
                      stroke={theme.palette.primary.main} strokeWidth={2}
                      dot={{ r: 3, fill: theme.palette.primary.main }} activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>

      {/* d) This week's commitments */}
      <Grid item xs={12}>
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} mb={1.5}>This week&apos;s commitments</Typography>
            {commitments.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                No commitments recorded for this week.
              </Typography>
            ) : (
              <Stack spacing={1.25}>
                {commitments.map((c) => {
                  const meta = PERF_COMMIT_STATUS[c.status] || { label: c.status || '—', color: 'default' };
                  return (
                    <Paper key={c.id} variant="outlined" sx={{ borderRadius: 2, p: 1.5 }}>
                      <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
                        <Typography variant="body2" fontWeight={600} sx={{ flex: 1, minWidth: 0 }}>
                          {c.title || 'Untitled commitment'}
                        </Typography>
                        {c.due_date && (
                          <Typography variant="caption" color="text.secondary">
                            due {perfWeekLabel(c.due_date)}
                          </Typography>
                        )}
                        <Chip size="small" label={meta.label} color={meta.color} variant="outlined" sx={{ fontWeight: 600 }} />
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

const TAB_KEYS = ['overview', 'employment', 'access', 'documents', 'attendance', 'leave', 'performance', 'activity'];

function EmployeeProfile({ employee, onBack, onSaved, onStatusChange }) {
  const { canEdit, refreshAccess } = usePermissions();
  const canAssignPermissions = canEdit?.('employees') ?? true;

  const employeeId = employee?.id || null;

  const [tab, setTab] = useState(0);
  const [profile, setProfile] = useState(() => profileFromEmployee(employee));
  const [isActive, setIsActive] = useState(employee?.is_active !== false);

  const [allEmployees, setAllEmployees] = useState([]);
  const [modules, setModules] = useState([]);
  const [moduleDraft, setModuleDraft] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);

  const [showEducation, setShowEducation] = useState(false);
  const [showBank, setShowBank] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);

  // Re-hydrate the form whenever the incoming employee changes.
  useEffect(() => {
    setProfile(profileFromEmployee(employee));
    setIsActive(employee?.is_active !== false);
  }, [employee]);

  // Load the shared lists (employees for manager/copy-from, modules for matrix).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [employeeRows, moduleRows] = await Promise.all([listEmployees(), listModules()]);
        if (cancelled) return;
        setAllEmployees(employeeRows || []);
        setModules(moduleRows || []);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load reference data.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load this employee's permission overrides → matrix draft.
  useEffect(() => {
    if (!employeeId || modules.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const overrides = await listEmployeePermissionOverrides(employeeId);
        if (!cancelled) setModuleDraft(buildModuleDraft(modules, overrides));
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load permissions.');
      }
    })();
    return () => { cancelled = true; };
  }, [employeeId, modules]);

  // Load documents for this employee (defensive — table may be empty/absent).
  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    (async () => {
      setDocsLoading(true);
      try {
        const { data, error: docErr } = await supabase
          .from('employee_documents')
          .select('*')
          .eq('employee_id', employeeId)
          .order('created_at', { ascending: false });
        if (docErr) throw docErr;
        if (!cancelled) setDocuments(data || []);
      } catch (err) {
        // Soft-fail: keep the friendly empty state rather than blowing up.
        if (!cancelled) setDocuments([]);
      } finally {
        if (!cancelled) setDocsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employeeId]);

  const visibleModules = useMemo(() => moduleDraft.filter((m) => m.can_view), [moduleDraft]);

  const directReports = useMemo(() => {
    const me = (profile.EmployeeName || employee?.full_name || '').trim().toLowerCase();
    const myEmail = (profile.Email || employee?.email || '').trim().toLowerCase();
    if (!me && !myEmail) return [];
    return (allEmployees || []).filter((e) => {
      if (e.id === employeeId) return false;
      const mgr = String(e.reporting_manager || '').trim().toLowerCase();
      return mgr && (mgr === me || mgr === myEmail);
    });
  }, [allEmployees, profile.EmployeeName, profile.Email, employee, employeeId]);

  const handleProfileChange = (field, value) =>
    setProfile((prev) => ({ ...prev, [field]: value }));

  // ---- Save profile — SAME path as EmployeeManagement ----------------------
  const handleSaveProfile = async () => {
    const email = String(profile.Email || '').trim().toLowerCase();
    if (!email) { setError('Email is required — it is how they log in.'); return; }
    if (!profile.EmployeeName?.trim()) { setError('Full name is required.'); return; }

    setSaving(true); setError(null); setSuccess(null);
    try {
      const nowIso = new Date().toISOString();
      const viewPayload = {
        EmployeeName: profile.EmployeeName || null,
        Email: email,
        Phone: profile.Phone || null,
        Department: profile.Department || null,
        Designation: profile.Designation || null,
        EmployeeType: profile.EmployeeType || null,
        JoiningDate: profile.JoiningDate || null,
        DateOfBirth: profile.DateOfBirth || null,
        Address: profile.Address || null,
        ReportingManager: profile.ReportingManager || null,
        SalaryGrade: profile.SalaryGrade || null,
        Status: profile.Status || (isActive ? 'Active' : 'Inactive'),
        HighestQualification: profile.HighestQualification || null,
        University: profile.University || null,
        GraduationYear: profile.GraduationYear || null,
        Specialization: profile.Specialization || null,
        Experience: profile.Experience || null,
        Skills: profile.Skills || null,
        Certifications: profile.Certifications || null,
        UpiId: profile.UpiId || null,
        BankName: profile.BankName || null,
        AccountNumber: profile.AccountNumber || null,
        IfscCode: profile.IfscCode || null,
        BankBranch: profile.BankBranch || null,
        AccountHolderName: profile.AccountHolderName || null,
        UpdatedAt: nowIso,
      };

      // Existing employee → update via the writable employees_data view by Email.
      const { error: viewErr } = await supabase
        .from('employees_data').update(viewPayload).eq('Email', email);
      if (viewErr) throw viewErr;
      // Keep RBAC identity columns aligned (same as EmployeeManagement).
      await saveEmployee({
        id: employeeId, email,
        full_name: profile.EmployeeName, phone: profile.Phone,
        department: profile.Department, role_id: employee?.role_id || null, is_active: isActive,
      });

      setSuccess('Profile saved.');
      await refreshAccess?.();
      onSaved?.();
    } catch (err) {
      setError(err.message || 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  // ---- Access matrix logic (lifted from EmployeeManagement) ----------------
  const handleDraftChange = (moduleId, field, checked) => {
    setModuleDraft((prev) => prev.map((row) => {
      if (row.module_id !== moduleId) return row;
      const next = { ...row, [field]: checked };
      if (field === 'can_view' && !checked) { next.can_create = next.can_edit = next.can_delete = false; }
      if (field !== 'can_view' && checked) { next.can_view = true; }
      return next;
    }));
  };

  const applyPreset = (presetKey) => {
    const keys = ROLE_PRESETS[presetKey] || [];
    setModuleDraft((prev) => prev.map((row) => {
      const on = keys.includes(row.module_key);
      return {
        ...row,
        can_view: on,
        can_create: on && row.module_key !== 'dashboard',
        can_edit: on && row.module_key !== 'dashboard',
        can_delete: false,
      };
    }));
    setSuccess(`Applied "${presetKey}" preset — review and Save access to apply.`);
  };

  const handleFullAccess = () => {
    setModuleDraft((prev) => prev.map((row) => ({ ...row, can_view: true, can_create: true, can_edit: true, can_delete: true })));
    setSuccess('Full access selected — Save access to apply.');
  };
  const handleClearAll = () => {
    setModuleDraft((prev) => prev.map((row) => ({ ...row, can_view: false, can_create: false, can_edit: false, can_delete: false })));
  };

  const copyFrom = async (sourceId) => {
    if (!sourceId) return;
    try {
      const overrides = await listEmployeePermissionOverrides(sourceId);
      setModuleDraft(buildModuleDraft(modules, overrides));
      const src = allEmployees.find((e) => e.id === sourceId);
      setSuccess(`Copied access from ${src?.full_name || src?.email} — Save access to apply.`);
    } catch (err) { setError(err.message || 'Failed to copy access.'); }
  };

  // ---- Save access — SAME path as EmployeeManagement -----------------------
  const handleSaveAccess = async () => {
    if (!employeeId) { setError('Employee is required.'); return; }
    setSaving(true); setError(null); setSuccess(null);
    try {
      await saveEmployeeModuleAccess(employeeId, moduleDraft);
      const overrides = await listEmployeePermissionOverrides(employeeId);
      setModuleDraft(buildModuleDraft(modules, overrides));
      setSuccess('Access saved.');
      await refreshAccess?.();
    } catch (err) {
      setError(err.message || 'Failed to save access.');
    } finally {
      setSaving(false);
    }
  };

  // ---- Active / status toggle ----------------------------------------------
  const handleToggleActive = async (next) => {
    setSaving(true); setError(null);
    try {
      if (onStatusChange) {
        await onStatusChange(employee, next);
      } else if (employeeId) {
        await setEmployeeActive(employeeId, next);
      }
      setIsActive(next);
      setProfile((p) => ({ ...p, Status: next ? 'Active' : 'Inactive' }));
      setSuccess(next ? 'Employee re-activated.' : 'Employee deactivated — ERP access removed.');
      await refreshAccess?.();
    } catch (err) {
      setError(err.message || 'Failed to update status.');
    } finally {
      setSaving(false);
    }
  };

  const headerName = profile.EmployeeName || employee?.full_name || 'Employee';
  const designationLine = [profile.Designation, profile.Department].filter(Boolean).join(' · ') || 'No designation set';
  const employeeCode = employee?.employee_code || '—';

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', pb: 6 }}>
      {/* ---------------- STICKY HEADER ---------------- */}
      <Card
        variant="outlined"
        sx={{
          borderRadius: 3, overflow: 'hidden', mb: 2.5,
          position: 'sticky', top: 8, zIndex: 10,
          boxShadow: (t) => `0 4px 18px ${alpha(t.palette.common.black, 0.06)}`,
        }}
      >
        <Box sx={{ height: 56, bgcolor: (t) => alpha(t.palette.primary.main, 0.10) }} />
        <CardContent sx={{ pt: 0 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} sx={{ mt: -4 }}>
            <Avatar
              src={employee?.profile_photo || undefined}
              sx={{
                width: 80, height: 80, fontSize: 30, fontWeight: 800,
                border: '3px solid', borderColor: 'background.paper',
                bgcolor: isActive ? 'primary.main' : 'grey.400',
              }}
            >
              {initials(profile.EmployeeName, profile.Email)}
            </Avatar>

            <Box sx={{ flex: 1, minWidth: 0, pt: { xs: 0, md: 2 } }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="h5" fontWeight={800} noWrap sx={{ maxWidth: '100%' }}>{headerName}</Typography>
                <Chip
                  size="small"
                  icon={isActive ? <CheckCircle sx={{ fontSize: 15 }} /> : <Block sx={{ fontSize: 15 }} />}
                  color={isActive ? 'success' : 'warning'}
                  variant={isActive ? 'filled' : 'outlined'}
                  label={isActive ? 'Active' : 'Inactive'}
                  sx={{ fontWeight: 700 }}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary" noWrap>{designationLine}</Typography>
              <Typography variant="caption" color="text.disabled">Code: {employeeCode}</Typography>
            </Box>

            <Stack direction="row" spacing={1} alignItems="center" sx={{ pt: { xs: 0, md: 2 } }}>
              <FormControlLabel
                sx={{ m: 0 }}
                control={<Switch checked={isActive} disabled={saving} onChange={(e) => handleToggleActive(e.target.checked)} />}
                label={<Typography variant="caption" color="text.secondary">{isActive ? 'Active' : 'Inactive'}</Typography>}
                labelPlacement="start"
              />
              <Button
                variant="contained" size="small" startIcon={<EditIcon />}
                onClick={() => setTab(TAB_KEYS.indexOf('employment'))}
              >
                Edit
              </Button>
              <Tooltip title="More">
                <IconButton size="small" onClick={(e) => setMenuAnchor(e.currentTarget)}>
                  <MoreVert />
                </IconButton>
              </Tooltip>
              <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
                <MenuItem onClick={() => { setMenuAnchor(null); setTab(TAB_KEYS.indexOf('access')); }}>
                  <VerifiedUser fontSize="small" style={{ marginRight: 8 }} /> Manage access
                </MenuItem>
                <MenuItem onClick={() => { setMenuAnchor(null); handleToggleActive(!isActive); }}>
                  {isActive
                    ? (<><Block fontSize="small" style={{ marginRight: 8 }} /> Deactivate</>)
                    : (<><CheckCircle fontSize="small" style={{ marginRight: 8 }} /> Re-activate</>)}
                </MenuItem>
              </Menu>
            </Stack>
          </Stack>

          <Stack direction="row" alignItems="center" sx={{ mt: 1.5 }}>
            <Button size="small" startIcon={<ArrowBack />} onClick={() => onBack?.()} color="inherit">
              Back to team
            </Button>
          </Stack>

          <Tabs
            value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{ mt: 1, borderTop: '1px solid', borderColor: 'divider' }}
          >
            <Tab icon={<PersonOutline fontSize="small" />} iconPosition="start" label="Overview" />
            <Tab icon={<WorkOutline fontSize="small" />} iconPosition="start" label="Employment" />
            <Tab icon={<VerifiedUser fontSize="small" />} iconPosition="start" label="Access & Permissions" />
            <Tab icon={<FolderOpen fontSize="small" />} iconPosition="start" label="Documents" />
            <Tab icon={<EventAvailable fontSize="small" />} iconPosition="start" label="Attendance" />
            <Tab icon={<BeachAccess fontSize="small" />} iconPosition="start" label="Leave" />
            <Tab icon={<TrendingUp fontSize="small" />} iconPosition="start" label="Performance" />
            <Tab icon={<History fontSize="small" />} iconPosition="start" label="Activity" />
          </Tabs>
        </CardContent>
      </Card>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* ---------------- TAB 0: OVERVIEW (read-only) ---------------- */}
      {tab === 0 && (
        <Grid container spacing={2.5}>
          <Grid item xs={12} md={6}>
            <SummaryCard title="Contact" icon={EmailIcon}>
              <InfoRow icon={EmailIcon} label="Email" value={profile.Email} />
              <InfoRow icon={PhoneIcon} label="Phone" value={profile.Phone} />
            </SummaryCard>
          </Grid>

          <Grid item xs={12} md={6}>
            <SummaryCard
              title="Employment" icon={BusinessCenter}
              action={(
                <Button size="small" startIcon={<EditIcon fontSize="small" />} onClick={() => setTab(TAB_KEYS.indexOf('employment'))}>
                  Edit details
                </Button>
              )}
            >
              <Grid container spacing={1.75}>
                <Grid item xs={6}><InfoRow label="Designation" value={profile.Designation} /></Grid>
                <Grid item xs={6}><InfoRow label="Department" value={profile.Department} /></Grid>
                <Grid item xs={6}><InfoRow label="Employment type" value={profile.EmployeeType} /></Grid>
                <Grid item xs={6}><InfoRow label="Joined" value={fmtDate(profile.JoiningDate)} /></Grid>
                <Grid item xs={6}><InfoRow label="Employee code" value={employeeCode} /></Grid>
              </Grid>
            </SummaryCard>
          </Grid>

          <Grid item xs={12} md={6}>
            <SummaryCard title="Reporting" icon={SupervisorAccount}>
              <InfoRow icon={SupervisorAccount} label="Reporting manager" value={profile.ReportingManager} />
              <InfoRow
                icon={Groups}
                label="Direct reports"
                value={directReports.length ? `${directReports.length} direct report${directReports.length === 1 ? '' : 's'}` : '—'}
              />
            </SummaryCard>
          </Grid>

          <Grid item xs={12} md={6}>
            <SummaryCard title="Quick stats" icon={Assessment}>
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                <Paper variant="outlined" sx={{ borderRadius: 2, p: 1.75, flex: 1, minWidth: 130, textAlign: 'center' }}>
                  <Typography variant="h4" fontWeight={800} color="primary.main">{visibleModules.length}</Typography>
                  <Typography variant="caption" color="text.secondary">Modules</Typography>
                </Paper>
                <Paper variant="outlined" sx={{ borderRadius: 2, p: 1.75, flex: 1, minWidth: 130, textAlign: 'center' }}>
                  <Typography variant="h4" fontWeight={800} color="info.main">{documents.length}</Typography>
                  <Typography variant="caption" color="text.secondary">Documents</Typography>
                </Paper>
              </Stack>
              {visibleModules.length > 0 && (
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                  {visibleModules.map((m) => {
                    const Icon = moduleMeta(m.module_key).icon;
                    return (
                      <Chip key={m.module_id} size="small" variant="outlined" color="info"
                        label={m.module_name} icon={<Icon sx={{ fontSize: 15 }} />} sx={{ fontWeight: 600 }} />
                    );
                  })}
                </Stack>
              )}
            </SummaryCard>
          </Grid>
        </Grid>
      )}

      {/* ---------------- TAB 1: EMPLOYMENT (editable form) ---------------- */}
      {tab === 1 && (
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <Typography variant="h6" fontWeight={700} mb={0.5}>Employment details</Typography>
            <Typography variant="body2" color="text.secondary" mb={2.5}>
              Edit core profile, then save. Education and bank details are tucked away below.
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField label="Full name *" value={profile.EmployeeName} onChange={(e) => handleProfileChange('EmployeeName', e.target.value)} fullWidth size="small" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Email *" value={profile.Email} onChange={(e) => handleProfileChange('Email', e.target.value)} fullWidth size="small" helperText="The Google email they log in with" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Phone" value={profile.Phone} onChange={(e) => handleProfileChange('Phone', e.target.value)} fullWidth size="small" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Department</InputLabel>
                  <Select label="Department" value={profile.Department} onChange={(e) => handleProfileChange('Department', e.target.value)}>
                    {DEPARTMENT_OPTIONS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Designation" value={profile.Designation} onChange={(e) => handleProfileChange('Designation', e.target.value)} fullWidth size="small" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Employment type</InputLabel>
                  <Select label="Employment type" value={profile.EmployeeType} onChange={(e) => handleProfileChange('EmployeeType', e.target.value)}>
                    {EMPLOYEE_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Joining date" type="date" value={profile.JoiningDate || ''} onChange={(e) => handleProfileChange('JoiningDate', e.target.value)} fullWidth size="small" InputLabelProps={{ shrink: true }} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Date of birth" type="date" value={profile.DateOfBirth || ''} onChange={(e) => handleProfileChange('DateOfBirth', e.target.value)} fullWidth size="small" InputLabelProps={{ shrink: true }} />
              </Grid>
              <Grid item xs={12}>
                <TextField label="Address" value={profile.Address} onChange={(e) => handleProfileChange('Address', e.target.value)} fullWidth size="small" multiline rows={2} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Reporting manager</InputLabel>
                  <Select
                    label="Reporting manager"
                    value={profile.ReportingManager || ''}
                    onChange={(e) => handleProfileChange('ReportingManager', e.target.value)}
                  >
                    <MenuItem value=""><em>None</em></MenuItem>
                    {allEmployees
                      .filter((e) => e.id !== employeeId)
                      .map((e) => (
                        <MenuItem key={e.id} value={e.full_name || e.email}>{e.full_name || e.email}</MenuItem>
                      ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Salary grade" value={profile.SalaryGrade} onChange={(e) => handleProfileChange('SalaryGrade', e.target.value)} fullWidth size="small" />
              </Grid>
            </Grid>

            {/* Collapsible: Education */}
            <Divider sx={{ my: 2.5 }} />
            <Stack direction="row" alignItems="center" justifyContent="space-between"
              sx={{ cursor: 'pointer' }} onClick={() => setShowEducation((v) => !v)}>
              <Stack direction="row" spacing={1} alignItems="center">
                <School fontSize="small" color="action" />
                <Typography variant="subtitle1" fontWeight={700}>Education & skills</Typography>
              </Stack>
              <IconButton size="small">{showEducation ? <ExpandLess /> : <ExpandMore />}</IconButton>
            </Stack>
            <Collapse in={showEducation} unmountOnExit>
              <Grid container spacing={2} sx={{ mt: 0.5 }}>
                <Grid item xs={12} sm={6}><TextField label="Highest qualification" value={profile.HighestQualification} onChange={(e) => handleProfileChange('HighestQualification', e.target.value)} fullWidth size="small" /></Grid>
                <Grid item xs={12} sm={6}><TextField label="University / Institute" value={profile.University} onChange={(e) => handleProfileChange('University', e.target.value)} fullWidth size="small" /></Grid>
                <Grid item xs={12} sm={6}><TextField label="Graduation year" value={profile.GraduationYear} onChange={(e) => handleProfileChange('GraduationYear', e.target.value)} fullWidth size="small" /></Grid>
                <Grid item xs={12} sm={6}><TextField label="Specialization" value={profile.Specialization} onChange={(e) => handleProfileChange('Specialization', e.target.value)} fullWidth size="small" /></Grid>
                <Grid item xs={12} sm={6}><TextField label="Experience" value={profile.Experience} onChange={(e) => handleProfileChange('Experience', e.target.value)} fullWidth size="small" placeholder="e.g. 3 Years" /></Grid>
                <Grid item xs={12}><TextField label="Skills" value={profile.Skills} onChange={(e) => handleProfileChange('Skills', e.target.value)} fullWidth size="small" multiline rows={2} /></Grid>
                <Grid item xs={12}><TextField label="Certifications" value={profile.Certifications} onChange={(e) => handleProfileChange('Certifications', e.target.value)} fullWidth size="small" multiline rows={2} /></Grid>
              </Grid>
            </Collapse>

            {/* Collapsible: Bank */}
            <Divider sx={{ my: 2.5 }} />
            <Stack direction="row" alignItems="center" justifyContent="space-between"
              sx={{ cursor: 'pointer' }} onClick={() => setShowBank((v) => !v)}>
              <Stack direction="row" spacing={1} alignItems="center">
                <AccountBalanceWallet fontSize="small" color="action" />
                <Typography variant="subtitle1" fontWeight={700}>Bank & payment</Typography>
              </Stack>
              <IconButton size="small">{showBank ? <ExpandLess /> : <ExpandMore />}</IconButton>
            </Stack>
            <Collapse in={showBank} unmountOnExit>
              <Grid container spacing={2} sx={{ mt: 0.5 }}>
                <Grid item xs={12} sm={6}><TextField label="Account holder name" value={profile.AccountHolderName} onChange={(e) => handleProfileChange('AccountHolderName', e.target.value)} fullWidth size="small" /></Grid>
                <Grid item xs={12} sm={6}><TextField label="Bank name" value={profile.BankName} onChange={(e) => handleProfileChange('BankName', e.target.value)} fullWidth size="small" /></Grid>
                <Grid item xs={12} sm={6}><TextField label="Account number" value={profile.AccountNumber} onChange={(e) => handleProfileChange('AccountNumber', e.target.value)} fullWidth size="small" /></Grid>
                <Grid item xs={12} sm={6}><TextField label="IFSC code" value={profile.IfscCode} onChange={(e) => handleProfileChange('IfscCode', e.target.value)} fullWidth size="small" /></Grid>
                <Grid item xs={12} sm={6}><TextField label="Bank branch" value={profile.BankBranch} onChange={(e) => handleProfileChange('BankBranch', e.target.value)} fullWidth size="small" /></Grid>
                <Grid item xs={12} sm={6}><TextField label="UPI ID" value={profile.UpiId} onChange={(e) => handleProfileChange('UpiId', e.target.value)} fullWidth size="small" /></Grid>
              </Grid>
            </Collapse>

            <Stack direction="row" justifyContent="flex-end" mt={3}>
              <Button variant="contained" startIcon={<SaveIcon />} onClick={() => void handleSaveProfile()} disabled={saving || !profile.Email}>
                {saving ? 'Saving…' : 'Save profile'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* ---------------- TAB 2: ACCESS & PERMISSIONS ---------------- */}
      {tab === 2 && (
        <Stack spacing={2.5}>
          {/* Quick setup */}
          <Card variant="outlined" sx={{ borderRadius: 3, borderColor: 'primary.light' }}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
                <FlashOn fontSize="small" color="primary" />
                <Typography variant="h6" fontWeight={700}>Quick setup</Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">Apply a role preset in one click, then fine-tune below.</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                {Object.keys(ROLE_PRESETS).map((k) => (
                  <Button key={k} size="small" variant="outlined" onClick={() => applyPreset(k)} disabled={!canAssignPermissions}>{`Apply ${k}`}</Button>
                ))}
              </Stack>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }} alignItems="center">
                <Button size="small" variant="contained" color="success" startIcon={<VerifiedUser />} onClick={handleFullAccess} disabled={!canAssignPermissions}>Full access</Button>
                <Button size="small" variant="outlined" color="warning" startIcon={<Block />} onClick={handleClearAll} disabled={!canAssignPermissions}>Clear all</Button>
                <FormControl size="small" sx={{ minWidth: 200 }}>
                  <InputLabel>Copy from…</InputLabel>
                  <Select label="Copy from…" value="" onChange={(e) => copyFrom(e.target.value)} disabled={!canAssignPermissions}
                    renderValue={() => 'Copy from…'}>
                    {allEmployees.filter((e) => e.id !== employeeId).map((e) => (
                      <MenuItem key={e.id} value={e.id}><ContentCopy fontSize="small" sx={{ mr: 1 }} />{e.full_name || e.email}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            </CardContent>
          </Card>

          {/* Module access matrix */}
          <Card variant="outlined" sx={{ borderRadius: 3 }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
                <Typography variant="h6" fontWeight={700}>Module access</Typography>
                <Chip size="small" variant="outlined" color="info" label={`${visibleModules.length} of ${moduleDraft.length} on`} />
              </Stack>
              <Stack spacing={1}>
                {moduleDraft.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>No modules configured.</Typography>
                )}
                {moduleDraft.map((row) => {
                  const meta = moduleMeta(row.module_key);
                  const Icon = meta.icon;
                  const on = Boolean(row.can_view);
                  return (
                    <Paper
                      key={row.module_id} variant="outlined"
                      sx={{
                        p: 1.5, borderRadius: 2,
                        borderColor: on ? `${meta.color}.light` : 'divider',
                        bgcolor: (t) => (on ? alpha(t.palette[meta.color].main, 0.06) : 'background.paper'),
                        transition: 'border-color .15s, background-color .15s',
                      }}
                    >
                      <Stack direction="row" alignItems="center" spacing={1.5}>
                        <Avatar variant="rounded" sx={{
                          width: 38, height: 38,
                          bgcolor: (t) => alpha(t.palette[meta.color].main, on ? 0.16 : 0.08),
                          color: on ? `${meta.color}.dark` : 'text.disabled',
                        }}>
                          <Icon fontSize="small" />
                        </Avatar>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={on ? 700 : 500} noWrap>{row.module_name}</Typography>
                          <Typography variant="caption" color="text.secondary">{on ? 'Visible after login' : 'Hidden'}</Typography>
                        </Box>
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <Typography variant="caption" color={on ? `${meta.color}.dark` : 'text.disabled'} fontWeight={600}>Access</Typography>
                          <Switch
                            color={meta.color}
                            checked={on}
                            disabled={!canAssignPermissions}
                            onChange={(e) => handleDraftChange(row.module_id, 'can_view', e.target.checked)}
                          />
                        </Stack>
                      </Stack>
                      <Collapse in={on} unmountOnExit>
                        <Box sx={{ pl: { sm: 7 }, pt: 1.25 }}>
                          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
                            <Typography variant="caption" color="text.secondary">Can also:</Typography>
                            {ACTIONS.filter((a) => a !== 'can_view').map((a) => (
                              <FormControlLabel
                                key={a}
                                sx={{ m: 0 }}
                                control={(
                                  <Checkbox
                                    size="small"
                                    color={meta.color}
                                    checked={Boolean(row[a])}
                                    disabled={!canAssignPermissions || !on}
                                    onChange={(e) => handleDraftChange(row.module_id, a, e.target.checked)}
                                  />
                                )}
                                label={<Typography variant="body2">{ACTION_LABEL[a]}</Typography>}
                              />
                            ))}
                          </Stack>
                        </Box>
                      </Collapse>
                    </Paper>
                  );
                })}
              </Stack>
            </CardContent>
          </Card>

          {/* What they'll see */}
          <Card variant="outlined" sx={{ borderRadius: 3, borderColor: 'info.light', bgcolor: (t) => alpha(t.palette.info.main, 0.05) }}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={1} mb={1.25}>
                <Visibility fontSize="small" color="info" />
                <Typography variant="subtitle1" fontWeight={700}>What {profile.EmployeeName || 'this person'} will see after login</Typography>
              </Stack>
              {visibleModules.length === 0 ? (
                <Alert severity="warning" sx={{ py: 0.5 }}>No modules selected — they will log in to an empty ERP.</Alert>
              ) : (
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  {visibleModules.map((m) => {
                    const Icon = moduleMeta(m.module_key).icon;
                    return (
                      <Chip key={m.module_id} color="info" variant="outlined" label={m.module_name}
                        icon={<Icon sx={{ fontSize: 16 }} />} sx={{ fontWeight: 600, bgcolor: 'background.paper' }} />
                    );
                  })}
                </Stack>
              )}
            </CardContent>
          </Card>

          {/* Save bar */}
          <Paper variant="outlined" sx={{ borderRadius: 3, p: 2, position: 'sticky', bottom: 12, bgcolor: 'background.paper', boxShadow: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
              <Typography variant="body2" color="text.secondary">
                {visibleModules.length} module{visibleModules.length === 1 ? '' : 's'} selected — changes apply when you save.
              </Typography>
              <Button variant="contained" size="large" startIcon={<SaveIcon />} disabled={saving || !canAssignPermissions || !employeeId} onClick={() => void handleSaveAccess()}>
                {saving ? 'Saving…' : 'Save access'}
              </Button>
            </Stack>
          </Paper>
        </Stack>
      )}

      {/* ---------------- TAB 3: DOCUMENTS ---------------- */}
      {tab === 3 && (
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" useFlexGap>
              <Stack direction="row" alignItems="center" spacing={1}>
                <FolderOpen color="action" />
                <Typography variant="h6" fontWeight={700}>Documents</Typography>
              </Stack>
              <Tooltip title="Document upload is coming soon">
                <span>
                  <Button size="small" variant="outlined" startIcon={<CloudUpload />} disabled>Upload (coming soon)</Button>
                </span>
              </Tooltip>
            </Stack>

            {docsLoading ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>Loading documents…</Typography>
            ) : documents.length === 0 ? (
              <Box sx={{ py: 6, textAlign: 'center' }}>
                <Avatar sx={{ width: 56, height: 56, mx: 'auto', mb: 2, bgcolor: (t) => alpha(t.palette.primary.main, 0.12), color: 'primary.main' }}>
                  <InsertDriveFile />
                </Avatar>
                <Typography variant="subtitle1" fontWeight={700}>No documents yet</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, mx: 'auto', mt: 0.5 }}>
                  Contracts, ID proofs and certificates for this employee will live here. Upload is on the way.
                </Typography>
              </Box>
            ) : (
              <Stack spacing={1}>
                {documents.map((doc) => (
                  <Paper key={doc.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Avatar variant="rounded" sx={{ bgcolor: (t) => alpha(t.palette.primary.main, 0.1), color: 'primary.main' }}>
                      <InsertDriveFile fontSize="small" />
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {doc.file_name || doc.name || doc.document_type || 'Document'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {[doc.document_type, fmtDate(doc.created_at)].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                  </Paper>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------------- TAB 4: ATTENDANCE ---------------- */}
      {tab === 4 && (
        <ComingSoonPanel
          icon={EventAvailable}
          title="Attendance"
          line="Daily check-in/out, shifts and monthly summaries for this employee will appear here."
        />
      )}

      {/* ---------------- TAB 5: LEAVE ---------------- */}
      {tab === 5 && (
        <ComingSoonPanel
          icon={BeachAccess}
          title="Leave"
          line="Leave balances, requests and approvals for this employee will appear here."
        />
      )}

      {/* ---------------- TAB 6: PERFORMANCE ---------------- */}
      {tab === 6 && <PerformanceTab employee={employee} />}

      {/* ---------------- TAB 7: ACTIVITY ---------------- */}
      {tab === 7 && (
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={1} mb={2.5}>
              <History color="action" />
              <Typography variant="h6" fontWeight={700}>Activity</Typography>
            </Stack>
            <Stack spacing={0} sx={{ position: 'relative', pl: 2 }}>
              <Box sx={{ position: 'absolute', left: 7, top: 6, bottom: 6, width: 2, bgcolor: 'divider' }} />
              {[
                employee?.updated_at && { label: 'Profile last updated', at: employee.updated_at },
                employee?.joining_date && { label: 'Joined the company', at: employee.joining_date },
                employee?.created_at && { label: 'Record created', at: employee.created_at },
              ].filter(Boolean).map((item, i) => (
                <Stack key={i} direction="row" spacing={2} sx={{ position: 'relative', py: 1 }}>
                  <Box sx={{
                    width: 16, height: 16, borderRadius: '50%', mt: 0.5, flexShrink: 0,
                    bgcolor: 'primary.main', border: '2px solid', borderColor: 'background.paper', zIndex: 1,
                  }} />
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{item.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{fmtDate(item.at)}</Typography>
                  </Box>
                </Stack>
              ))}
              {!employee?.updated_at && !employee?.created_at && !employee?.joining_date && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                  No activity recorded yet — changes you make will show up here over time.
                </Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Snackbar
        open={Boolean(success)} autoHideDuration={3500} onClose={() => setSuccess(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setSuccess(null)}>{success}</Alert>
      </Snackbar>
    </Box>
  );
}

export default EmployeeProfile;
