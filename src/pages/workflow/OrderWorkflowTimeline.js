// Order-to-Dispatch — per-order workflow timeline.
// Read-only view of one sales order's workflow spine (wf_stage_run) + milestone
// ribbon (wf_event). Phase 1 thin slice: proves the engine end-to-end. Later
// phases add department workboards and the CEO control tower.
import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Paper, Typography, Chip, Stack, Button, Divider, LinearProgress,
  Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Alert,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import workflowEngineService from '../../services/workflowEngineService';

const STATUS_COLOR = {
  blocked: 'default', ready: 'info', in_progress: 'warning',
  done: 'success', skipped: 'default', cancelled: 'error',
};
const INSTANCE_COLOR = { active: 'warning', blocked: 'error', completed: 'success', cancelled: 'default' };

function fmt(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

export default function OrderWorkflowTimeline() {
  const { soId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState({ instance: null, stages: [], events: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await workflowEngineService.getWorkflow(soId)); }
    catch (e) { setError(e.message || String(e)); }
    finally { setLoading(false); }
  }, [soId]);

  useEffect(() => { load(); }, [load]);

  const reconcile = async () => {
    if (!data.instance) return;
    setBusy(true);
    try { await workflowEngineService.reconcile(data.instance.id); await load(); }
    catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const { instance, stages, events } = data;
  const doneCount = stages.filter((s) => s.status === 'done').length;
  const pct = stages.length ? Math.round((doneCount / stages.length) * 100) : 0;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/sales-orders')} size="small">
          Sales Orders
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button startIcon={<RefreshIcon />} onClick={reconcile} disabled={busy || !instance} variant="outlined" size="small">
          Reconcile
        </Button>
      </Stack>

      <Typography variant="h5" fontWeight={700} gutterBottom>Order Execution Workflow</Typography>

      {loading && <LinearProgress sx={{ my: 2 }} />}
      {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}

      {!loading && !instance && (
        <Alert severity="info" sx={{ my: 2 }}>
          No workflow has been started for this sales order yet. A workflow is created
          automatically when the order is <b>released</b>.
        </Alert>
      )}

      {instance && (
        <>
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" flexWrap="wrap" alignItems="center" spacing={2}>
              <Box>
                <Typography variant="overline" color="text.secondary">Sales Order</Typography>
                <Typography variant="h6">{instance.so_number || '—'}</Typography>
              </Box>
              <Divider flexItem orientation="vertical" />
              <Box>
                <Typography variant="overline" color="text.secondary">Customer</Typography>
                <Typography>{instance.company_name || instance.customer_code || '—'}</Typography>
              </Box>
              <Divider flexItem orientation="vertical" />
              <Box>
                <Typography variant="overline" color="text.secondary">Type</Typography>
                <Typography>{instance.order_type}</Typography>
              </Box>
              <Box sx={{ flex: 1 }} />
              <Chip label={instance.status} color={INSTANCE_COLOR[instance.status] || 'default'} />
            </Stack>
            <Box sx={{ mt: 2 }}>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Stage {doneCount} / {stages.length} — current: <b>{instance.current_stage || '—'}</b>
                </Typography>
                <Typography variant="body2" color="text.secondary">{pct}%</Typography>
              </Stack>
              <LinearProgress variant="determinate" value={pct} sx={{ mt: 0.5, height: 8, borderRadius: 1 }} />
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ px: 2, pt: 1.5 }}>Stages</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Stage</TableCell>
                  <TableCell>Department</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Watch</TableCell>
                  <TableCell>Due</TableCell>
                  <TableCell>Completed</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stages.map((s) => (
                  <TableRow key={s.id} hover>
                    <TableCell>{s.sequence}</TableCell>
                    <TableCell>{s.label || s.stage_key}</TableCell>
                    <TableCell>{s.department || '—'}</TableCell>
                    <TableCell>
                      <Chip size="small" label={s.status} color={STATUS_COLOR[s.status] || 'default'} />
                    </TableCell>
                    <TableCell>
                      <Tooltip title={JSON.stringify(s.watch_param || {})}>
                        <span>{s.watch_signal}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell>{s.due_date || '—'}</TableCell>
                    <TableCell>{fmt(s.completed_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          <Paper variant="outlined">
            <Typography variant="subtitle2" sx={{ px: 2, pt: 1.5 }}>Milestone timeline</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell>
                  <TableCell>Stage</TableCell>
                  <TableCell>Event</TableCell>
                  <TableCell>By</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{fmt(e.created_at)}</TableCell>
                    <TableCell>{e.stage_key || '—'}</TableCell>
                    <TableCell>{e.event_type}</TableCell>
                    <TableCell>{e.actor_email || '—'}</TableCell>
                  </TableRow>
                ))}
                {!events.length && (
                  <TableRow><TableCell colSpan={4}><Typography variant="body2" color="text.secondary">No events yet.</Typography></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </>
      )}
    </Box>
  );
}
