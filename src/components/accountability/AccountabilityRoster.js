import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, MenuItem, Paper, Select, Snackbar, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
  Typography, alpha, InputAdornment, Tooltip,
} from '@mui/material';
import {
  GroupsOutlined, SyncOutlined, SearchOutlined, CheckCircleOutline, RemoveCircleOutline,
} from '@mui/icons-material';
import {
  getRoster, getRoles, syncEmployees, assignRole, subscribeScorecard,
} from '../../services/accountabilityService';

const BAND = { GREEN: '#059669', AMBER: '#D97706', RED: '#C0392B' };

/**
 * The accountability register: every ERP employee, their role, login status, and
 * live current-week score. "Sync ERP employees" pulls the employee master in;
 * scores stream live as scorecards are edited anywhere in the ERP.
 */
const AccountabilityRoster = () => {
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [q, setQ] = useState('');
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [r, rl] = await Promise.all([getRoster(), getRoles()]);
      setRows(r);
      setRoles(rl);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live: any scorecard change refreshes the roster (debounced).
  useEffect(() => {
    const unsub = subscribeScorecard(null, () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(load, 600);
    });
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); unsub?.(); };
  }, [load]);

  const sync = async () => {
    setSyncing(true); setError(null);
    try {
      const added = await syncEmployees();
      await load();
      setToast(added > 0 ? `${added} employee(s) added to the register.` : 'Register is up to date.');
    } catch (e) { setError(e.message); } finally { setSyncing(false); }
  };

  const changeRole = async (row, code) => {
    try {
      await assignRole(row.employee_id, code);
      setRows((prev) => prev.map((x) => x.employee_id === row.employee_id
        ? { ...x, role_code: code, role_name: roles.find((r) => r.code === code)?.name } : x));
      setToast(`Role updated for ${row.full_name}.`);
    } catch (e) { setError(e.message); }
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.full_name, r.email, r.employee_code, r.role_name]
      .some((v) => (v || '').toLowerCase().includes(s)));
  }, [rows, q]);

  const assigned = rows.filter((r) => r.role_code).length;
  const withLogin = rows.filter((r) => r.has_login).length;

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
      <Box sx={{ p: 2, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <GroupsOutlined color="primary" />
          <Box>
            <Typography variant="subtitle1" fontWeight={800}>Team register</Typography>
            <Typography variant="caption" color="text.secondary">
              {rows.length} employees · {assigned} with a role · {withLogin} linked to a login
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <TextField
            size="small" placeholder="Search name, role, code…" value={q}
            onChange={(e) => setQ(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchOutlined fontSize="small" /></InputAdornment> }}
            sx={{ width: { xs: '100%', sm: 260 } }}
          />
          <Button variant="contained" startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <SyncOutlined />}
                  onClick={sync} disabled={syncing}>
            Sync ERP employees
          </Button>
        </Stack>
      </Box>

      {error && <Alert severity="error" sx={{ mx: 2, mb: 1 }} onClose={() => setError(null)}>{error}</Alert>}

      <TableContainer>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow sx={{ '& th': { bgcolor: 'grey.100', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'text.secondary', whiteSpace: 'nowrap' } }}>
              <TableCell>Employee</TableCell>
              <TableCell>Role</TableCell>
              <TableCell align="center">Login</TableCell>
              <TableCell align="center">This week</TableCell>
              <TableCell align="center">Band</TableCell>
              <TableCell align="center">Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.employee_id} hover sx={{ opacity: r.is_active ? 1 : 0.5 }}>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>{r.full_name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {[r.employee_code, r.email].filter(Boolean).join(' · ') || '—'}
                  </Typography>
                </TableCell>
                <TableCell sx={{ minWidth: 200 }}>
                  <Select
                    size="small" value={r.role_code || ''} displayEmpty fullWidth variant="standard"
                    onChange={(e) => changeRole(r, e.target.value)}
                    sx={{ fontSize: 13, ...(r.role_code ? {} : { color: 'warning.main' }) }}
                  >
                    <MenuItem value="" disabled><em>Assign a role…</em></MenuItem>
                    {roles.map((role) => <MenuItem key={role.code} value={role.code}>{role.name}</MenuItem>)}
                  </Select>
                </TableCell>
                <TableCell align="center">
                  {r.has_login
                    ? <Tooltip title="Linked to a login"><CheckCircleOutline sx={{ color: '#059669', fontSize: 18 }} /></Tooltip>
                    : <Tooltip title="No login linked yet"><RemoveCircleOutline sx={{ color: 'text.disabled', fontSize: 18 }} /></Tooltip>}
                </TableCell>
                <TableCell align="center">
                  <Typography variant="body2" fontWeight={700} sx={{ color: BAND[r.band] || 'text.disabled' }}>
                    {r.score != null ? `${r.score}%` : '—'}
                  </Typography>
                </TableCell>
                <TableCell align="center">
                  {r.band
                    ? <Chip size="small" label={r.band} sx={{ fontWeight: 800, height: 22, color: BAND[r.band], bgcolor: alpha(BAND[r.band], 0.14) }} />
                    : <Typography variant="caption" color="text.disabled">—</Typography>}
                </TableCell>
                <TableCell align="center">
                  <Typography variant="caption" color="text.secondary">{r.status || 'Not started'}</Typography>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                  {rows.length === 0
                    ? 'No employees yet — click "Sync ERP employees" to pull in the team.'
                    : 'No match for your search.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)}
                message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Paper>
  );
};

export default AccountabilityRoster;
