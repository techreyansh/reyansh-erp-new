// Access Audit — CEO/admin read-only, ALL users x ALL modules in one grid.
// Each cell shows the effective access and WHERE it comes from (role vs a
// per-person override vs super-admin), so silent over-provisioning — a module
// granted to someone by a lingering override, beyond what their role gives — is
// visible at a glance. Backed by the rbac_access_audit() RPC. Read-only.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container, Box, Stack, Typography, Card, Paper, Chip, Avatar, Tooltip,
  Table, TableHead, TableRow, TableCell, TableBody, TextField, MenuItem,
  FormControlLabel, Switch, CircularProgress, Alert, alpha,
} from '@mui/material';
import VerifiedUserOutlined from '@mui/icons-material/VerifiedUserOutlined';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import BlockOutlined from '@mui/icons-material/BlockOutlined';
import accessAudit from '../../services/accessAuditService';
import ReportExportButton from '../../components/common/ReportExportButton';
import { MODULE_KEYS, MODULE_UNLOCKS } from '../../config/moduleAccess';

// Stable column order = the canonical module list.
const MODULES = Object.values(MODULE_KEYS);
const moduleLabel = (key) => key.charAt(0).toUpperCase() + key.slice(1);
const ACTIONS = [['can_view', 'V'], ['can_create', 'C'], ['can_edit', 'E'], ['can_delete', 'D']];

// Per-source cell styling (chip). Neutral grey = from role; amber = a per-person
// override; blue = super-admin (sees everything regardless of grants).
const SOURCE_STYLE = {
  role: { label: 'Role', chip: { variant: 'outlined', sx: { borderColor: 'divider', color: 'text.secondary' } } },
  override: { label: 'Override', chip: { color: 'warning', sx: {} } },
  'role+override': { label: 'Role + override', chip: { color: 'warning', variant: 'outlined', sx: {} } },
  super_admin: { label: 'Super-admin', chip: { color: 'info', sx: {} } },
};

const actsString = (m) => ACTIONS.filter(([k]) => m[k]).map(([, l]) => l).join('');

export default function AccessAudit() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // filters
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const [role, setRole] = useState('all');
  const [activeOnly, setActiveOnly] = useState(true);

  useEffect(() => { (async () => {
    try {
      const res = await accessAudit.getAudit();
      if (res.error) setErr('Only admins can view the access audit.');
      else setUsers(res.users);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  })(); }, []);

  const departments = useMemo(
    () => Array.from(new Set(users.map((u) => u.employee.department).filter(Boolean))).sort(),
    [users],
  );
  const roles = useMemo(
    () => Array.from(new Set(users.map((u) => u.employee.role_name).filter(Boolean))).sort(),
    [users],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => {
      const e = u.employee;
      if (activeOnly && !e.is_active) return false;
      if (dept !== 'all' && e.department !== dept) return false;
      if (role !== 'all' && e.role_name !== role) return false;
      if (needle && !`${e.full_name || ''} ${e.email || ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [users, q, dept, role, activeOnly]);

  // module_key -> module object, per user row
  const byModule = useCallback((u) => {
    const m = {};
    (u.modules || []).forEach((mod) => { m[mod.module_key] = mod; });
    return m;
  }, []);

  const stats = useMemo(() => {
    const withAccess = filtered.filter((u) => (u.modules || []).length > 0).length;
    const overProvisioned = filtered.filter((u) => (u.overrides_beyond_role || 0) > 0).length;
    const inactiveWithAccess = filtered.filter((u) => !u.employee.is_active && (u.modules || []).length > 0).length;
    return { total: filtered.length, withAccess, overProvisioned, inactiveWithAccess };
  }, [filtered]);

  const buildReport = () => ({
    key: 'access-audit', title: 'Access Audit',
    subtitle: 'Reyansh International — effective module access by user',
    generatedAt: new Date(),
    sections: [{
      key: 'a', title: 'Effective module access (all users)',
      columns: [
        { key: 'user', label: 'User' }, { key: 'email', label: 'Email' },
        { key: 'role', label: 'Role' }, { key: 'active', label: 'Active' },
        { key: 'module_count', label: '# Modules' }, { key: 'beyond_role', label: 'Beyond role' },
        ...MODULES.map((k) => ({ key: k, label: moduleLabel(k) })),
      ],
      rows: filtered.map((u) => {
        const map = byModule(u);
        const cells = {};
        MODULES.forEach((k) => {
          const mod = map[k];
          cells[k] = mod ? `${actsString(mod)} (${mod.source})` : '';
        });
        return {
          user: u.employee.full_name || u.employee.email,
          email: u.employee.email,
          role: u.employee.role_name,
          active: u.employee.is_active ? 'Yes' : 'No',
          module_count: (u.modules || []).length,
          beyond_role: u.overrides_beyond_role || 0,
          ...cells,
        };
      }),
    }],
  });

  return (
    <Container maxWidth={false} sx={{ py: 3, maxWidth: 1600, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
        <VerifiedUserOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Access Audit</Typography>
        <Chip size="small" variant="outlined" color="primary" label="CEO only" />
        <Box sx={{ flexGrow: 1 }} />
        {!loading && !err && <ReportExportButton buildReport={buildReport} label="Export" />}
      </Stack>
      <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
        Read-only view of <strong>every</strong> user's effective module access in one grid. Each cell shows the
        actions granted (V·iew / C·reate / E·dit / D·elete) and its <strong>source</strong>. Access is additive
        (<em>super-admin OR role OR per-person override</em>) — an <Chip size="small" color="warning" label="override" sx={{ height: 18 }} /> beyond
        what the role grants is the over-provisioning signal. Click a user to inspect them in “View as User”.
      </Alert>

      {loading ? (
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>
      ) : err ? (
        <Alert severity="error">{err}</Alert>
      ) : (
        <>
          {/* Summary tiles (inline StatCard pattern — not KPICard) */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
            <StatCard label="Users" value={stats.total} color="primary" icon={<GroupsOutlined fontSize="small" />} />
            <StatCard label="With access" value={stats.withAccess} color="info" icon={<VisibilityOutlined fontSize="small" />} />
            <StatCard label="Over-provisioned (beyond role)" value={stats.overProvisioned} color="warning" icon={<WarningAmberOutlined fontSize="small" />} />
            <StatCard label="Inactive but has access" value={stats.inactiveWithAccess} color="error" icon={<BlockOutlined fontSize="small" />} />
          </Stack>

          {/* Filters */}
          <Card variant="outlined" sx={{ borderRadius: 2, p: 1.5, mb: 2 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
              <TextField size="small" label="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} sx={{ minWidth: 220 }} />
              <TextField size="small" select label="Department" value={dept} onChange={(e) => setDept(e.target.value)} sx={{ minWidth: 160 }}>
                <MenuItem value="all">All departments</MenuItem>
                {departments.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
              </TextField>
              <TextField size="small" select label="Role" value={role} onChange={(e) => setRole(e.target.value)} sx={{ minWidth: 180 }}>
                <MenuItem value="all">All roles</MenuItem>
                {roles.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
              </TextField>
              <FormControlLabel control={<Switch checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />} label="Active only" />
              <Box sx={{ flexGrow: 1 }} />
              <Legend />
            </Stack>
          </Card>

          {/* Grid */}
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" stickyHeader sx={{ '& td, & th': { whiteSpace: 'nowrap' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800, fontSize: '0.72rem', position: 'sticky', left: 0, zIndex: 3, bgcolor: 'background.paper' }}>User</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 800, fontSize: '0.72rem' }}>Beyond role</TableCell>
                    {MODULES.map((k) => (
                      <Tooltip key={k} title={(MODULE_UNLOCKS[k] || []).join(' · ')} arrow>
                        <TableCell align="center" sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'capitalize' }}>{moduleLabel(k)}</TableCell>
                      </Tooltip>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map((u) => {
                    const map = byModule(u);
                    const beyond = u.overrides_beyond_role || 0;
                    return (
                      <TableRow key={u.employee.id} hover sx={{ cursor: 'pointer' }}
                        onClick={() => navigate(`/access-preview?email=${encodeURIComponent(u.employee.email)}`)}>
                        <TableCell sx={{ position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper' }}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
                                {u.employee.full_name || u.employee.email}
                              </Typography>
                              <Stack direction="row" spacing={0.5} alignItems="center">
                                <Chip size="small" variant="outlined" label={u.employee.role_name} sx={{ height: 17, fontSize: '0.6rem' }} />
                                {u.is_admin && <Chip size="small" color="info" label="super-admin" sx={{ height: 17, fontSize: '0.6rem' }} />}
                                {!u.employee.is_active && <Chip size="small" color="default" label="inactive" sx={{ height: 17, fontSize: '0.6rem' }} />}
                              </Stack>
                            </Box>
                          </Stack>
                        </TableCell>
                        <TableCell align="center">
                          {beyond > 0
                            ? <Tooltip title={`${beyond} module(s) granted by a per-person override beyond this user's role`} arrow>
                                <Chip size="small" color="warning" icon={<WarningAmberOutlined sx={{ fontSize: 14 }} />} label={beyond} sx={{ height: 20 }} />
                              </Tooltip>
                            : <Typography variant="caption" color="text.disabled">—</Typography>}
                        </TableCell>
                        {MODULES.map((k) => <TableCell key={k} align="center"><AccessCell mod={map[k]} /></TableCell>)}
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={MODULES.length + 2}>
                      <Box sx={{ p: 2 }}><Alert severity="info">No users match the current filters.</Alert></Box>
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </Card>
        </>
      )}
    </Container>
  );
}

function AccessCell({ mod }) {
  if (!mod) return <Typography variant="caption" color="text.disabled">—</Typography>;
  const style = SOURCE_STYLE[mod.source] || SOURCE_STYLE.role;
  const acts = actsString(mod);
  return (
    <Tooltip arrow title={`${acts.split('').map((a) => ({ V: 'View', C: 'Create', E: 'Edit', D: 'Delete' }[a])).join(', ')} — ${style.label}`}>
      <Chip size="small" label={acts || '✓'} {...style.chip}
        sx={{ height: 20, fontWeight: 700, fontSize: '0.62rem', '& .MuiChip-label': { px: 0.75 }, ...(style.chip.sx || {}) }} />
    </Tooltip>
  );
}

function Legend() {
  const items = [['role', 'Role'], ['override', 'Override'], ['role+override', 'Role + override'], ['super_admin', 'Super-admin']];
  return (
    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
      {items.map(([src, label]) => {
        const s = SOURCE_STYLE[src];
        return <Chip key={src} size="small" label={label} {...s.chip} sx={{ height: 20, fontSize: '0.6rem', ...(s.chip.sx || {}) }} />;
      })}
    </Stack>
  );
}

function StatCard({ label, value, color, icon }) {
  return (
    <Paper variant="outlined" elevation={0} sx={{ p: 2, borderRadius: 2, flex: 1 }}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Avatar variant="rounded" sx={{ bgcolor: (t) => alpha(t.palette[color].main, 0.14), color: `${color}.dark`, width: 40, height: 40 }}>{icon}</Avatar>
        <Box>
          <Typography variant="h5" fontWeight={800} lineHeight={1}>{value}</Typography>
          <Typography variant="caption" color="text.secondary">{label}</Typography>
        </Box>
      </Stack>
    </Paper>
  );
}
