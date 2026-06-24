import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Stack, Card, CardContent, Typography, Button, IconButton, Chip, TextField, MenuItem,
  CircularProgress, Snackbar, Alert, Dialog, DialogTitle, DialogContent, DialogActions, Menu,
  Tooltip, ToggleButton, ToggleButtonGroup, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, useTheme, alpha,
} from '@mui/material';
import {
  Science as NpdIcon, Add as AddIcon, Refresh as RefreshIcon, ArrowForward as MoveIcon,
} from '@mui/icons-material';
import npdService, { NPD_STAGES, NPD_STAGE_LABEL } from '../../services/npdService';

const PRIORITY_COLOR = { urgent: 'error', high: 'warning', normal: 'default', low: 'info' };

function daysSince(ts) {
  if (!ts) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 86400000));
}

const NPDDashboard = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [addOpen, setAddOpen] = useState(false);
  const [moveMenu, setMoveMenu] = useState(null); // { anchor, project }
  const [view, setView] = useState('board'); // 'board' | 'list'

  const load = useCallback(async () => {
    setLoading(true);
    try { setProjects(await npdService.listProjects()); }
    catch (e) { setSnackbar({ open: true, message: 'Failed to load: ' + e.message, severity: 'error' }); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const byStage = useMemo(() => {
    const m = Object.fromEntries(NPD_STAGES.map((s) => [s.key, []]));
    projects.forEach((p) => { (m[p.stage] = m[p.stage] || []).push(p); });
    return m;
  }, [projects]);

  const kpis = useMemo(() => {
    const total = projects.length;
    const delayed = projects.filter((p) => p.target_date && new Date(p.target_date) < new Date() && p.status === 'active').length;
    const awaitingFeedback = (byStage.customer_feedback || []).length;
    const approved = projects.filter((p) => p.status === 'approved').length;
    return { total, delayed, awaitingFeedback, approved };
  }, [projects, byStage]);

  const doMove = async (project, toStage, force = false) => {
    try {
      const res = await npdService.moveStage(project.id, toStage, { expectedFrom: project.stage, force });
      if (res && res.ok === false) {
        setSnackbar({ open: true, message: res.message || 'Could not advance.', severity: res.conflict ? 'warning' : 'info' });
      } else {
        setSnackbar({ open: true, message: 'Stage updated.', severity: 'success' });
        await load();
      }
    } catch (e) {
      setSnackbar({ open: true, message: e.message, severity: 'error' });
    }
    setMoveMenu(null);
  };

  const Kpi = ({ label, value, color }) => (
    <Card sx={{ flex: 1, minWidth: 140, borderRadius: 2 }}>
      <CardContent>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 700, color: color || 'text.primary', mt: 0.5 }}>{value}</Typography>
      </CardContent>
    </Card>
  );

  return (
    <Box sx={{ p: 3, height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
      <Card sx={{ background: `linear-gradient(135deg, ${theme.palette.secondary.main} 0%, ${theme.palette.secondary.dark} 100%)`, color: 'white', borderRadius: 3, mb: 2 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, py: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <NpdIcon sx={{ fontSize: 34 }} />
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>Product Development</Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>Customer requirement to approved production release.</Typography>
            </Box>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}
              sx={{ bgcolor: alpha('#fff', 0.15), '& .MuiToggleButton-root': { color: 'white', border: 'none', px: 1.5 }, '& .Mui-selected': { bgcolor: 'white !important', color: theme.palette.secondary.main + ' !important' } }}>
              <ToggleButton value="board">Board</ToggleButton>
              <ToggleButton value="list">List</ToggleButton>
              <ToggleButton value="mgmt">Management</ToggleButton>
            </ToggleButtonGroup>
            <Button onClick={() => setAddOpen(true)} startIcon={<AddIcon />} variant="contained" color="inherit" sx={{ color: theme.palette.secondary.main }}>New project</Button>
            <Tooltip title="Refresh"><IconButton onClick={load} sx={{ color: 'white' }}><RefreshIcon /></IconButton></Tooltip>
          </Stack>
        </CardContent>
      </Card>

      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <Kpi label="Projects" value={kpis.total} />
        <Kpi label="Delayed" value={kpis.delayed} color={theme.palette.error.main} />
        <Kpi label="Awaiting feedback" value={kpis.awaitingFeedback} color={theme.palette.warning.main} />
        <Kpi label="Approved" value={kpis.approved} color={theme.palette.success.main} />
      </Stack>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : view === 'list' ? (
        <ReportTable projects={projects} navigate={navigate} />
      ) : view === 'mgmt' ? (
        <ManagementView projects={projects} navigate={navigate} />
      ) : (
        <Box sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', flex: 1, pb: 1 }}>
          {NPD_STAGES.map((stage) => {
            const items = byStage[stage.key] || [];
            return (
              <Box key={stage.key} sx={{ minWidth: 230, width: 230, flexShrink: 0, bgcolor: alpha(theme.palette.text.primary, 0.03), borderRadius: 2, p: 1 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 0.5, mb: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>{stage.label}</Typography>
                  <Chip size="small" label={items.length} sx={{ height: 18 }} />
                </Stack>
                <Stack spacing={1}>
                  {items.map((p) => (
                    <Card key={p.id} variant="outlined" sx={{ borderRadius: 1.5, cursor: 'pointer', '&:hover': { borderColor: 'secondary.main' } }} onClick={() => navigate(`/npd/${p.id}`)}>
                      <CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{p.product_name}</Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>{p.project_no} · {p.company_name || p.customer_code || '—'}</Typography>
                        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                          {p.priority && p.priority !== 'normal' && <Chip size="small" label={p.priority} color={PRIORITY_COLOR[p.priority]} sx={{ height: 18 }} />}
                          <Chip size="small" variant="outlined" label={`${daysSince(p.stage_entered_at)}d`} sx={{ height: 18 }} />
                          {p.npd_engineer_email && <Typography variant="caption" color="text.secondary" noWrap>{p.npd_engineer_email.split('@')[0]}</Typography>}
                        </Stack>
                        <Button size="small" endIcon={<MoveIcon sx={{ fontSize: 14 }} />} sx={{ mt: 0.5, p: 0, minWidth: 0 }}
                          onClick={(e) => { e.stopPropagation(); setMoveMenu({ anchor: e.currentTarget, project: p }); }}>
                          Move
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                  {items.length === 0 && <Typography variant="caption" color="text.disabled" sx={{ px: 0.5 }}>—</Typography>}
                </Stack>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Move menu — gated transitions */}
      <Menu open={!!moveMenu} anchorEl={moveMenu?.anchor} onClose={() => setMoveMenu(null)}>
        {moveMenu && NPD_STAGES.filter((s) => s.key !== moveMenu.project.stage).map((s) => (
          <MenuItem key={s.key} onClick={() => doMove(moveMenu.project, s.key)} sx={{ fontSize: 13 }}>{s.label}</MenuItem>
        ))}
      </Menu>

      <AddProjectDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={(p) => { setAddOpen(false); load(); navigate(`/npd/${p.id}`); }} notify={setSnackbar} />

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
};

function ManagementView({ projects, navigate }) {
  const now = new Date();
  const isDelayed = (p) => p.target_date && new Date(p.target_date) < now && p.status === 'active';
  const buckets = [
    { label: 'Delayed', color: 'error.main', fn: isDelayed },
    { label: 'Awaiting costing', color: 'warning.main', fn: (p) => p.stage === 'costing_ready' },
    { label: 'Awaiting material', color: 'warning.main', fn: (p) => p.stage === 'material_ready' },
    { label: 'Awaiting dispatch', color: 'info.main', fn: (p) => p.stage === 'sample_dispatch' },
    { label: 'Awaiting approval', color: 'info.main', fn: (p) => p.stage === 'customer_feedback' },
    { label: 'Recently approved', color: 'success.main', fn: (p) => p.status === 'approved' },
  ].map((b) => ({ ...b, count: projects.filter(b.fn).length }));

  const byCust = {};
  projects.forEach((p) => {
    const k = p.company_name || p.customer_code || 'Unassigned';
    const o = (byCust[k] = byCust[k] || { name: k, total: 0, active: 0, approved: 0, delayed: 0 });
    o.total++;
    if (p.status === 'approved') o.approved++; else o.active++;
    if (isDelayed(p)) o.delayed++;
  });
  const customers = Object.values(byCust).sort((a, b) => b.total - a.total);

  return (
    <Box sx={{ overflow: 'auto', flex: 1 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(3,1fr)', md: 'repeat(6,1fr)' }, gap: 1.5, mb: 2 }}>
        {buckets.map((b) => (
          <Card key={b.label} sx={{ borderRadius: 2 }}><CardContent sx={{ py: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.58rem', fontWeight: 700, display: 'block' }}>{b.label}</Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, color: b.count ? b.color : 'text.disabled' }}>{b.count}</Typography>
          </CardContent></Card>
        ))}
      </Box>
      <Card sx={{ borderRadius: 2 }}><CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Developments by customer</Typography>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
          <Table size="small">
            <TableHead><TableRow>{['Customer', 'Developments', 'In progress', 'Approved', 'Delayed'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.name} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{c.name}</TableCell>
                  <TableCell>{c.total}</TableCell>
                  <TableCell>{c.active}</TableCell>
                  <TableCell>{c.approved ? <Chip size="small" color="success" label={c.approved} sx={{ height: 20 }} /> : 0}</TableCell>
                  <TableCell>{c.delayed ? <Chip size="small" color="error" label={c.delayed} sx={{ height: 20 }} /> : 0}</TableCell>
                </TableRow>
              ))}
              {customers.length === 0 && <TableRow><TableCell colSpan={5} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>No developments yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent></Card>
    </Box>
  );
}

function ReportTable({ projects, navigate }) {
  const overdue = (p) => p.target_date && new Date(p.target_date) < new Date() && p.status === 'active';
  return (
    <TableContainer component={Paper} sx={{ borderRadius: 2, flex: 1, overflow: 'auto' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {['Project', 'Product', 'Customer', 'Stage', 'Engineer', 'Target', 'Age', 'Status'].map((h) => (
              <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {projects.map((p) => (
            <TableRow key={p.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/npd/${p.id}`)}>
              <TableCell sx={{ fontWeight: 600 }}>{p.project_no}</TableCell>
              <TableCell>{p.product_name}</TableCell>
              <TableCell>{p.company_name || p.customer_code || '—'}</TableCell>
              <TableCell><Chip size="small" label={NPD_STAGE_LABEL[p.stage] || p.stage} /></TableCell>
              <TableCell>{(p.npd_engineer_email || '').split('@')[0] || '—'}</TableCell>
              <TableCell sx={{ color: overdue(p) ? 'error.main' : 'inherit', fontWeight: overdue(p) ? 700 : 400 }}>
                {p.target_date ? new Date(p.target_date).toLocaleDateString('en-IN') : '—'}
              </TableCell>
              <TableCell>{daysSince(p.stage_entered_at)}d</TableCell>
              <TableCell><Chip size="small" label={p.status} color={p.status === 'approved' ? 'success' : p.status === 'active' ? 'default' : 'warning'} /></TableCell>
            </TableRow>
          ))}
          {projects.length === 0 && (
            <TableRow><TableCell colSpan={8} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>No projects yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function AddProjectDialog({ open, onClose, onCreated, notify }) {
  const blank = { product_name: '', company_name: '', customer_code: '', customer_part_no: '', project_type: 'sample', priority: 'normal', target_date: '', npd_engineer_email: '' };
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm(blank); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    if (!form.product_name.trim()) { notify({ open: true, message: 'Product name is required.', severity: 'warning' }); return; }
    setSaving(true);
    try { const p = await npdService.createProject(form); onCreated(p); }
    catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setSaving(false);
  };
  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>New development project</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Product name" value={form.product_name} onChange={set('product_name')} required fullWidth autoFocus />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Customer / company" value={form.company_name} onChange={set('company_name')} fullWidth />
            <TextField label="Customer code (CRM)" value={form.customer_code} onChange={set('customer_code')} fullWidth helperText="Links to the CRM record" />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Customer part no." value={form.customer_part_no} onChange={set('customer_part_no')} fullWidth />
            <TextField select label="Type" value={form.project_type} onChange={set('project_type')} fullWidth>
              <MenuItem value="sample">From sample</MenuItem>
              <MenuItem value="drawing">From drawing</MenuItem>
              <MenuItem value="both">Both</MenuItem>
            </TextField>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label="Priority" value={form.priority} onChange={set('priority')} fullWidth>
              {['low', 'normal', 'high', 'urgent'].map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </TextField>
            <TextField type="date" label="Target date" value={form.target_date} onChange={set('target_date')} fullWidth InputLabelProps={{ shrink: true }} />
          </Stack>
          <TextField label="NPD engineer (email)" value={form.npd_engineer_email} onChange={set('npd_engineer_email')} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={submit} variant="contained" color="secondary" disabled={saving}>{saving ? <CircularProgress size={20} /> : 'Create'}</Button>
      </DialogActions>
    </Dialog>
  );
}

export default NPDDashboard;
