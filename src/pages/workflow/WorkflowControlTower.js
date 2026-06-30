// Order-to-Dispatch — CEO Control Tower.
// Portfolio roll-up over EVERY active workflow: headline KPIs, the bottleneck
// stage, open work by department, and an aging/stuck-orders table. Read-only;
// each aging row links to that order's workflow timeline. CEO-gated (route +
// wf_dashboard RPC both enforce is_super_admin).
import React, { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Card, CardContent, Typography, Stack, Chip, Button, IconButton, Tooltip,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer, Paper,
  LinearProgress, Alert, useTheme,
} from '@mui/material';
import {
  AccountTreeOutlined, RefreshOutlined, OpenInNewOutlined, PlayCircleOutline,
  BlockOutlined, WarningAmberOutlined, HourglassBottomOutlined, TaskAltOutlined,
} from '@mui/icons-material';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Cell,
} from 'recharts';
import KPICard from '../../components/common/KPICard';
import workflowEngineService from '../../services/workflowEngineService';

const num = (v) => Number(v || 0).toLocaleString('en-IN');

export default function WorkflowControlTower() {
  const theme = useTheme();
  const [data, setData] = useState(null);
  const [comms, setComms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [d, c] = await Promise.all([
        workflowEngineService.dashboard({}),
        // comms table may not exist on older deploys → tolerate
        workflowEngineService.listCustomerComms({ limit: 50 }).catch(() => []),
      ]);
      setData(d); setComms(c);
    } catch (e) { setError(e.message || String(e)); setData(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const k = data?.kpis || {};
  const byStage = data?.by_stage || [];
  const byDept = data?.by_department || [];
  const aging = data?.aging || [];
  const COMMS_COLOR = { sent: 'success', pending: 'info', skipped: 'default', failed: 'error', cancelled: 'default' };

  return (
    <Box sx={{ pb: 4 }}>
      {/* Header */}
      <Box sx={{ px: 3, pt: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <AccountTreeOutlined sx={{ color: theme.palette.primary.main, fontSize: 30 }} />
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>Workflow Control Tower</Typography>
            <Typography variant="caption" color="text.secondary">Order-to-Dispatch portfolio · every active order, where it's stuck · CEO confidential</Typography>
          </Box>
        </Stack>
        <Tooltip title="Refresh"><span><IconButton onClick={load} disabled={loading}><RefreshOutlined /></IconButton></span></Tooltip>
      </Box>

      {loading && <LinearProgress sx={{ mt: 1.5 }} />}
      {error && <Box sx={{ px: 3, pt: 2 }}><Alert severity="error">{error}</Alert></Box>}

      {/* KPI row */}
      <Box sx={{ px: 3, pt: 2, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3,1fr)', lg: 'repeat(5,1fr)' } }}>
        <KPICard title="Active orders" value={num(k.active)} icon={<PlayCircleOutline />} variant="gradient" color="primary" />
        <KPICard title="Blocked" value={num(k.blocked)} icon={<BlockOutlined />} variant="gradient" color={k.blocked > 0 ? 'error' : 'success'} />
        <KPICard title="Overdue orders" value={num(k.overdue)} subtitle={`${num(k.overdue_stages)} stages late`} icon={<WarningAmberOutlined />} variant="gradient" color={k.overdue > 0 ? 'warning' : 'success'} />
        <KPICard title="Avg age" value={`${num(k.avg_age_days)}d`} icon={<HourglassBottomOutlined />} variant="gradient" color="info" />
        <KPICard title="Completed (30d)" value={num(k.completed_in_range)} icon={<TaskAltOutlined />} variant="gradient" color="success" />
      </Box>

      {!loading && !error && (k.active || 0) === 0 && (aging.length === 0) && (
        <Box sx={{ px: 3, pt: 2 }}>
          <Alert severity="info">No active workflows right now. Release a sales order to spawn one.</Alert>
        </Box>
      )}

      {/* Bottleneck by stage */}
      <Box sx={{ px: 3, pt: 2.5 }}>
        <Card variant="outlined" sx={{ borderRadius: 2.5 }}><CardContent>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>Bottlenecks — active orders by current stage</Typography>
          {byStage.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>No active orders.</Typography>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byStage} margin={{ top: 12, right: 12, left: -16, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={60} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <RTooltip formatter={(v, n) => [v, n === 'overdue' ? 'overdue' : 'orders']} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {byStage.map((s, i) => (
                    <Cell key={i} fill={s.overdue > 0 ? theme.palette.warning.main : theme.palette.primary.main} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent></Card>
      </Box>

      {/* By department */}
      <Box sx={{ px: 3, pt: 2 }}>
        <Card variant="outlined" sx={{ borderRadius: 2.5 }}><CardContent>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>Open work by department</Typography>
          {byDept.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Nothing open.</Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5, mt: 1 }}><Table size="small">
              <TableHead><TableRow>{['Department', 'Open stages', 'Overdue'].map((h, i) => (
                <TableCell key={h} align={i === 0 ? 'left' : 'right'} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>
              ))}</TableRow></TableHead>
              <TableBody>{byDept.map((d) => (
                <TableRow key={d.department} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{d.department}</TableCell>
                  <TableCell align="right">{num(d.open)}</TableCell>
                  <TableCell align="right">{d.overdue > 0
                    ? <Chip size="small" color="warning" variant="outlined" label={num(d.overdue)} />
                    : <Typography variant="body2" color="text.secondary">0</Typography>}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table></TableContainer>
          )}
        </CardContent></Card>
      </Box>

      {/* Aging / stuck orders */}
      <Box sx={{ px: 3, pt: 2 }}>
        <Card variant="outlined" sx={{ borderRadius: 2.5 }}><CardContent>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>Stuck orders — oldest first</Typography>
          {aging.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>No active orders.</Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5, mt: 1, overflowX: 'auto' }}><Table size="small">
              <TableHead><TableRow>{['Order', 'Customer', 'Stage', 'Age', 'In stage', 'Owner', ''].map((h, i) => (
                <TableCell key={h} align={['Age', 'In stage'].includes(h) ? 'right' : 'left'} sx={{ fontWeight: 700, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{h}</TableCell>
              ))}</TableRow></TableHead>
              <TableBody>{aging.map((a) => (
                <TableRow key={a.sales_order_id} hover sx={{ bgcolor: a.overdue ? 'action.hover' : 'inherit' }}>
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>{a.so_number || a.sales_order_id?.slice(0, 8)}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{a.company_name || '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Chip size="small" variant="outlined" color={a.overdue ? 'warning' : a.status === 'blocked' ? 'error' : 'default'}
                      label={a.current_stage_label || a.current_stage || '—'} />
                  </TableCell>
                  <TableCell align="right">{num(a.age_days)}d</TableCell>
                  <TableCell align="right">{a.days_in_stage == null ? '—' : `${num(a.days_in_stage)}d`}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.78rem' }}>{a.owner_email || '—'}</TableCell>
                  <TableCell>
                    <Tooltip title="Open workflow timeline">
                      <Button size="small" component={RouterLink} to={`/workflow/${a.sales_order_id}`}
                        endIcon={<OpenInNewOutlined sx={{ fontSize: 16 }} />}>Open</Button>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}</TableBody>
            </Table></TableContainer>
          )}
        </CardContent></Card>
      </Box>

      {/* Customer comms log (Phase 4b) */}
      <Box sx={{ px: 3, pt: 2 }}>
        <Card variant="outlined" sx={{ borderRadius: 2.5 }}><CardContent>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>Customer comms — recent milestone messages</Typography>
          {comms.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>No customer messages yet.</Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5, mt: 1, overflowX: 'auto' }}><Table size="small">
              <TableHead><TableRow>{['Order', 'Milestone', 'Channel', 'Recipient', 'Status', 'When'].map((h) => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{h}</TableCell>
              ))}</TableRow></TableHead>
              <TableBody>{comms.map((m) => (
                <TableRow key={m.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>{m.so_number || '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{String(m.milestone || '').replace(/_/g, ' ')}</TableCell>
                  <TableCell>{m.channel}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.78rem' }}>{m.recipient_email || m.recipient_phone || '—'}</TableCell>
                  <TableCell>
                    <Tooltip title={m.error || ''}>
                      <Chip size="small" variant="outlined" color={COMMS_COLOR[m.status] || 'default'} label={m.status} />
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.78rem' }}>{(m.sent_at || m.created_at || '').slice(0, 16).replace('T', ' ')}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table></TableContainer>
          )}
        </CardContent></Card>
      </Box>
    </Box>
  );
}
