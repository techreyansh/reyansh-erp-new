// WhatsApp Marketing — Campaigns list. Table of campaigns with status chips
// and Pause/Resume/Stop actions. Stop additionally cancels the campaign's
// not-yet-sent wa_messages (see waCampaignsService.setStatus/cancelPendingMessages —
// terminal state chosen there is status='failed', error='cancelled').
import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Paper, Stack, Typography, Button, Chip, IconButton, CircularProgress,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer, Tooltip, Alert,
} from '@mui/material';
import {
  PlayArrowRounded, PauseRounded, StopRounded, RefreshRounded, InsightsOutlined, MonitorHeartOutlined,
} from '@mui/icons-material';
import waCampaignsService from '../../services/waCampaignsService';

const STATUS_COLOR = {
  draft: 'default',
  scheduled: 'info',
  running: 'success',
  paused: 'warning',
  completed: 'info',
  stopped: 'default',
  failed: 'error',
};

function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v).toLocaleString(); } catch { return v; }
}

/**
 * @param {object} props
 * @param {(msg:string, severity?:string)=>void} [props.notify]
 * @param {(campaignId:string)=>void} [props.onOpenAnalytics] - open CampaignAnalytics for a row
 * @param {(campaignId:string)=>void} [props.onOpenMonitor] - open LiveCampaignMonitor filtered to a row
 */
export default function CampaignsList({ notify = () => {}, onOpenAnalytics, onOpenMonitor }) {
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await waCampaignsService.listCampaigns();
      setCampaigns(list);
    } catch (e) {
      setError(e.message || 'Failed to load campaigns');
      notify(e.message || 'Failed to load campaigns', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const changeStatus = async (campaign, nextStatus, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusyId(campaign.id);
    try {
      await waCampaignsService.setStatus(campaign.id, nextStatus);
      notify(
        nextStatus === 'stopped'
          ? 'Campaign stopped — remaining un-sent messages were cancelled.'
          : `Campaign ${nextStatus}.`
      );
      await load();
    } catch (e) {
      notify(e.message || 'Could not update campaign status', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const actionsFor = (c) => {
    const disabled = busyId === c.id;
    switch (c.status) {
      case 'draft':
        return (
          <Tooltip title="Start now">
            <span>
              <IconButton size="small" color="success" disabled={disabled} onClick={() => changeStatus(c, 'running')}>
                <PlayArrowRounded fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        );
      case 'running':
        return (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Pause">
              <span>
                <IconButton size="small" color="warning" disabled={disabled} onClick={() => changeStatus(c, 'paused')}>
                  <PauseRounded fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Stop (cancels un-sent messages)">
              <span>
                <IconButton
                  size="small"
                  color="error"
                  disabled={disabled}
                  onClick={() => changeStatus(c, 'stopped', `Stop "${c.name}"? Any scheduled/queued/retrying messages for this campaign will be cancelled.`)}
                >
                  <StopRounded fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        );
      case 'paused':
        return (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Resume">
              <span>
                <IconButton size="small" color="success" disabled={disabled} onClick={() => changeStatus(c, 'running')}>
                  <PlayArrowRounded fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Stop (cancels un-sent messages)">
              <span>
                <IconButton
                  size="small"
                  color="error"
                  disabled={disabled}
                  onClick={() => changeStatus(c, 'stopped', `Stop "${c.name}"? Any scheduled/queued/retrying messages for this campaign will be cancelled.`)}
                >
                  <StopRounded fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        );
      default:
        // scheduled / completed / stopped / failed have no client-driven
        // forward transition (scheduled->running is a scheduler concern; the
        // rest are terminal) — see waCampaignsService.STATUS_TRANSITIONS.
        return <Typography variant="caption" color="text.secondary">—</Typography>;
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="overline" sx={{ fontWeight: 800, color: 'text.secondary' }}>
          {campaigns.length} campaign{campaigns.length === 1 ? '' : 's'}
        </Typography>
        <Button size="small" startIcon={<RefreshRounded />} onClick={load} sx={{ textTransform: 'none' }}>Refresh</Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : campaigns.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 2.5 }}>
          <Typography color="text.secondary">No campaigns yet.</Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Campaign</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Owner</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Start</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Created</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Actions</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">View</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.id} hover data-testid={`campaign-row-${c.id}`}>
                  <TableCell>
                    <Typography sx={{ fontWeight: 700 }}>{c.name}</Typography>
                    {c.description && (
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', maxWidth: 280 }}>
                        {c.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={c.status} color={STATUS_COLOR[c.status] || 'default'} />
                  </TableCell>
                  <TableCell>{c.owner_email || '—'}</TableCell>
                  <TableCell>{fmtDate(c.start_at)}</TableCell>
                  <TableCell>{fmtDate(c.created_at)}</TableCell>
                  <TableCell align="center">{actionsFor(c)}</TableCell>
                  <TableCell align="center">
                    <Stack direction="row" spacing={0.5} justifyContent="center">
                      <Tooltip title="Analytics">
                        <span>
                          <IconButton size="small" onClick={() => onOpenAnalytics && onOpenAnalytics(c.id)} disabled={!onOpenAnalytics}>
                            <InsightsOutlined fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Live monitor">
                        <span>
                          <IconButton size="small" onClick={() => onOpenMonitor && onOpenMonitor(c.id)} disabled={!onOpenMonitor}>
                            <MonitorHeartOutlined fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
