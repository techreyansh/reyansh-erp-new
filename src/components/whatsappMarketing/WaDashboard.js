// WhatsApp Marketing — Main Dashboard. KPI tiles from a single
// waMessagesService.dashboardCounts() call (wraps the wa_dashboard_counts
// SECURITY DEFINER RPC). Reuses the app's existing KPICard component
// (src/components/common/KPICard.js) — the same one used by
// src/pages/profitability/ProfitabilityCenter.js's KPI row — rather than
// inventing a new tile pattern, per the Task 9 brief.
import React, { useEffect, useState, useCallback } from 'react';
import { Box, Stack, Typography, IconButton, Tooltip, CircularProgress, Alert, Chip } from '@mui/material';
import {
  PlayCircleOutlined, ScheduleOutlined, CheckCircleOutlined, PauseCircleOutlined, ErrorOutlined,
  SendOutlined, UpcomingOutlined, DoneAllOutlined, ReplyAllOutlined, HourglassBottomOutlined,
  RefreshRounded,
} from '@mui/icons-material';
import KPICard from '../common/KPICard';
import waMessagesService from '../../services/waMessagesService';

const gridSx = { display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3,1fr)', lg: 'repeat(5,1fr)' } };

export default function WaDashboard() {
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const c = await waMessagesService.dashboardCounts();
      setCounts(c);
    } catch (e) {
      setError(e.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const byStatus = counts?.campaigns_by_status || {};

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>WhatsApp Marketing — Dashboard</Typography>
        <Tooltip title="Refresh"><span><IconButton onClick={load} disabled={loading}><RefreshRounded /></IconButton></span></Tooltip>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}

      {loading && !counts ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : counts ? (
        <Stack spacing={2}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>Campaigns</Typography>
            <Box sx={{ ...gridSx, mt: 0.5 }}>
              <KPICard title="Active" value={byStatus.running || 0} icon={<PlayCircleOutlined />} variant="gradient" color="success" />
              <KPICard title="Scheduled" value={byStatus.scheduled || 0} icon={<ScheduleOutlined />} variant="gradient" color="info" />
              <KPICard title="Completed" value={byStatus.completed || 0} icon={<CheckCircleOutlined />} variant="gradient" color="primary" />
              <KPICard title="Paused" value={byStatus.paused || 0} icon={<PauseCircleOutlined />} variant="gradient" color="warning" />
              <KPICard title="Failed" value={byStatus.failed || 0} icon={<ErrorOutlined />} variant="gradient" color={(byStatus.failed || 0) > 0 ? 'error' : 'success'} />
            </Box>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Chip size="small" variant="outlined" label={`Draft: ${byStatus.draft || 0}`} />
              <Chip size="small" variant="outlined" label={`Stopped: ${byStatus.stopped || 0}`} />
            </Stack>
          </Box>

          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>Messages</Typography>
            <Box sx={{ ...gridSx, mt: 0.5 }}>
              <KPICard title="Sent Today" value={counts.messages_sent_today || 0} icon={<SendOutlined />} variant="gradient" color="primary" />
              <KPICard title="Scheduled Today" value={counts.messages_scheduled_today || 0} icon={<UpcomingOutlined />} variant="gradient" color="info" />
              <KPICard title="Delivery Success Rate" value={`${counts.delivery_success_rate || 0}%`} icon={<DoneAllOutlined />} variant="gradient" color="success" />
              <KPICard
                title="Replies Received"
                value={counts.replies_received_total || 0}
                subtitle={`${counts.replies_received_today || 0} today`}
                icon={<ReplyAllOutlined />}
                variant="gradient"
                color="secondary"
              />
              <KPICard title="Pending Messages" value={counts.pending_messages || 0} icon={<HourglassBottomOutlined />} variant="gradient" color="warning" />
            </Box>
          </Box>
        </Stack>
      ) : null}
    </Box>
  );
}
