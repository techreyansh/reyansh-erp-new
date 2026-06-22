// Dispatch Control Tower — plan released orders by dispatch date; the engine
// computes the backward schedule + readiness. The dispatch date drives the plan.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container, Box, Stack, Typography, Button, Grid, Card, CardContent, Chip, Table, TableHead,
  TableRow, TableCell, TableBody, IconButton, CircularProgress, Snackbar, Alert, TextField,
  MenuItem, Collapse, LinearProgress, Divider, Tooltip, ToggleButton, ToggleButtonGroup, useTheme, alpha,
} from '@mui/material';
import DispatchCalendar from '../../components/dispatch/DispatchCalendar';
import LocalShippingOutlined from '@mui/icons-material/LocalShippingOutlined';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ExpandLess from '@mui/icons-material/ExpandLess';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import dispatch from '../../services/dispatchTowerService';
import { backwardPlan, readiness, planRisk } from '../../services/dispatchPlanner';
import ReportExportButton from '../../components/common/ReportExportButton';
import { buildDispatchReport } from '../../services/reporting/operationsReports';

const inr = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');
const todayStr = () => new Date().toISOString().slice(0, 10);
const within = (d, days) => { if (!d) return false; const x = new Date(d), t = new Date(); const diff = (x - t) / 86400000; return diff >= -0.5 && diff <= days; };
const isToday = (d) => d && new Date(d).toDateString() === new Date().toDateString();
const BAND_COLOR = { green: 'success', yellow: 'warning', red: 'error' };
const STATUS_COLOR = { planned: 'info', in_production: 'secondary', packing: 'warning', ready: 'success', dispatched: 'success', delayed: 'error', cancelled: 'default' };
const DISPATCH_STATUSES = ['planned', 'in_production', 'packing', 'ready', 'dispatched', 'delayed'];

export default function DispatchControlTower() {
  const theme = useTheme();
  const [plans, setPlans] = useState([]);
  const [plannable, setPlannable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [view, setView] = useState('list');
  const [planning, setPlanning] = useState(null); // order being scheduled
  const [planDate, setPlanDate] = useState(todayStr());
  const [snack, setSnack] = useState(null);
  const notify = (message, severity = 'success') => setSnack({ message, severity });

  const load = useCallback(async () => {
    setLoading(true);
    try { const [p, o] = await Promise.all([dispatch.listDispatchPlans(), dispatch.listPlannableOrders()]); setPlans(p); setPlannable(o); }
    catch (e) { notify(e.message || 'Failed to load', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(() => {
    const active = plans.filter((p) => !['dispatched', 'cancelled'].includes(p.status));
    return {
      week: active.filter((p) => within(p.dispatch_date, 7)).length,
      today: active.filter((p) => isToday(p.dispatch_date)).length,
      delayed: plans.filter((p) => p.status === 'delayed' || (p.dispatch_date && new Date(p.dispatch_date) < new Date() && p.status !== 'dispatched')).length,
      ready: plans.filter((p) => p.status === 'ready').length,
      value: active.reduce((a, p) => a + (Number(p.total_value) || 0), 0),
    };
  }, [plans]);

  const confirmPlan = async () => {
    try { await dispatch.createPlan(planning, { dispatch_date: planDate }); notify(`Dispatch planned for ${planning.so_number}`); setPlanning(null); load(); }
    catch (e) { notify(e.message || 'Failed', 'error'); }
  };
  const saveReadiness = async (p, key, val) => {
    const next = { ...(p.readiness || {}), [key]: Math.max(0, Math.min(100, Number(val) || 0)) };
    setPlans((ps) => ps.map((x) => (x.id === p.id ? { ...x, readiness: next } : x)));
    try { await dispatch.updatePlan(p.id, { readiness: next }); } catch (e) { notify(e.message, 'error'); }
  };
  const setStatus = async (p, status) => { try { await dispatch.updatePlan(p.id, { status }); notify('Status updated'); load(); } catch (e) { notify(e.message, 'error'); } };

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <LocalShippingOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Dispatch Control Tower</Typography>
        <Chip size="small" variant="outlined" label="reverse planning" color="primary" />
        <Box sx={{ flexGrow: 1 }} />
        <ReportExportButton buildReport={() => buildDispatchReport(plans)} label="Export plan" />
      </Stack>

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {[['Due this week', kpis.week, 'primary'], ['Due today', kpis.today, 'warning'], ['Delayed / overdue', kpis.delayed, 'error'],
          ['Ready to dispatch', kpis.ready, 'success'], ['Open dispatch value', inr(kpis.value), 'primary']].map(([label, val, color]) => (
          <Grid item xs={6} sm={4} md={2.4} key={label}>
            <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.6rem' }}>{label}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 800, color: `${color}.main` }}>{val}</Typography>
            </CardContent></Card>
          </Grid>
        ))}
      </Grid>

      {/* Released orders awaiting a dispatch plan */}
      {plannable.length > 0 && (
        <Card variant="outlined" sx={{ borderRadius: 2, mb: 2 }}><CardContent>
          <Typography variant="overline" color="text.secondary">Released orders to plan ({plannable.length})</Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {plannable.map((o) => (
              <Stack key={o.id} direction="row" alignItems="center" spacing={1} sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', flexWrap: 'wrap' }} useFlexGap>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.74rem' }}>{o.so_number}</Typography>
                <Typography variant="body2" fontWeight={600} sx={{ flex: 1, minWidth: 120 }}>{o.company_name}</Typography>
                <Typography variant="caption" color="text.secondary">{o.total_qty} units · {inr(o.total_value)}</Typography>
                <Button size="small" variant="outlined" onClick={() => { setPlanning(o); setPlanDate(o.expected_delivery_date || todayStr()); }}>Plan dispatch</Button>
              </Stack>
            ))}
          </Stack>
        </CardContent></Card>
      )}

      {/* Dispatch plans */}
      <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>Dispatch plans</Typography>
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
            <ToggleButton value="list">List</ToggleButton>
            <ToggleButton value="calendar">Calendar</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        {loading ? <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack> : plans.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No dispatch plans yet. Plan a released order above.</Typography>
        ) : view === 'calendar' ? (
          <DispatchCalendar plans={plans} onOpen={(p) => { setView('list'); setExpanded(p.id); }} />
        ) : (
          <Stack spacing={1} sx={{ mt: 1 }}>
            {plans.map((p) => {
              const r = readiness(p.readiness || {});
              const schedule = backwardPlan(p.dispatch_date);
              const risk = planRisk(schedule);
              const open = expanded === p.id;
              return (
                <Box key={p.id} sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 2, overflow: 'hidden' }}>
                  <Stack direction="row" alignItems="center" spacing={1.5} sx={{ p: 1.25, cursor: 'pointer', flexWrap: 'wrap' }} useFlexGap onClick={() => setExpanded(open ? null : p.id)}>
                    <Box sx={{ minWidth: 120 }}>
                      <Typography variant="body2" fontWeight={700}>{p.company_name}</Typography>
                      <Typography variant="caption" color="text.secondary">{p.so_number} · {p.total_qty} units</Typography>
                    </Box>
                    <Chip size="small" label={`Dispatch ${fmt(p.dispatch_date)}`} color={isToday(p.dispatch_date) ? 'warning' : 'default'} />
                    <Box sx={{ flex: 1, minWidth: 120 }}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <LinearProgress variant="determinate" value={r.overall} sx={{ flex: 1, height: 8, borderRadius: 4, '& .MuiLinearProgress-bar': { bgcolor: theme.palette[BAND_COLOR[r.band]].main } }} />
                        <Typography variant="caption" fontWeight={700} color={`${BAND_COLOR[r.band]}.main`}>{r.overall}%</Typography>
                      </Stack>
                    </Box>
                    <Chip size="small" color={STATUS_COLOR[p.status] || 'default'} label={(p.status || '').replace(/_/g, ' ')} sx={{ textTransform: 'capitalize' }} />
                    {risk.atRisk && <Tooltip title={`Behind: ${risk.overdueStages.join(', ')}`}><WarningAmberRounded color="error" fontSize="small" /></Tooltip>}
                    <IconButton size="small">{open ? <ExpandLess /> : <ExpandMore />}</IconButton>
                  </Stack>
                  <Collapse in={open} unmountOnExit>
                    <Divider />
                    <Box sx={{ p: 2, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
                      <Box>
                        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Backward schedule (from dispatch {fmt(p.dispatch_date)})</Typography>
                        <Table size="small"><TableBody>
                          {schedule.map((s) => {
                            const overdue = new Date(s.due_date) < new Date(new Date().toDateString());
                            return (
                              <TableRow key={s.key}>
                                <TableCell sx={{ py: 0.5 }}>{s.label}</TableCell>
                                <TableCell sx={{ py: 0.5 }}><Typography variant="caption" color="text.secondary">{s.dept}</Typography></TableCell>
                                <TableCell sx={{ py: 0.5, color: overdue ? 'error.main' : 'text.primary', fontWeight: overdue ? 700 : 400 }}>{fmt(s.due_date)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody></Table>
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Readiness by department</Typography>
                        {r.bands.map((b) => (
                          <Stack key={b.key} direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                            <Typography variant="body2" sx={{ width: 80 }}>{b.label}</Typography>
                            <LinearProgress variant="determinate" value={b.pct} sx={{ flex: 1, height: 7, borderRadius: 4, '& .MuiLinearProgress-bar': { bgcolor: theme.palette[BAND_COLOR[b.band]].main } }} />
                            <TextField size="small" variant="standard" type="number" value={b.pct} onChange={(e) => saveReadiness(p, b.key, e.target.value)} sx={{ width: 56 }} />
                          </Stack>
                        ))}
                        <TextField select size="small" label="Status" value={p.status} onChange={(e) => setStatus(p, e.target.value)} sx={{ mt: 1, minWidth: 160 }}>
                          {DISPATCH_STATUSES.map((s) => <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>{s.replace(/_/g, ' ')}</MenuItem>)}
                        </TextField>
                      </Box>
                    </Box>
                  </Collapse>
                </Box>
              );
            })}
          </Stack>
        )}
      </CardContent></Card>

      {/* plan dialog (inline) */}
      {planning && (
        <Card variant="outlined" sx={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1300, p: 2, borderRadius: 3, boxShadow: 6, bgcolor: 'background.paper' }}>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" fontWeight={700}>Plan dispatch · {planning.so_number}</Typography>
            <TextField size="small" type="date" label="Dispatch date" InputLabelProps={{ shrink: true }} value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
            <Button variant="contained" onClick={confirmPlan}>Create plan</Button>
            <Button onClick={() => setPlanning(null)}>Cancel</Button>
          </Stack>
        </Card>
      )}

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
