// Order-to-Dispatch — per-order workflow view.
// A dependency-aware stage rail (what's done / running / blocked-by-what) plus a
// unified activity timeline merging engine, order-status and work-order events.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Paper, Typography, Chip, Stack, Button, Divider, LinearProgress, Alert, Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import workflowEngineService from '../../services/workflowEngineService';
import WorkflowAiChat from '../../components/workflow/WorkflowAiChat';
import { ORDER_AI_PRESETS } from '../../services/workflowAiService';
import {
  STATUS_COLOR, INSTANCE_COLOR, waitingOn, isOverdue, isManualStage,
  stageBlockers, KIND_COLOR, KIND_LABEL,
} from './workflowLabels';

const DOT = {
  blocked: 'grey.400', ready: 'info.main', in_progress: 'warning.main',
  done: 'success.main', skipped: 'grey.300', cancelled: 'error.main',
};
const fmt = (ts) => { if (!ts) return '—'; try { return new Date(ts).toLocaleString(); } catch { return String(ts); } };

export default function OrderWorkflowTimeline() {
  const { soId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState({ instance: null, stages: [], deps: [] });
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [kind, setKind] = useState('all');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [wf, act] = await Promise.all([
        workflowEngineService.getWorkflow(soId),
        workflowEngineService.getOrderActivity(soId),
      ]);
      setData(wf); setActivity(act);
    } catch (e) { setError(e.message || String(e)); }
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

  const { instance, stages, deps } = data;
  const byKey = useMemo(() => Object.fromEntries(stages.map((s) => [s.stage_key, s])), [stages]);
  const doneCount = stages.filter((s) => s.status === 'done').length;
  const pct = stages.length ? Math.round((doneCount / stages.length) * 100) : 0;
  const kinds = useMemo(() => ['all', ...Array.from(new Set(activity.map((a) => a.kind)))], [activity]);
  const shownActivity = activity.filter((a) => kind === 'all' || a.kind === kind);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/sales-orders')} size="small">Sales Orders</Button>
        <Box sx={{ flex: 1 }} />
        <Button startIcon={<RefreshIcon />} onClick={reconcile} disabled={busy || !instance} variant="outlined" size="small">Reconcile</Button>
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
          {/* Header */}
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" flexWrap="wrap" alignItems="center" spacing={2} useFlexGap>
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

          {/* Dependency-aware stage rail */}
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Stages</Typography>
            <Box sx={{ position: 'relative', pl: 3, '&::before': { content: '""', position: 'absolute', left: 10, top: 6, bottom: 6, width: 2, bgcolor: 'divider' } }}>
              {stages.map((s) => {
                const overdue = isOverdue(s);
                const blockers = stageBlockers(s, byKey, deps, instance.order_type);
                const wait = (s.status === 'in_progress' || s.status === 'ready') && !isManualStage(s) ? waitingOn(s) : null;
                return (
                  <Box key={s.id} sx={{ position: 'relative', mb: 1.75 }}>
                    <Box sx={{ position: 'absolute', left: -20, top: 4, width: 13, height: 13, borderRadius: '50%', bgcolor: DOT[s.status] || 'grey.400', border: '2px solid', borderColor: 'background.paper' }} />
                    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.label || s.stage_key}</Typography>
                      <Chip size="small" label={s.status} color={STATUS_COLOR[s.status] || 'default'} variant={s.status === 'done' ? 'filled' : 'outlined'} />
                      {s.department && <Chip size="small" variant="outlined" label={s.department} />}
                      {wait && <Chip size="small" color="warning" variant="outlined" icon={<HourglassEmptyIcon sx={{ fontSize: 14 }} />} label={wait} />}
                      {isManualStage(s) && s.status === 'in_progress' && <Chip size="small" color="info" variant="outlined" label="needs action" />}
                      <Box sx={{ flex: 1 }} />
                      {s.due_date && (
                        <Typography variant="caption" sx={{ color: overdue ? 'error.main' : 'text.secondary', fontWeight: overdue ? 700 : 400 }}>
                          {overdue ? 'overdue ' : 'due '}{s.due_date}
                        </Typography>
                      )}
                    </Stack>
                    {!!blockers.length && (
                      <Typography variant="caption" color="text.secondary">blocked by: {blockers.join(', ')}</Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Paper>

          {/* Unified activity timeline */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
              <Typography variant="subtitle2">Activity timeline</Typography>
              <Box sx={{ flex: 1 }} />
              {kinds.map((k) => (
                <Chip key={k} size="small" label={k === 'all' ? 'All' : (KIND_LABEL[k] || k)}
                  variant={kind === k ? 'filled' : 'outlined'} onClick={() => setKind(k)}
                  sx={kind === k && k !== 'all' ? { bgcolor: KIND_COLOR[k], color: '#fff' } : undefined} />
              ))}
            </Stack>
            {!shownActivity.length && <Typography variant="body2" color="text.secondary">No activity yet.</Typography>}
            <Box sx={{ position: 'relative', pl: 2, '&::before': { content: '""', position: 'absolute', left: 6, top: 6, bottom: 6, width: 2, bgcolor: 'divider' } }}>
              {shownActivity.map((e, i) => (
                <Box key={i} sx={{ position: 'relative', mb: 1.75 }}>
                  <Box sx={{ position: 'absolute', left: -16, top: 4, width: 11, height: 11, borderRadius: '50%', bgcolor: KIND_COLOR[e.kind] || 'grey.500', border: '2px solid', borderColor: 'background.paper' }} />
                  <Stack direction="row" alignItems="baseline" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={KIND_LABEL[e.kind] || e.kind} sx={{ bgcolor: KIND_COLOR[e.kind], color: '#fff', height: 18, '& .MuiChip-label': { px: 0.75, fontSize: 11 } }} />
                    <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1, textTransform: 'capitalize' }}>{e.title}</Typography>
                    <Tooltip title={fmt(e.at)}><Typography variant="caption" color="text.disabled">{fmt(e.at)}</Typography></Tooltip>
                  </Stack>
                  {(e.detail || e.owner) && (
                    <Typography variant="caption" color="text.secondary">
                      {e.detail ? e.detail + ' · ' : ''}{e.owner ? String(e.owner).split('@')[0] : ''}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          </Paper>

          <Box sx={{ mt: 2 }}>
            <WorkflowAiChat
              presets={ORDER_AI_PRESETS}
              getContext={() => ({ instance: data.instance, stages: data.stages, deps: data.deps, activity })}
              title="Ask about this order"
              hint="Answered over this order's stages and activity."
              placeholder="Ask e.g. “Why is this order stuck and what would unblock it?”"
            />
          </Box>
        </>
      )}
    </Box>
  );
}
