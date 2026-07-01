// Home dashboard widget — small self-contained "at a glance" panel for the
// WhatsApp Marketing module, mirroring CollectionsPanel's shape/style in
// src/pages/WelcomePage.js (own Paper card, fetches its own data once on
// mount, Skeleton loading state, degrades to a clean state rather than
// erroring). Renders on the Home page for `marketing`-view roles only —
// gating happens in WelcomePage.js, not here.
//
// Data sources (Task 3 — src/services/waMessagesService.js):
//   providerStatus()  -> wa_provider_status RPC:
//     { connected: false }  — no active row in wa_provider_settings at all
//     { connected: true, provider_key, sender_number, mode,
//       last_health_check_at, health_status, health_reason }
//     health_status is only ever set by waProviderService.testConnection()
//     ('ok' | 'error') — see src/services/waProviderService.js. A connected
//     provider whose last test failed (health_status === 'error') is shown
//     as offline with the reason; anything else connected is shown green.
//   dashboardCounts() -> wa_dashboard_counts RPC:
//     { campaigns_by_status: { draft, scheduled, running, paused, completed,
//         stopped, failed }, messages_sent_today, messages_scheduled_today,
//       delivery_success_rate, replies_received_today, replies_received_total,
//       pending_messages }
//
// Field-name reality check against the task brief (documented per the task-11
// instructions to confirm exact field names before rendering):
//   - "today's campaign count": the RPC has no "today" scoping for campaigns
//     (campaigns_by_status is an all-time-by-status breakdown, not "created
//     today"). The closest real signal is campaigns_by_status.running, shown
//     here as "Active campaigns".
//   - "failed messages (today)": there is no messages-failed-today field in
//     wa_dashboard_counts (wa_messages 'failed' status isn't broken out by
//     day here). The closest real field is campaigns_by_status.failed
//     (all-time failed *campaigns*), shown here as "Failed campaigns
//     (all-time)" — labeled honestly rather than mislabeled as a
//     messages/today figure that doesn't exist.
//   - last sync time: last_health_check_at, or "—" if null. Neither
//     providerStatus() nor dashboardCounts() (the two services this widget
//     is scoped to per the brief) expose any other timestamp to fall back
//     to — there's no "most recent wa_events/wa_messages timestamp" in
//     either payload — so "—" is the fallback rather than inventing an extra
//     query outside the two services named in the task.
import React, { useEffect, useState, useCallback } from 'react';
import { Box, Paper, Stack, Typography, Chip, Skeleton } from '@mui/material';
import { WhatsApp } from '@mui/icons-material';
import waMessagesService from '../../services/waMessagesService';

function formatSyncTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function Tile({ label, value }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary" noWrap>{label}</Typography>
    </Box>
  );
}

export default function HomeWaWidget() {
  const [status, setStatus] = useState(null); // null = loading
  const [counts, setCounts] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [statusRes, countsRes] = await Promise.all([
        waMessagesService.providerStatus(),
        waMessagesService.dashboardCounts(),
      ]);
      setStatus(statusRes || { connected: false });
      setCounts(countsRes || {});
    } catch (e) {
      // Degrade silently — show a clean state rather than break the home page.
      setFailed(true);
      setStatus({ connected: false });
      setCounts({});
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await load();
    })();
    return () => { active = false; };
  }, [load]);

  const loading = status === null;
  const connected = !!status?.connected;
  const isHealthy = connected && status?.health_status !== 'error';
  const byStatus = counts?.campaigns_by_status || {};
  const notConfigured = !loading && !connected && !failed;

  return (
    <Paper
      variant="outlined"
      sx={{ borderRadius: 2.5, p: { xs: 1.5, sm: 2 }, height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }} flexWrap="wrap" gap={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <WhatsApp sx={{ fontSize: 20, color: 'primary.main' }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            WhatsApp Marketing
          </Typography>
        </Stack>
        {!loading && (
          <Chip
            label={connected ? (isHealthy ? '🟢 Connected' : '🔴 Offline') : '🔴 Offline'}
            size="small"
            color={connected && isHealthy ? 'success' : 'default'}
            sx={{ fontWeight: 700 }}
          />
        )}
      </Stack>

      {loading ? (
        <Stack spacing={1} sx={{ px: 0.5 }}>
          <Skeleton variant="rounded" height={20} width="60%" />
          <Skeleton variant="rounded" height={60} />
        </Stack>
      ) : notConfigured ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', py: 3, px: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            Not configured yet — set up a WhatsApp provider to start sending campaigns.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1.25}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              rowGap: 1.25,
              columnGap: 1,
            }}
          >
            <Tile label="Active campaigns" value={byStatus.running || 0} />
            <Tile label="Messages sent today" value={counts?.messages_sent_today || 0} />
            <Tile label="Pending messages" value={counts?.pending_messages || 0} />
            <Tile label="Failed campaigns (all-time)" value={byStatus.failed || 0} />
          </Box>
          <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={0.5}>
            <Typography variant="caption" color="text.secondary">
              {connected
                ? `${status.provider_key || 'Provider'} · ${status.mode || ''}${!isHealthy && status.health_reason ? ` · ${status.health_reason}` : ''}`
                : (failed ? 'Status unavailable' : 'No active provider')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Last sync: {formatSyncTime(status?.last_health_check_at)}
            </Typography>
          </Stack>
        </Stack>
      )}
    </Paper>
  );
}
