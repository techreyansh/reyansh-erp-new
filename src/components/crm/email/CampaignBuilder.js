// Campaign builder: settings (brief/tone/sender/guardrails) + step editor + enroll.
import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Paper, Stack, Typography, Button, TextField, MenuItem, Switch, FormControlLabel,
  IconButton, Divider, Chip, CircularProgress, Slider, Tooltip, Autocomplete, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import {
  ArrowBackRounded, AddRounded, DeleteOutline, SaveRounded, AutoAwesomeRounded,
  ScheduleSendRounded,
} from '@mui/icons-material';
import campaignsService from '../../../services/campaignsService';
import emailAccountsService from '../../../services/emailAccountsService';

export default function CampaignBuilder({ campaignId, onBack, notify }) {
  const [loading, setLoading] = useState(true);
  const [campaign, setCampaign] = useState(null);
  const [steps, setSteps] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [toEnroll, setToEnroll] = useState([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);   // { to, subject, preview_text, body }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, st, acc, en, ct] = await Promise.all([
        campaignsService.getCampaign(campaignId),
        campaignsService.listSteps(campaignId),
        emailAccountsService.listAccounts(),
        campaignsService.listEnrollments(campaignId),
        campaignsService.listContacts({ status: 'active' }),
      ]);
      setCampaign(c);
      setSteps(st.length ? st : [blankStep(1)]);
      setAccounts(acc);
      setEnrollments(en);
      setContacts(ct);
    } catch (e) {
      notify(e.message || 'Failed to load campaign', 'error');
    } finally {
      setLoading(false);
    }
  }, [campaignId, notify]);

  useEffect(() => { load(); }, [load]);

  const set = (patch) => setCampaign((c) => ({ ...c, ...patch }));

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const { id, created_at, updated_at, created_by, ...patch } = campaign;
      await campaignsService.updateCampaign(campaignId, patch);
      notify('Settings saved');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const saveStep = async (step, idx) => {
    try {
      const saved = await campaignsService.upsertStep({
        campaign_id: campaignId,
        step_order: step.step_order,
        delay_days: Number(step.delay_days) || 0,
        delay_hours: Number(step.delay_hours) || 0,
        goal: step.goal,
        subject_hint: step.subject_hint || null,
        is_active: step.is_active !== false,
        ...(step.id ? { id: step.id } : {}),
      });
      setSteps((arr) => arr.map((s, i) => (i === idx ? saved : s)));
      notify(`Step ${step.step_order} saved`);
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const addStep = () => setSteps((arr) => [...arr, blankStep(arr.length + 1)]);

  const removeStep = async (step, idx) => {
    if (step.id) {
      try { await campaignsService.deleteStep(step.id); } catch (e) { notify(e.message, 'error'); return; }
    }
    setSteps((arr) => arr.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_order: i + 1 })));
  };

  const enroll = async () => {
    if (!toEnroll.length) return;
    try {
      const n = await campaignsService.enroll(campaignId, toEnroll.map((c) => c.id));
      notify(`Enrolled ${n} contact${n === 1 ? '' : 's'}`);
      setToEnroll([]);
      const en = await campaignsService.listEnrollments(campaignId);
      setEnrollments(en);
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const previewFirstStep = async (existing) => {
    const step = steps[0];
    const sample = existing?.to ? contacts.find((c) => c.email === existing.to) || contacts[0]
      : contacts[0] || { email: 'sample@acme.com', first_name: 'Sample', company: 'Acme Cables' };
    if (!step?.goal) { notify('Add a goal to step 1 first', 'warning'); return; }
    setPreviewing(true);
    try {
      const draft = await campaignsService.generateDraft({
        contact: sample,
        campaign,
        step: { step_order: 1, goal: step.goal, subject_hint: step.subject_hint },
      });
      setPreview({ to: sample.email, subject: draft.subject, preview_text: draft.preview_text, body: draft.body });
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setPreviewing(false);
    }
  };

  if (loading || !campaign) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  }

  const enrolledIds = new Set(enrollments.map((e) => e.contact_id));
  const enrollable = contacts.filter((c) => !enrolledIds.has(c.id));

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Button startIcon={<ArrowBackRounded />} onClick={onBack} sx={{ textTransform: 'none' }}>All campaigns</Button>
        <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>{campaign.name}</Typography>
        <Chip size="small" color={campaign.status === 'active' ? 'success' : 'default'} label={campaign.status} />
      </Stack>

      {/* SETTINGS */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 2 }}>
        <SectionTitle>Brief & AI</SectionTitle>
        <Stack spacing={2}>
          <TextField
            label="AI brief — who we are, what we offer, the goal of this campaign"
            value={campaign.ai_brief || ''} onChange={(e) => set({ ai_brief: e.target.value })}
            fullWidth multiline minRows={3}
            placeholder="We're Reyansh International, a manufacturer of cables, power cords and molded products. We're reaching out to OEMs and distributors who…"
          />
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField select label="Tone" value={campaign.ai_tone || ''} onChange={(e) => set({ ai_tone: e.target.value })} sx={{ flex: 1 }}>
              {['professional, warm, concise', 'friendly and casual', 'formal and direct', 'enthusiastic and bold'].map((t) => (
                <MenuItem key={t} value={t}>{t}</MenuItem>
              ))}
            </TextField>
            <TextField label="From name" value={campaign.from_name || ''} onChange={(e) => set({ from_name: e.target.value })} sx={{ flex: 1 }} placeholder="Abhishek · Reyansh International" />
          </Stack>
          <TextField
            label="Signature / sign-off the AI should use"
            value={campaign.ai_signature || ''} onChange={(e) => set({ ai_signature: e.target.value })}
            fullWidth multiline minRows={2}
            placeholder={'Warm regards,\nAbhishek Jain\nReyansh International\n+91 …'}
          />
        </Stack>

        <Divider sx={{ my: 2 }} />
        <SectionTitle>Sending & guardrails</SectionTitle>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField select label="Send from (Gmail)" value={campaign.sending_account_id || ''} onChange={(e) => set({ sending_account_id: e.target.value })} sx={{ flex: 1 }}
              helperText={accounts.length ? '' : 'No Gmail linked yet — connect one in the Senders tab'}>
              {accounts.map((a) => <MenuItem key={a.id} value={a.id}>{a.email}{a.status !== 'connected' ? ` (${a.status})` : ''}</MenuItem>)}
            </TextField>
            <TextField type="number" label="Daily send cap" value={campaign.daily_send_cap ?? 200} onChange={(e) => set({ daily_send_cap: Number(e.target.value) })} sx={{ flex: 1 }} inputProps={{ min: 1, max: 500 }} helperText="Gmail consumer limit ≈ 500/day" />
          </Stack>
          <Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>Send window (IST): {campaign.send_window_start}:00 – {campaign.send_window_end}:00</Typography>
            <Slider
              value={[campaign.send_window_start ?? 9, campaign.send_window_end ?? 18]}
              onChange={(_, v) => set({ send_window_start: v[0], send_window_end: v[1] })}
              min={0} max={23} marks valueLabelDisplay="auto" disableSwap
            />
          </Box>
          <Stack direction="row" flexWrap="wrap" gap={2}>
            <FormControlLabel control={<Switch checked={!!campaign.review_before_send} onChange={(e) => set({ review_before_send: e.target.checked })} />} label="Review drafts before sending" />
            <FormControlLabel control={<Switch checked={!!campaign.stop_on_reply} onChange={(e) => set({ stop_on_reply: e.target.checked })} />} label="Stop sequence on reply" />
            <FormControlLabel control={<Switch checked={!!campaign.send_on_weekends} onChange={(e) => set({ send_on_weekends: e.target.checked })} />} label="Send on weekends" />
            <Tooltip title="Sends an HTML email with a 1×1 tracking pixel. Off = plain text (best deliverability).">
              <FormControlLabel control={<Switch checked={!!campaign.track_opens} onChange={(e) => set({ track_opens: e.target.checked })} />} label="Track opens" />
            </Tooltip>
          </Stack>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button variant="contained" startIcon={<SaveRounded />} onClick={saveSettings} disabled={savingSettings} sx={{ textTransform: 'none' }}>
            {savingSettings ? 'Saving…' : 'Save settings'}
          </Button>
          <Button variant="outlined" startIcon={<AutoAwesomeRounded />} onClick={() => previewFirstStep()} disabled={previewing} sx={{ textTransform: 'none' }}>
            {previewing ? 'Generating…' : 'Preview AI email'}
          </Button>
        </Stack>
      </Paper>

      {/* STEPS */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <SectionTitle>Sequence steps</SectionTitle>
          <Button size="small" startIcon={<AddRounded />} onClick={addStep} sx={{ textTransform: 'none' }}>Add step</Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Each step's <b>goal</b> tells the AI what to write. Delay is measured from the previous step (step 1 = from enrollment).
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          {steps.map((step, idx) => (
            <Paper key={idx} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Chip size="small" color="primary" label={`Step ${step.step_order}`} />
                <Box sx={{ flex: 1 }} />
                <Tooltip title="Delete step"><IconButton size="small" color="error" onClick={() => removeStep(step, idx)}><DeleteOutline /></IconButton></Tooltip>
              </Stack>
              <Stack spacing={1.5}>
                <TextField
                  label="Goal of this email" value={step.goal || ''}
                  onChange={(e) => setSteps((arr) => arr.map((s, i) => (i === idx ? { ...s, goal: e.target.value } : s)))}
                  fullWidth multiline minRows={2}
                  placeholder={idx === 0 ? 'Introduce Reyansh, hook on a relevant pain point, ask for a quick call' : 'Gentle follow-up with a new angle — a case study or a specific product fit'}
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                  <TextField label="Subject hint (optional)" value={step.subject_hint || ''}
                    onChange={(e) => setSteps((arr) => arr.map((s, i) => (i === idx ? { ...s, subject_hint: e.target.value } : s)))}
                    sx={{ flex: 1 }} />
                  <TextField type="number" label="Delay days" value={step.delay_days ?? 0}
                    onChange={(e) => setSteps((arr) => arr.map((s, i) => (i === idx ? { ...s, delay_days: e.target.value } : s)))}
                    sx={{ width: 120 }} inputProps={{ min: 0 }} />
                  <TextField type="number" label="Delay hours" value={step.delay_hours ?? 0}
                    onChange={(e) => setSteps((arr) => arr.map((s, i) => (i === idx ? { ...s, delay_hours: e.target.value } : s)))}
                    sx={{ width: 120 }} inputProps={{ min: 0 }} />
                  <Button variant="outlined" size="small" startIcon={<SaveRounded />} onClick={() => saveStep(step, idx)} sx={{ textTransform: 'none' }}>Save</Button>
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
      </Paper>

      {/* ENROLL */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
        <SectionTitle>Audience ({enrollments.length} enrolled)</SectionTitle>
        {!campaign.sending_account_id && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>Link a Gmail sender (Senders tab) and set it above before activating — the scheduler needs it to send.</Alert>
        )}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
          <Autocomplete
            multiple sx={{ flex: 1 }} options={enrollable} value={toEnroll}
            onChange={(_, v) => setToEnroll(v)}
            getOptionLabel={(o) => `${o.full_name || o.email}${o.company ? ` · ${o.company}` : ''}`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => <TextField {...params} label="Add contacts to this campaign" placeholder="Search audience…" />}
          />
          <Button variant="contained" startIcon={<ScheduleSendRounded />} onClick={enroll} disabled={!toEnroll.length} sx={{ textTransform: 'none' }}>
            Enroll {toEnroll.length || ''}
          </Button>
        </Stack>

        <Divider sx={{ my: 1.5 }} />
        {enrollments.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No one enrolled yet.</Typography>
        ) : (
          <Stack spacing={0.75}>
            {enrollments.slice(0, 50).map((e) => (
              <Stack key={e.id} direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 0.5 }}>
                <Typography variant="body2" noWrap>{e.contact?.full_name || e.contact?.email}{e.contact?.company ? ` · ${e.contact.company}` : ''}</Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" color="text.secondary">step {e.current_step}</Typography>
                  <Chip size="small" variant="outlined" label={e.status} />
                </Stack>
              </Stack>
            ))}
            {enrollments.length > 50 && <Typography variant="caption" color="text.secondary">+{enrollments.length - 50} more…</Typography>}
          </Stack>
        )}
      </Paper>

      {/* AI EMAIL PREVIEW */}
      <Dialog open={!!preview} onClose={() => setPreview(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>
          AI email preview
          <Typography variant="caption" color="text.secondary" display="block">Sample for {preview?.to} · this is exactly what each recipient gets, personalised to them.</Typography>
        </DialogTitle>
        <DialogContent dividers>
          {preview && (
            <Stack spacing={1.5}>
              <Box><Typography variant="caption" color="text.secondary">SUBJECT</Typography><Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{preview.subject}</Typography></Box>
              {preview.preview_text && <Box><Typography variant="caption" color="text.secondary">PREVIEW TEXT</Typography><Typography variant="body2" color="text.secondary">{preview.preview_text}</Typography></Box>}
              <Divider />
              <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 2 }}>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{preview.body}</Typography>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(null)}>Close</Button>
          <Button variant="contained" startIcon={<AutoAwesomeRounded />} disabled={previewing} onClick={() => previewFirstStep(preview)}>{previewing ? 'Regenerating…' : 'Regenerate'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

const blankStep = (order) => ({ step_order: order, delay_days: order === 1 ? 0 : 3, delay_hours: 0, goal: '', subject_hint: '', is_active: true });

function SectionTitle({ children }) {
  return <Typography variant="overline" sx={{ fontWeight: 800, color: 'text.secondary', display: 'block', mb: 1 }}>{children}</Typography>;
}
