// Functional Leave tab: balances, request form, approval workflow.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, CardContent, Stack, Typography, Chip, TextField, MenuItem, Button, Grid,
  Table, TableHead, TableRow, TableCell, TableBody, IconButton, Alert, Box,
  CircularProgress, Tooltip, useTheme, alpha,
} from '@mui/material';
import BeachAccess from '@mui/icons-material/BeachAccess';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import HighlightOff from '@mui/icons-material/HighlightOff';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import { supabase } from '../../lib/supabaseClient';
import {
  LEAVE_TYPES, LEAVE_STATUS_COLOR, dayCount, listLeaveRequests, createLeaveRequest,
  decideLeaveRequest, deleteLeaveRequest, summarizeLeave,
} from '../../services/leaveService';

const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const typeLabel = (k) => (LEAVE_TYPES.find((t) => t.key === k) || {}).label || k;

export default function EmployeeLeaveTab({ employeeId }) {
  const theme = useTheme();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [myEmail, setMyEmail] = useState(null);
  const [form, setForm] = useState({ leave_type: 'casual', start_date: todayStr(), end_date: todayStr(), reason: '' });

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMyEmail(data?.user?.email || null)).catch(() => {}); }, []);

  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    try { setRows(await listLeaveRequests(employeeId)); } finally { setLoading(false); }
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  const balances = useMemo(() => summarizeLeave(rows), [rows]);
  const reqDays = dayCount(form.start_date, form.end_date);

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      await createLeaveRequest(employeeId, form);
      setForm((f) => ({ ...f, reason: '' }));
      await load();
    } catch (e) {
      setError(e.message || 'Could not submit the request.');
    } finally {
      setSaving(false);
    }
  };

  const decide = async (id, status) => {
    try { await decideLeaveRequest(id, status, myEmail); await load(); }
    catch (e) { setError(e.message || 'Action failed.'); }
  };
  const remove = async (id) => {
    try { await deleteLeaveRequest(id); await load(); }
    catch (e) { setError(e.message || 'Could not delete.'); }
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} mb={2}>
          <BeachAccess color="action" />
          <Typography variant="h6" fontWeight={700}>Leave</Typography>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        {/* Balances */}
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          {balances.filter((b) => b.entitled != null).map((b) => (
            <Grid item xs={6} sm={4} md={3} key={b.key}>
              <Box sx={{ p: 1.5, borderRadius: 2, border: `1px solid ${theme.palette.divider}` }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.62rem' }}>{b.label}</Typography>
                <Typography variant="h6" fontWeight={800} lineHeight={1.2}>
                  {b.remaining}<Typography component="span" variant="caption" color="text.secondary"> / {b.entitled} left</Typography>
                </Typography>
                <Typography variant="caption" color="text.secondary">{b.used} used this year</Typography>
              </Box>
            </Grid>
          ))}
        </Grid>

        {/* Request form */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', p: 1.5, mb: 2, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
          <TextField select size="small" label="Type" value={form.leave_type}
            onChange={(e) => setForm((f) => ({ ...f, leave_type: e.target.value }))} sx={{ minWidth: 120 }}>
            {LEAVE_TYPES.map((t) => <MenuItem key={t.key} value={t.key}>{t.label}</MenuItem>)}
          </TextField>
          <TextField type="date" size="small" label="From" InputLabelProps={{ shrink: true }}
            value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
          <TextField type="date" size="small" label="To" InputLabelProps={{ shrink: true }}
            value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
          <Chip size="small" label={`${reqDays} day${reqDays === 1 ? '' : 's'}`} />
          <TextField size="small" label="Reason" value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} sx={{ flex: 1, minWidth: 140 }} />
          <Button variant="contained" onClick={submit} disabled={saving || reqDays <= 0}>{saving ? 'Submitting…' : 'Request'}</Button>
        </Box>

        {/* Requests */}
        {loading ? (
          <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack>
        ) : rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            No leave requests yet.
          </Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell><TableCell>From</TableCell><TableCell>To</TableCell>
                  <TableCell align="center">Days</TableCell><TableCell>Reason</TableCell>
                  <TableCell>Status</TableCell><TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{typeLabel(r.leave_type)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmt(r.start_date)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmt(r.end_date)}</TableCell>
                    <TableCell align="center">{r.days}</TableCell>
                    <TableCell sx={{ maxWidth: 200 }}>{r.reason || '—'}</TableCell>
                    <TableCell>
                      <Chip size="small" color={LEAVE_STATUS_COLOR[r.status] || 'default'} label={r.status} sx={{ height: 20, textTransform: 'capitalize' }} />
                      {r.decided_by_email && <Typography variant="caption" color="text.secondary" display="block">{r.decided_by_email}</Typography>}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {r.status === 'pending' ? (
                        <>
                          <Tooltip title="Approve"><IconButton size="small" color="success" onClick={() => decide(r.id, 'approved')}><CheckCircleOutline fontSize="small" /></IconButton></Tooltip>
                          <Tooltip title="Reject"><IconButton size="small" color="error" onClick={() => decide(r.id, 'rejected')}><HighlightOff fontSize="small" /></IconButton></Tooltip>
                        </>
                      ) : (
                        <Tooltip title="Delete"><IconButton size="small" onClick={() => remove(r.id)}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
