// WhatsApp Marketing — Live Campaign Monitor. Filterable (campaign, status)
// table over wa_messages, poll-refreshed every POLL_MS while mounted. No
// realtime subscription in V1 (per the Task 9 brief) — a plain setInterval
// re-running listMessages, cleaned up on unmount/filter change.
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box, Paper, Stack, Typography, Chip, CircularProgress, Alert,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer,
  TextField, MenuItem, Tooltip, IconButton,
} from '@mui/material';
import { RefreshRounded, DoneAllRounded, VisibilityRounded, ErrorOutlineRounded } from '@mui/icons-material';
import waMessagesService from '../../services/waMessagesService';
import waCampaignsService from '../../services/waCampaignsService';

const POLL_MS = 7000;

const STATUS_COLOR = {
  scheduled: 'default',
  queued: 'info',
  sending: 'info',
  sent: 'primary',
  delivered: 'success',
  read: 'success',
  failed: 'error',
  retry_pending: 'warning',
};

const MESSAGE_STATUSES = ['scheduled', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'retry_pending'];

function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v).toLocaleString(); } catch { return v; }
}

function preview(text, n = 60) {
  if (!text) return '—';
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

/** @param {object} props @param {string} [props.initialCampaignId] pre-select a campaign filter */
export default function LiveCampaignMonitor({ initialCampaignId = '' }) {
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState(initialCampaignId);
  const [status, setStatus] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const intervalRef = useRef(null);
  // Guards against setState-after-unmount: the polling load() below is async
  // and can still resolve after the component has unmounted (e.g. the user
  // navigates away mid-poll). Without this, React logs an unmount warning
  // (and, worse, could touch stale closures).
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  useEffect(() => {
    waCampaignsService.listCampaigns().then(setCampaigns).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!isMountedRef.current) return;
    setError(null);
    try {
      const rows = await waMessagesService.listMessages({
        campaignId: campaignId || null,
        status: status || null,
      });
      if (!isMountedRef.current) return;
      setMessages(rows);
      setLastRefreshed(new Date());
    } catch (e) {
      if (!isMountedRef.current) return;
      setError(e.message || 'Failed to load messages');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [campaignId, status]);

  // Initial + on-filter-change load, then poll on an interval; always clean
  // up the interval (both on filter change and on unmount).
  useEffect(() => {
    setLoading(true);
    load();
    intervalRef.current = setInterval(load, POLL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  const campaignName = useCallback(
    (id) => campaigns.find((c) => c.id === id)?.name || (id ? id.slice(0, 8) : '—'),
    [campaigns]
  );

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }} flexWrap="wrap" rowGap={1}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" rowGap={1}>
          <TextField
            select size="small" label="Campaign" value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="">All campaigns</MenuItem>
            {campaigns.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
          <TextField
            select size="small" label="Status" value={status}
            onChange={(e) => setStatus(e.target.value)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">All statuses</MenuItem>
            {MESSAGE_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </TextField>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          {lastRefreshed && (
            <Typography variant="caption" color="text.secondary">
              Updated {lastRefreshed.toLocaleTimeString()}
            </Typography>
          )}
          <Tooltip title="Refresh now">
            <IconButton size="small" onClick={load}><RefreshRounded fontSize="small" /></IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : messages.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 2.5 }}>
          <Typography color="text.secondary">No messages match this filter.</Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5, maxHeight: 560 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Campaign</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Recipient</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Message</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Scheduled</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Delivered</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Read</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Failed</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Retries</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {messages.map((m) => (
                <TableRow key={m.id} hover data-testid={`wa-message-row-${m.id}`}>
                  <TableCell>{campaignName(m.campaign_id)}</TableCell>
                  <TableCell>{m.recipient_number || '—'}</TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {m.step_order != null ? `Step ${m.step_order + 1}: ` : ''}{preview(m.body_text)}
                    </Typography>
                  </TableCell>
                  <TableCell>{fmtDate(m.scheduled_for)}</TableCell>
                  <TableCell><Chip size="small" label={m.status} color={STATUS_COLOR[m.status] || 'default'} /></TableCell>
                  <TableCell align="center">{m.delivered_at ? <DoneAllRounded fontSize="small" color="success" /> : '—'}</TableCell>
                  <TableCell align="center">{m.read_at ? <VisibilityRounded fontSize="small" color="success" /> : '—'}</TableCell>
                  <TableCell align="center">{m.status === 'failed' ? <ErrorOutlineRounded fontSize="small" color="error" /> : '—'}</TableCell>
                  <TableCell align="center">{m.retry_count || 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
