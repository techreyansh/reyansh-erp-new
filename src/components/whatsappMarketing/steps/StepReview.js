// Campaign Wizard — Step 5: Review. Read-only summary of everything entered
// in Steps 1-4, plus the three actions that actually move the campaign out of
// the wizard: Save as Draft / Schedule / Start Now. Each persists any
// outstanding campaign-level fields then calls waCampaignsService.setStatus.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Chip, Button, CircularProgress, Alert, Divider, Tooltip,
} from '@mui/material';
import {
  SaveOutlined, ScheduleSendOutlined, RocketLaunchOutlined,
} from '@mui/icons-material';
import waCampaignsService from '../../../services/waCampaignsService';
import { delayLabel } from '../wizardHelpers';

function SummaryRow({ label, value }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right' }}>{value ?? '—'}</Typography>
    </Box>
  );
}

export default function StepReview({ campaignId, onDone, notify }) {
  const [campaign, setCampaign] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // 'draft' | 'scheduled' | 'running' | null

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, en] = await Promise.all([
        waCampaignsService.getCampaign(campaignId),
        waCampaignsService.listEnrollments(campaignId),
      ]);
      setCampaign(c);
      setEnrollments(en || []);
    } catch (e) {
      notify?.(e?.message || 'Failed to load campaign summary', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  if (loading || !campaign) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  }

  const activeSteps = campaign.steps.filter((s) => s.is_active);
  const totalMedia = campaign.media?.length || 0;

  /**
   * Move the campaign to `target` status. If it's already there, this is a
   * no-op (nothing to transition — e.g. clicking "Save as Draft" on a
   * campaign that's still in draft, which is the common case since the
   * campaign was created as draft in Step 1). waCampaignsService's state
   * machine (Task 3) has no transition BACK to 'draft' from any other
   * status, so that path surfaces a clear message instead of a raw
   * exception if attempted.
   */
  const moveTo = async (target, { requireStartAt = false, defaultStartAtNow = false } = {}) => {
    if (requireStartAt && !campaign.start_at) {
      notify?.('Set a campaign start date on the Schedule step first.', 'warning');
      return;
    }
    setBusy(target);
    try {
      if (defaultStartAtNow && !campaign.start_at) {
        await waCampaignsService.updateCampaign(campaignId, { start_at: new Date().toISOString() });
      }
      if (campaign.status !== target) {
        await waCampaignsService.setStatus(campaignId, target);
      }
      notify?.(
        target === 'draft' ? 'Saved as draft' : target === 'scheduled' ? 'Campaign scheduled' : 'Campaign started',
      );
      await load();
      onDone?.(target);
    } catch (e) {
      notify?.(e?.message || `Could not move campaign to ${target}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box>
      <Typography variant="overline" color="text.secondary">Review & launch</Typography>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mt: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" sx={{ fontWeight: 800 }}>{campaign.name}</Typography>
          <Chip size="small" color={campaign.status === 'draft' ? 'default' : 'primary'} label={campaign.status} />
        </Stack>
        {campaign.description && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{campaign.description}</Typography>}

        <Divider sx={{ my: 1.5 }} />
        <SummaryRow label="Owner" value={campaign.owner_email} />
        <SummaryRow label="Category" value={campaign.category} />
        <SummaryRow label="Audience enrolled" value={`${enrollments.length} contact${enrollments.length === 1 ? '' : 's'}`} />
        <SummaryRow label="Message steps" value={`${activeSteps.length} active / ${campaign.steps.length} total`} />
        <SummaryRow label="Media attached" value={totalMedia} />
        <SummaryRow label="Start" value={campaign.start_at ? new Date(campaign.start_at).toLocaleString() : 'Not set'} />
        <SummaryRow label="Business hours" value={`${String(campaign.business_hours_start).padStart(2, '0')}:00 – ${String(campaign.business_hours_end).padStart(2, '0')}:00`} />
        <SummaryRow label="Working days only" value={campaign.working_days_only ? 'Yes' : 'No'} />

        {campaign.steps.length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>SEQUENCE</Typography>
            <Stack spacing={0.75}>
              {campaign.steps.map((s, i) => (
                <Stack key={s.id} direction="row" spacing={1} alignItems="center">
                  <Chip size="small" label={`#${i + 1}`} />
                  <Typography variant="caption" sx={{ minWidth: 90 }}>{delayLabel(s)}</Typography>
                  <Typography variant="body2" noWrap sx={{ flex: 1, opacity: s.is_active ? 1 : 0.5 }}>
                    {s.body_text || '(empty)'}
                  </Typography>
                  {!s.is_active && <Chip size="small" variant="outlined" label="disabled" />}
                </Stack>
              ))}
            </Stack>
          </>
        )}
      </Paper>

      {campaign.steps.length === 0 && <Alert severity="warning" sx={{ mt: 2 }}>No message steps — go back and add at least one before launching.</Alert>}
      {enrollments.length === 0 && <Alert severity="warning" sx={{ mt: 1 }}>No contacts enrolled yet — go back to Audience to enroll some.</Alert>}

      <Stack direction="row" spacing={1.5} justifyContent="center" sx={{ mt: 3 }}>
        <Tooltip title={campaign.status !== 'draft' ? `Already ${campaign.status} — there is no "revert to draft" action` : ''}>
          <span>
            <Button
              variant="outlined" startIcon={busy === 'draft' ? <CircularProgress size={16} /> : <SaveOutlined />}
              disabled={!!busy || campaign.status !== 'draft'} onClick={() => moveTo('draft')} sx={{ textTransform: 'none' }}
            >
              Save as Draft
            </Button>
          </span>
        </Tooltip>
        <Button
          variant="outlined" startIcon={busy === 'scheduled' ? <CircularProgress size={16} /> : <ScheduleSendOutlined />}
          disabled={!!busy} onClick={() => moveTo('scheduled', { requireStartAt: true })} sx={{ textTransform: 'none' }}
        >
          Schedule
        </Button>
        <Button
          variant="contained" startIcon={busy === 'running' ? <CircularProgress size={16} /> : <RocketLaunchOutlined />}
          disabled={!!busy} onClick={() => moveTo('running', { defaultStartAtNow: true })} sx={{ textTransform: 'none' }}
        >
          Start Now
        </Button>
      </Stack>
    </Box>
  );
}
