// "View as user" — CEO/admin read-only preview of any employee's access:
// effective module permissions + the exact left-nav they would see.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container, Box, Stack, Typography, Card, Chip, Autocomplete, TextField,
  Table, TableHead, TableRow, TableCell, TableBody, CircularProgress, Alert, Grid, Divider,
} from '@mui/material';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import accessPreview from '../../services/accessPreviewService';
import { NAV_GROUPS, basePath } from '../../components/nav/navConfig';
import { getModuleKeyForPath } from '../../config/moduleAccess';

const ACTIONS = [['can_view', 'View'], ['can_create', 'Create'], ['can_edit', 'Edit'], ['can_delete', 'Delete']];

export default function AccessPreview() {
  const [employees, setEmployees] = useState([]);
  const [sel, setSel] = useState(null);
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { (async () => {
    try { setEmployees(await accessPreview.listEmployees()); } catch (e) { setErr(e.message); } finally { setLoading(false); }
  })(); }, []);

  const load = useCallback(async (email) => {
    setBusy(true); setAccess(null);
    try {
      const a = await accessPreview.getAccess(email);
      if (a?.error) setErr('Only admins can preview access.'); else { setErr(null); setAccess(a); }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }, []);

  // module_key -> permission object the previewed user has
  const permByModule = useMemo(() => {
    const m = {};
    (access?.modules || []).forEach((mod) => { m[mod.module_key] = mod; });
    return m;
  }, [access]);

  // Which nav items this user would see (mirrors SidebarNav gating).
  const visibleNav = useMemo(() => {
    if (!access) return [];
    const canDo = (key, action) => {
      const p = permByModule[key];
      return !!(p && p[action === 'edit' ? 'can_edit' : action === 'create' ? 'can_create' : action === 'delete' ? 'can_delete' : 'can_view']);
    };
    return NAV_GROUPS.map((g) => ({
      label: g.label,
      items: g.items.filter((it) => {
        const key = it.moduleKey || getModuleKeyForPath(basePath(it.path));
        if (!key) return true;
        if (it.requireEdit) return canDo(key, 'edit');
        if (it.requireCreate) return canDo(key, 'create');
        if (it.requireDelete) return canDo(key, 'delete');
        return canDo(key, 'view');
      }).map((it) => it.label),
    })).filter((g) => g.items.length);
  }, [access, permByModule]);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <VisibilityOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>View as User</Typography>
        <Chip size="small" variant="outlined" label="access preview" color="primary" />
      </Stack>
      <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
        Read-only preview of what an employee can access — their effective permissions and the exact menu they'd see. This is <strong>not</strong> a login; to operate the app, each user signs in with their own account.
      </Alert>

      {loading ? <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack> : (
        <>
          <Card variant="outlined" sx={{ borderRadius: 2, p: 2, mb: 2 }}>
            <Autocomplete
              size="small" options={employees} value={sel}
              getOptionLabel={(o) => `${o.full_name || o.email} — ${o.role_name}${o.is_active ? '' : ' (inactive)'}`}
              isOptionEqualToValue={(a, b) => a.email === b.email}
              onChange={(e, v) => { setSel(v); if (v) load(v.email); else setAccess(null); }}
              renderInput={(params) => <TextField {...params} label="Select an employee to preview" placeholder="Search…" />}
            />
          </Card>

          {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
          {busy && <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={22} /></Stack>}

          {access && access.employee && (
            <Grid container spacing={2}>
              <Grid item xs={12} md={7}>
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <Box sx={{ px: 2, py: 1.25, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{access.employee.full_name || access.employee.email}</Typography>
                    <Chip size="small" label={access.employee.role_name} variant="outlined" />
                    {access.is_admin && <Chip size="small" color="error" label="Super-admin (sees all)" />}
                    {!access.employee.is_active && <Chip size="small" color="warning" label="Inactive" />}
                  </Box>
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableHead><TableRow>{['Module', ...ACTIONS.map((a) => a[1])].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }} align={h === 'Module' ? 'left' : 'center'}>{h}</TableCell>)}</TableRow></TableHead>
                      <TableBody>{access.modules.map((m) => (
                        <TableRow key={m.module_key} hover>
                          <TableCell sx={{ fontWeight: 600, textTransform: 'capitalize' }}>{m.module_name || m.module_key}</TableCell>
                          {ACTIONS.map(([k]) => <TableCell key={k} align="center">{m[k] ? <Chip size="small" color="success" label="✓" sx={{ height: 18, '& .MuiChip-label': { px: 0.75 } }} /> : <Typography variant="caption" color="text.disabled">—</Typography>}</TableCell>)}
                        </TableRow>
                      ))}</TableBody>
                    </Table>
                  </Box>
                  {access.modules.length === 0 && <Box sx={{ p: 2 }}><Alert severity="warning">This user has no module access — they'd see an empty app. Assign a role or permissions.</Alert></Box>}
                </Card>
              </Grid>

              <Grid item xs={12} md={5}>
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <Box sx={{ px: 2, py: 1.25, bgcolor: 'action.hover' }}><Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Menu they would see</Typography></Box>
                  <Box sx={{ p: 1.5 }}>
                    {visibleNav.length === 0 ? <Typography variant="body2" color="text.secondary">No menu items visible.</Typography> : visibleNav.map((g) => (
                      <Box key={g.label} sx={{ mb: 1 }}>
                        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'primary.main', fontSize: '0.62rem' }}>{g.label}</Typography>
                        <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ gap: 0.5, mt: 0.25 }}>
                          {g.items.map((i) => <Chip key={i} size="small" variant="outlined" label={i} sx={{ fontSize: '0.65rem' }} />)}
                        </Stack>
                        <Divider sx={{ mt: 1 }} />
                      </Box>
                    ))}
                  </Box>
                </Card>
              </Grid>
            </Grid>
          )}
        </>
      )}
    </Container>
  );
}
