// Functional Attendance tab: month view, summary, mark/edit, delete.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, CardContent, Stack, Typography, Chip, TextField, MenuItem, Button,
  Table, TableHead, TableRow, TableCell, TableBody, IconButton, Alert, Box,
  CircularProgress, Tooltip, useTheme,
} from '@mui/material';
import EventAvailable from '@mui/icons-material/EventAvailable';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import { supabase } from '../../lib/supabaseClient';
import {
  ATTENDANCE_STATUSES, listAttendance, upsertAttendance, deleteAttendance, summarizeAttendance,
} from '../../services/attendanceService';

const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthBounds = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return { from: `${m}-01`, to: `${m}-${pad(new Date(y, mo, 0).getDate())}` };
};
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' }) : '—');
const statusMeta = (k) => ATTENDANCE_STATUSES.find((s) => s.key === k) || { label: k, color: 'default' };

export default function EmployeeAttendanceTab({ employeeId }) {
  const theme = useTheme();
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [myEmail, setMyEmail] = useState(null);
  const [form, setForm] = useState({ date: todayStr(), status: 'present', check_in: '', check_out: '', note: '' });

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMyEmail(data?.user?.email || null)).catch(() => {}); }, []);

  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const { from, to } = monthBounds(month);
      setRows(await listAttendance(employeeId, from, to));
    } finally {
      setLoading(false);
    }
  }, [employeeId, month]);
  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => summarizeAttendance(rows), [rows]);

  const save = async () => {
    if (!form.date) { setError('Pick a date.'); return; }
    setSaving(true); setError(null);
    try {
      await upsertAttendance(employeeId, form.date, form, myEmail);
      setForm((f) => ({ ...f, check_in: '', check_out: '', note: '' }));
      await load();
    } catch (e) {
      setError(e.message || 'Could not save attendance.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try { await deleteAttendance(id); await load(); }
    catch (e) { setError(e.message || 'Could not delete.'); }
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} mb={2} flexWrap="wrap" useFlexGap>
          <EventAvailable color="action" />
          <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>Attendance</Typography>
          <TextField
            type="month" size="small" label="Month" InputLabelProps={{ shrink: true }}
            value={month} onChange={(e) => setMonth(e.target.value || thisMonth())}
          />
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        {/* Monthly summary */}
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
          {ATTENDANCE_STATUSES.map((s) => (
            <Chip key={s.key} size="small" color={summary[s.key] ? s.color : 'default'}
              variant={summary[s.key] ? 'filled' : 'outlined'} label={`${s.label}: ${summary[s.key]}`} />
          ))}
        </Stack>

        {/* Mark attendance */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', p: 1.5, mb: 2, borderRadius: 2, bgcolor: theme.palette.action.hover }}>
          <TextField type="date" size="small" label="Date" InputLabelProps={{ shrink: true }}
            value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} sx={{ minWidth: 150 }} />
          <TextField select size="small" label="Status" value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} sx={{ minWidth: 130 }}>
            {ATTENDANCE_STATUSES.map((s) => <MenuItem key={s.key} value={s.key}>{s.label}</MenuItem>)}
          </TextField>
          <TextField type="time" size="small" label="In" InputLabelProps={{ shrink: true }}
            value={form.check_in} onChange={(e) => setForm((f) => ({ ...f, check_in: e.target.value }))} sx={{ width: 110 }} />
          <TextField type="time" size="small" label="Out" InputLabelProps={{ shrink: true }}
            value={form.check_out} onChange={(e) => setForm((f) => ({ ...f, check_out: e.target.value }))} sx={{ width: 110 }} />
          <TextField size="small" label="Note" value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} sx={{ flex: 1, minWidth: 140 }} />
          <Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Mark'}</Button>
        </Box>

        {/* Records */}
        {loading ? (
          <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack>
        ) : rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            No attendance recorded for this month. Use the form above to mark days.
          </Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell><TableCell>Status</TableCell>
                  <TableCell>In</TableCell><TableCell>Out</TableCell>
                  <TableCell>Note</TableCell><TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => {
                  const m = statusMeta(r.status);
                  return (
                    <TableRow key={r.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmt(r.date)}</TableCell>
                      <TableCell><Chip size="small" color={m.color} label={m.label} sx={{ height: 20 }} /></TableCell>
                      <TableCell>{r.check_in || '—'}</TableCell>
                      <TableCell>{r.check_out || '—'}</TableCell>
                      <TableCell sx={{ maxWidth: 220 }}>{r.note || '—'}</TableCell>
                      <TableCell align="right">
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => remove(r.id)}><DeleteOutline fontSize="small" /></IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
