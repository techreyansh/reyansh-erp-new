// WhatsApp Marketing — Campaign Wizard. Owns the 5-step wizard's navigation
// and the wa_campaigns row itself; each step component owns persistence of
// its OWN child rows (wa_campaign_steps, wa_campaign_media, wa_enrollments)
// directly via the Task 3 services, the same "self-contained widget" pattern
// WaAudienceImport (Task 7) already established.
//
// Design note (create-as-you-go, not save-at-the-end): the campaign is
// created in the DB as soon as Step 1 (Basics) is completed, not held purely
// in memory until the final Review step. This is required by the services
// this wizard builds on — createStep/enrollContacts/uploadMedia all need a
// REAL campaign_id foreign key, so Steps 2 and 3 (Audience, Messages) must
// have a persisted campaign to attach to. It also means progress is never
// lost if the wizard is closed early (the campaign just sits in 'draft').
import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, AppBar, Toolbar, Typography, IconButton, Box, Button, Stepper, Step, StepLabel,
  Stack, CircularProgress, Snackbar, Alert, useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import waCampaignsService from '../../services/waCampaignsService';
import StepBasics from './steps/StepBasics';
import StepAudience from './steps/StepAudience';
import StepMessages from './steps/StepMessages';
import StepSchedule from './steps/StepSchedule';
import StepReview from './steps/StepReview';
import { validateBusinessHours } from './wizardHelpers';

const STEPS = ['Basics', 'Audience', 'Messages', 'Schedule', 'Review'];

const DEFAULT_CAMPAIGN = {
  id: null,
  name: '',
  description: '',
  owner_email: null,
  category: '',
  status: 'draft',
  start_at: null,
  business_hours_start: 9,
  business_hours_end: 18,
  working_days_only: true,
};

export default function CampaignWizard({ campaignId = null, onClose, onSaved, notify }) {
  const theme = useTheme();
  const [step, setStep] = useState(0);
  const [campaign, setCampaign] = useState(DEFAULT_CAMPAIGN);
  const [loading, setLoading] = useState(!!campaignId);
  const [saving, setSaving] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState(() => new Set());
  const [campaignStepsCount, setCampaignStepsCount] = useState(0);
  const [snack, setSnack] = useState(null);

  const say = (message, severity = 'success') => {
    if (notify) notify(message, severity);
    else setSnack({ message, severity });
  };

  useEffect(() => {
    if (!campaignId) return;
    setLoading(true);
    waCampaignsService.getCampaign(campaignId)
      .then((c) => { setCampaign(c); setCampaignStepsCount((c.steps || []).length); })
      .catch((e) => say(e?.message || 'Failed to load campaign', 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const set = (patch) => setCampaign((c) => ({ ...c, ...patch }));

  const ensurePersisted = async (patch) => {
    if (!campaign.id) return waCampaignsService.createCampaign(patch);
    return waCampaignsService.updateCampaign(campaign.id, patch);
  };

  const businessHoursError = validateBusinessHours(campaign.business_hours_start, campaign.business_hours_end);

  const canNext = useMemo(() => {
    if (step === 0) return !!(campaign.name && campaign.name.trim());
    if (step === 2) return campaignStepsCount > 0;
    if (step === 3) return !businessHoursError;
    return true;
  }, [step, campaign.name, campaignStepsCount, businessHoursError]);

  const handleNext = async () => {
    if (step === 0) {
      if (!campaign.name || !campaign.name.trim()) { say('Campaign name is required', 'warning'); return; }
      setSaving(true);
      try {
        const saved = await ensurePersisted({
          name: campaign.name.trim(),
          description: campaign.description || null,
          owner_email: campaign.owner_email || null,
          category: campaign.category || null,
        });
        setCampaign((c) => ({ ...c, ...saved }));
        setStep(1);
      } catch (e) {
        say(e?.message || 'Could not save campaign basics', 'error');
      } finally {
        setSaving(false);
      }
      return;
    }

    if (step === 1) {
      setSaving(true);
      try {
        const ids = Array.from(selectedContactIds);
        if (ids.length) await waCampaignsService.enrollContacts(campaign.id, ids);
        setStep(2);
      } catch (e) {
        say(e?.message || 'Could not enroll selected contacts', 'error');
      } finally {
        setSaving(false);
      }
      return;
    }

    if (step === 2) {
      if (campaignStepsCount === 0) { say('Add at least one message step first', 'warning'); return; }
      setStep(3);
      return;
    }

    if (step === 3) {
      if (businessHoursError) { say(businessHoursError, 'error'); return; }
      setSaving(true);
      try {
        const saved = await ensurePersisted({
          start_at: campaign.start_at || null,
          business_hours_start: campaign.business_hours_start,
          business_hours_end: campaign.business_hours_end,
          working_days_only: campaign.working_days_only !== false,
        });
        setCampaign((c) => ({ ...c, ...saved }));
        setStep(4);
      } catch (e) {
        say(e?.message || 'Could not save the schedule', 'error');
      } finally {
        setSaving(false);
      }
    }
  };

  const handleDone = (finalStatus) => {
    onSaved?.(campaign.id, finalStatus);
    onClose?.();
  };

  return (
    <Dialog fullScreen open onClose={onClose}>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary', borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Toolbar>
          <Typography variant="h6" sx={{ fontWeight: 800, flex: 1 }}>
            {campaign.id ? `Edit campaign${campaign.name ? `: ${campaign.name}` : ''}` : 'New WhatsApp Campaign'}
          </Typography>
          <IconButton onClick={onClose}><CloseIcon /></IconButton>
        </Toolbar>
        <Box sx={{ px: 3, pb: 1.5 }}>
          <Stepper activeStep={step} alternativeLabel>
            {STEPS.map((s) => <Step key={s}><StepLabel>{s}</StepLabel></Step>)}
          </Stepper>
        </Box>
      </AppBar>

      <Box sx={{ p: { xs: 1.5, md: 3 }, bgcolor: 'background.default', minHeight: '100%', maxWidth: 900, mx: 'auto' }}>
        {loading ? (
          <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress /></Stack>
        ) : (
          <>
            {step === 0 && <StepBasics campaign={campaign} onChange={set} />}
            {step === 1 && campaign.id && (
              <StepAudience
                campaignId={campaign.id}
                selectedContactIds={selectedContactIds}
                onSelectedChange={setSelectedContactIds}
                notify={say}
              />
            )}
            {step === 2 && campaign.id && (
              <StepMessages
                campaignId={campaign.id}
                onStepsChange={(steps) => setCampaignStepsCount(steps.length)}
                notify={say}
              />
            )}
            {step === 3 && <StepSchedule campaign={campaign} onChange={set} />}
            {step === 4 && campaign.id && (
              <StepReview campaignId={campaign.id} onDone={handleDone} notify={say} />
            )}

            {step < STEPS.length - 1 && (
              <Stack direction="row" justifyContent="space-between" sx={{ mt: 3 }}>
                <Button disabled={step === 0 || saving} onClick={() => setStep((s) => s - 1)} sx={{ textTransform: 'none' }}>
                  Back
                </Button>
                <Button
                  variant="contained" disabled={!canNext || saving} onClick={handleNext}
                  startIcon={saving ? <CircularProgress size={16} /> : null}
                  sx={{ textTransform: 'none' }}
                >
                  {saving ? 'Saving…' : 'Next'}
                </Button>
              </Stack>
            )}
            {step === STEPS.length - 1 && (
              <Stack direction="row" justifyContent="flex-start" sx={{ mt: 3 }}>
                <Button disabled={saving} onClick={() => setStep((s) => s - 1)} sx={{ textTransform: 'none' }}>Back</Button>
              </Stack>
            )}
          </>
        )}
      </Box>

      {!notify && (
        <Snackbar open={!!snack} autoHideDuration={5000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
          {snack ? (
            <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)} sx={{ maxWidth: 480 }}>
              {snack.message}
            </Alert>
          ) : undefined}
        </Snackbar>
      )}
    </Dialog>
  );
}
