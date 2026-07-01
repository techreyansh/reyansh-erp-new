// WhatsApp Marketing — Campaign Analytics. Per-campaign totals combining
// waMessagesService.campaignAnalytics(campaignId) (message-derived stats:
// sent/delivered/read/failed rates + inbound reply count) with
// waCampaignsService.listEnrollments(campaignId) (true enrollment totals +
// completion %, since campaignAnalytics's `totalContacts`/`completionRate`
// are derived from wa_messages rows, not wa_enrollments — a freshly enrolled
// contact may have zero messages yet, and a message in a terminal status
// isn't the same thing as an enrollment reaching 'completed'). See the Task 9
// report for the full reasoning.
//
// Avg response time is intentionally NOT shown: wa_events records inbound
// replies but doesn't reliably link a reply to the specific outbound message
// it answers, so "read_at - sent_at" or similar isn't a real response-time
// measurement in this data model. Replies are reported as a plain count.
import React, { useEffect, useState, useCallback } from 'react';
import { Box, Stack, Typography, TextField, MenuItem, CircularProgress, Alert } from '@mui/material';
import {
  GroupsOutlined, SendOutlined, DoneAllOutlined, VisibilityOutlined,
  ReplyOutlined, ErrorOutlineOutlined, FlagCircleOutlined,
} from '@mui/icons-material';
import KPICard from '../common/KPICard';
import waMessagesService from '../../services/waMessagesService';
import waCampaignsService from '../../services/waCampaignsService';

function pct(num, den) {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : 0;
}

/** @param {object} props @param {string} [props.initialCampaignId] */
export default function CampaignAnalytics({ initialCampaignId = '' }) {
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState(initialCampaignId);
  const [analytics, setAnalytics] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    waCampaignsService.listCampaigns().then((list) => {
      setCampaigns(list);
      if (!campaignId && list.length > 0) setCampaignId(list[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async (id) => {
    if (!id) { setAnalytics(null); setEnrollments([]); return; }
    setLoading(true);
    setError(null);
    try {
      const [a, e] = await Promise.all([
        waMessagesService.campaignAnalytics(id),
        waCampaignsService.listEnrollments(id),
      ]);
      setAnalytics(a);
      setEnrollments(e || []);
    } catch (err) {
      setError(err.message || 'Failed to load campaign analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(campaignId); }, [campaignId, load]);

  const totalEnrolled = enrollments.length;
  const completedEnrollments = enrollments.filter((e) => e.status === 'completed').length;
  const completionPct = pct(completedEnrollments, totalEnrolled);

  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" rowGap={1}>
        <TextField
          select size="small" label="Campaign" value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          sx={{ minWidth: 260 }}
        >
          {campaigns.length === 0 && <MenuItem value="">No campaigns</MenuItem>}
          {campaigns.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
        </TextField>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : !campaignId || !analytics ? (
        <Alert severity="info">Pick a campaign to see its analytics.</Alert>
      ) : (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3,1fr)', lg: 'repeat(4,1fr)' } }}>
          <KPICard title="Total Contacts Enrolled" value={totalEnrolled} icon={<GroupsOutlined />} variant="gradient" color="primary" />
          <KPICard title="Messages Sent" value={analytics.sent} subtitle={`${analytics.totalMessages} total messages`} icon={<SendOutlined />} variant="gradient" color="info" />
          <KPICard title="Delivery Rate" value={`${analytics.deliveryRate}%`} subtitle={`${analytics.delivered} delivered`} icon={<DoneAllOutlined />} variant="gradient" color="success" />
          <KPICard title="Read Rate" value={`${analytics.readRate}%`} subtitle={`${analytics.read} read`} icon={<VisibilityOutlined />} variant="gradient" color="success" />
          <KPICard title="Replies" value={analytics.replies} subtitle="Inbound events (count only — see note)" icon={<ReplyOutlined />} variant="gradient" color="secondary" />
          <KPICard
            title="Failures"
            value={analytics.failed}
            subtitle={analytics.cancelled > 0 ? `${analytics.cancelled} cancelled (excluded)` : undefined}
            icon={<ErrorOutlineOutlined />}
            variant="gradient"
            color={analytics.failed > 0 ? 'error' : 'success'}
          />
          <KPICard title="Completion %" value={`${completionPct}%`} subtitle={`${completedEnrollments} of ${totalEnrolled} enrollments completed`} icon={<FlagCircleOutlined />} variant="gradient" color="primary" />
        </Box>
      )}

      {!loading && analytics && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          Avg response time is not shown: replies (wa_events) aren't linked to the specific outbound message they answer in this
          data model, so a response-time metric would be fabricated. Replies are reported as a count only.
        </Typography>
      )}
    </Box>
  );
}
