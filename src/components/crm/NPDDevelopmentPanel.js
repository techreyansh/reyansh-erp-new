import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Stack, Typography, Chip, Button, TextField, MenuItem, CircularProgress, Grid,
  Table, TableHead, TableRow, TableCell, TableBody,
} from '@mui/material';
import npdService, { NPD_STAGE_LABEL } from '../../services/npdService';
import { listAssignableUsers } from '../../services/crmPipelineService';

/**
 * Customer-centric NPD panel — every development for ONE CRM customer
 * (prospect or client) + a "New development request" that originates from that
 * customer. Shared by Client360 and the prospect CompanyDrawer so developments
 * are never isolated projects. Pass accountId and/or customerCode.
 */
export const DEV_TYPES = [
  { v: 'drawing_based', l: 'Drawing based' },
  { v: 'sample_based', l: 'Sample based' },
  { v: 'modification', l: 'Modification' },
  { v: 'cost_reduction', l: 'Cost reduction' },
  { v: 'new_product', l: 'New product' },
];
const dt = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

export default function NPDDevelopmentPanel({ accountId, customerCode, companyName, notify, dense }) {
  const navigate = useNavigate();
  const [devs, setDevs] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [engineers, setEngineers] = useState([]);
  const blank = { product_name: '', development_type: 'sample_based', customer_part_no: '', priority: 'normal', target_date: '', npd_engineer_email: '', notes: '' };
  const [form, setForm] = useState(blank);

  const load = useCallback(async () => {
    try { setDevs(await npdService.listByCustomer({ customerCode, accountId })); }
    catch (e) { setDevs([]); notify?.(e.message, 'error'); }
  }, [customerCode, accountId, notify]);
  useEffect(() => { load(); }, [load]);
  // Active users for the engineer picker (degrades to [] — field still usable).
  useEffect(() => { listAssignableUsers().then((u) => setEngineers(u || [])).catch(() => setEngineers([])); }, []);

  const summary = (devs || []).reduce((a, d) => {
    if (d.status === 'approved') a.approved++;
    else if (d.stage === 'customer_feedback') a.feedback++;
    else a.active++;
    return a;
  }, { active: 0, feedback: 0, approved: 0 });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    if (!form.product_name.trim()) { notify?.('Product name is required.', 'error'); return; }
    setSaving(true);
    try {
      const p = await npdService.createProject({ ...form, customer_code: customerCode || null, company_name: companyName || null, account_id: accountId || null });
      notify?.('Development request created.');
      navigate(`/npd/${p.id}`);
    } catch (e) { notify?.(e.message, 'error'); }
    setSaving(false);
  };

  if (devs === null) return <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>;

  return (
    <Box sx={{ p: dense ? 0 : 2 }}>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap alignItems="center">
        {[['Under development', summary.active, 'primary.main'], ['Awaiting feedback', summary.feedback, 'warning.main'], ['Approved', summary.approved, 'success.main']].map(([l, v, col]) => (
          <Box key={l}><Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.58rem', display: 'block' }}>{l}</Typography><Typography variant="h6" sx={{ fontWeight: 800, color: col }}>{v}</Typography></Box>
        ))}
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" color="secondary" size={dense ? 'small' : 'medium'} onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : '+ New development request'}</Button>
      </Stack>

      {showForm && (
        <Box sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>New development request — {companyName || 'customer'}</Typography>
          <Grid container spacing={1.5}>
            <Grid item xs={12} sm={6}><TextField size="small" fullWidth label="Product name" value={form.product_name} onChange={set('product_name')} autoFocus /></Grid>
            <Grid item xs={12} sm={6}><TextField size="small" fullWidth select label="Development type" value={form.development_type} onChange={set('development_type')}>{DEV_TYPES.map((t) => <MenuItem key={t.v} value={t.v}>{t.l}</MenuItem>)}</TextField></Grid>
            <Grid item xs={12} sm={6}><TextField size="small" fullWidth label="Customer part no." value={form.customer_part_no} onChange={set('customer_part_no')} /></Grid>
            <Grid item xs={6} sm={3}><TextField size="small" fullWidth select label="Priority" value={form.priority} onChange={set('priority')}>{['low', 'normal', 'high', 'urgent'].map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}</TextField></Grid>
            <Grid item xs={6} sm={3}><TextField size="small" fullWidth type="date" label="Target" value={form.target_date} onChange={set('target_date')} InputLabelProps={{ shrink: true }} /></Grid>
            <Grid item xs={12} sm={6}>
              <TextField size="small" fullWidth select label="Assigned engineer" value={form.npd_engineer_email} onChange={set('npd_engineer_email')}
                helperText={engineers.length ? undefined : 'No users to pick — assign later from the project'}>
                <MenuItem value=""><em>Unassigned</em></MenuItem>
                {engineers.map((u) => (
                  <MenuItem key={u.email} value={u.email}>
                    {u.full_name || u.email}{u.department ? ` — ${u.department}` : ''}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12}><TextField size="small" fullWidth multiline minRows={2} label="Note for the engineer" placeholder="Specs, drawings reference, what the customer asked for…" value={form.notes} onChange={set('notes')} /></Grid>
            <Grid item xs={12}><Button variant="contained" color="secondary" onClick={submit} disabled={saving}>{saving ? <CircularProgress size={20} /> : 'Create & open'}</Button></Grid>
          </Grid>
        </Box>
      )}

      {devs.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No developments yet for {companyName || 'this customer'}. Start one above — it links to this customer automatically.</Typography>
      ) : (
        <Table size="small">
          <TableHead><TableRow>{['Development', 'Type', 'Stage', 'Status', 'Target'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {devs.map((d) => (
              <TableRow key={d.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/npd/${d.id}`)}>
                <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{d.product_name}</Typography><Typography variant="caption" color="text.secondary">{d.project_no}</Typography></TableCell>
                <TableCell><Typography variant="caption">{(DEV_TYPES.find((t) => t.v === d.development_type) || {}).l || '—'}</Typography></TableCell>
                <TableCell><Chip size="small" label={NPD_STAGE_LABEL[d.stage] || d.stage} sx={{ height: 20 }} /></TableCell>
                <TableCell><Chip size="small" color={d.status === 'approved' ? 'success' : d.status === 'active' ? 'default' : 'warning'} label={d.status} sx={{ height: 20 }} /></TableCell>
                <TableCell><Typography variant="caption" color={d.target_date && new Date(d.target_date) < new Date() && d.status === 'active' ? 'error.main' : 'text.secondary'}>{dt(d.target_date)}</Typography></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}
