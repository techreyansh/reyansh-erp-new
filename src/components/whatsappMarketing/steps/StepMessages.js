// Campaign Wizard — Step 3: Messages. An ordered, reorderable list of
// wa_campaign_steps rows. Each row's own fields (delay, body_text, is_active)
// persist immediately via waCampaignsService when the row's own "Save" is
// clicked (mirrors CampaignBuilder.js's per-step Save pattern, the email
// module's twin) — add/duplicate/delete/reorder/toggle persist instantly
// since those are structural, not text-editing, actions.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, IconButton, TextField, Chip, Tooltip,
  RadioGroup, Radio, FormControlLabel, CircularProgress, Alert, Switch, Divider,
} from '@mui/material';
import {
  AddRounded, ContentCopyRounded, DeleteOutlineRounded, ArrowUpwardRounded,
  ArrowDownwardRounded, AttachFileRounded, SaveRounded, AutoAwesomeRounded,
} from '@mui/icons-material';
import waCampaignsService from '../../../services/waCampaignsService';
import waMediaService from '../../../services/waMediaService';
import MediaLibraryPicker from '../MediaLibraryPicker';
import { CAMPAIGN_VARIABLES, delayKind, serializeDelay, insertAtCursor, moveItem } from '../wizardHelpers';

function draftFrom(step) {
  return { body_text: step.body_text || '', delayKind: delayKind(step), delayDays: step.delay_days || 1 };
}

export default function StepMessages({ campaignId, onStepsChange, notify }) {
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState({});
  const [mediaCounts, setMediaCounts] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [pickerStepId, setPickerStepId] = useState(null);
  const textareaRefs = useRef({});

  const refreshMediaCounts = useCallback(async () => {
    if (!campaignId) return;
    try {
      const media = await waMediaService.listMedia(campaignId);
      const counts = {};
      media.forEach((m) => { if (m.step_id) counts[m.step_id] = (counts[m.step_id] || 0) + 1; });
      setMediaCounts(counts);
    } catch { /* non-fatal — attachment counts are a nice-to-have */ }
  }, [campaignId]);

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const c = await waCampaignsService.getCampaign(campaignId);
      const loadedSteps = c.steps || [];
      setSteps(loadedSteps);
      setDrafts(Object.fromEntries(loadedSteps.map((s) => [s.id, draftFrom(s)])));
      onStepsChange?.(loadedSteps);
      await refreshMediaCounts();
    } catch (e) {
      notify?.(e?.message || 'Failed to load message steps', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  const setStepsAndNotify = (next) => { setSteps(next); onStepsChange?.(next); };

  const addStep = async () => {
    setBusyId('new');
    try {
      const created = await waCampaignsService.createStep(campaignId, {});
      const next = [...steps, created];
      setStepsAndNotify(next);
      setDrafts((d) => ({ ...d, [created.id]: draftFrom(created) }));
    } catch (e) {
      notify?.(e?.message || 'Could not add step', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const duplicateStep = async (stepId) => {
    setBusyId(stepId);
    try {
      const created = await waCampaignsService.duplicateStep(stepId);
      const next = [...steps, created];
      setStepsAndNotify(next);
      setDrafts((d) => ({ ...d, [created.id]: draftFrom(created) }));
      notify?.('Step duplicated');
    } catch (e) {
      notify?.(e?.message || 'Could not duplicate step', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const deleteStep = async (stepId) => {
    if (!window.confirm('Delete this message step? This cannot be undone.')) return;
    setBusyId(stepId);
    try {
      await waCampaignsService.deleteStep(stepId);
      const next = steps.filter((s) => s.id !== stepId);
      setStepsAndNotify(next);
      setDrafts((d) => { const { [stepId]: _drop, ...rest } = d; return rest; });
      notify?.('Step deleted');
    } catch (e) {
      notify?.(e?.message || 'Could not delete step', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (step) => {
    setBusyId(step.id);
    try {
      const saved = await waCampaignsService.updateStep(step.id, { is_active: !step.is_active });
      setStepsAndNotify(steps.map((s) => (s.id === step.id ? saved : s)));
    } catch (e) {
      notify?.(e?.message || 'Could not update step', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const reorder = async (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= steps.length) return;
    const reordered = moveItem(steps, index, targetIndex);
    setStepsAndNotify(reordered); // optimistic
    setBusyId(reordered[targetIndex].id);
    try {
      await waCampaignsService.reorderSteps(campaignId, reordered.map((s) => s.id));
      const c = await waCampaignsService.getCampaign(campaignId);
      setStepsAndNotify(c.steps || []);
    } catch (e) {
      notify?.(e?.message || 'Could not reorder steps', 'error');
      load();
    } finally {
      setBusyId(null);
    }
  };

  const updateDraft = (stepId, patch) => setDrafts((d) => ({ ...d, [stepId]: { ...d[stepId], ...patch } }));

  const isDirty = (step) => {
    const d = drafts[step.id];
    if (!d) return false;
    return d.body_text !== (step.body_text || '') || d.delayKind !== delayKind(step) || d.delayDays !== step.delay_days;
  };

  const saveStep = async (step) => {
    const d = drafts[step.id];
    setBusyId(step.id);
    try {
      const saved = await waCampaignsService.updateStep(step.id, {
        body_text: d.body_text || null,
        ...serializeDelay(d.delayKind, d.delayDays),
      });
      setStepsAndNotify(steps.map((s) => (s.id === step.id ? saved : s)));
      setDrafts((dd) => ({ ...dd, [step.id]: draftFrom(saved) }));
      notify?.(`Step ${saved.step_order + 1} saved`);
    } catch (e) {
      notify?.(e?.message || 'Could not save step', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const insertVariable = (stepId, token) => {
    const ta = textareaRefs.current[stepId];
    const d = drafts[stepId] || { body_text: '' };
    // Only trust the textarea's tracked selection while it's actually
    // focused — clicking a chip without having clicked into the textarea
    // first should append at the end, not clobber position 0.
    const focused = ta && document.activeElement === ta;
    const start = focused ? ta.selectionStart : d.body_text.length;
    const end = focused ? ta.selectionEnd : d.body_text.length;
    const { text, cursor } = insertAtCursor(d.body_text, start, end, `{{${token}}}`);
    updateDraft(stepId, { body_text: text });
    requestAnimationFrame(() => {
      if (ta) { ta.focus(); ta.setSelectionRange(cursor, cursor); }
    });
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Box>
          <Typography variant="overline" color="text.secondary">Message sequence</Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Each step sends after the chosen delay from enrollment (or from the previous step completing).
          </Typography>
        </Box>
        <Button startIcon={<AddRounded />} variant="outlined" onClick={addStep} disabled={busyId === 'new'} sx={{ textTransform: 'none' }}>
          Add step
        </Button>
      </Stack>

      {steps.length === 0 && <Alert severity="info" sx={{ mt: 1 }}>No message steps yet — add at least one.</Alert>}

      <Stack spacing={1.5} sx={{ mt: 1.5 }}>
        {steps.map((step, idx) => {
          const d = drafts[step.id] || draftFrom(step);
          const busy = busyId === step.id;
          return (
            <Paper key={step.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2, opacity: step.is_active ? 1 : 0.6 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Chip size="small" color="primary" label={`Step ${idx + 1}`} />
                {!step.is_active && <Chip size="small" label="Disabled" variant="outlined" />}
                {mediaCounts[step.id] > 0 && <Chip size="small" variant="outlined" label={`${mediaCounts[step.id]} attachment${mediaCounts[step.id] === 1 ? '' : 's'}`} />}
                <Box sx={{ flex: 1 }} />
                <Tooltip title="Move up">
                  <span><IconButton aria-label="Move up" size="small" disabled={idx === 0 || busy} onClick={() => reorder(idx, -1)}><ArrowUpwardRounded fontSize="small" /></IconButton></span>
                </Tooltip>
                <Tooltip title="Move down">
                  <span><IconButton aria-label="Move down" size="small" disabled={idx === steps.length - 1 || busy} onClick={() => reorder(idx, 1)}><ArrowDownwardRounded fontSize="small" /></IconButton></span>
                </Tooltip>
                <Tooltip title="Duplicate step">
                  <span><IconButton aria-label="Duplicate step" size="small" disabled={busy} onClick={() => duplicateStep(step.id)}><ContentCopyRounded fontSize="small" /></IconButton></span>
                </Tooltip>
                <Tooltip title={step.is_active ? 'Disable (keep, stop sending)' : 'Enable'}>
                  <Switch
                    size="small" checked={!!step.is_active} disabled={busy} onChange={() => toggleActive(step)}
                    inputProps={{ 'aria-label': step.is_active ? 'Disable (keep, stop sending)' : 'Enable' }}
                  />
                </Tooltip>
                <Tooltip title="Delete step">
                  <span><IconButton aria-label="Delete step" size="small" color="error" disabled={busy} onClick={() => deleteStep(step.id)}><DeleteOutlineRounded fontSize="small" /></IconButton></span>
                </Tooltip>
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                <RadioGroup
                  row value={d.delayKind}
                  onChange={(e) => updateDraft(step.id, { delayKind: e.target.value })}
                >
                  <FormControlLabel value="immediate" control={<Radio size="small" />} label="Immediately" />
                  <FormControlLabel value="after_days" control={<Radio size="small" />} label="After N Days" />
                </RadioGroup>
                {d.delayKind === 'after_days' && (
                  <TextField
                    type="number" size="small" label="Days" value={d.delayDays}
                    onChange={(e) => updateDraft(step.id, { delayDays: e.target.value })}
                    inputProps={{ min: 1 }} sx={{ width: 100 }}
                  />
                )}
              </Stack>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5, alignSelf: 'center' }}>Insert:</Typography>
                {CAMPAIGN_VARIABLES.map((v) => (
                  <Chip key={v} size="small" label={`{{${v}}}`} clickable onClick={() => insertVariable(step.id, v)} />
                ))}
              </Stack>

              <TextField
                fullWidth multiline minRows={3}
                inputRef={(el) => { textareaRefs.current[step.id] = el; }}
                value={d.body_text}
                onChange={(e) => updateDraft(step.id, { body_text: e.target.value })}
                placeholder="Hi {{CustomerName}}, this is {{SalesPerson}} from Reyansh International… 🙂"
              />

              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} alignItems="center" flexWrap="wrap" useFlexGap>
                <Button size="small" startIcon={<AttachFileRounded />} onClick={() => setPickerStepId(step.id)} sx={{ textTransform: 'none' }}>
                  Attach media{mediaCounts[step.id] ? ` (${mediaCounts[step.id]})` : ''}
                </Button>
                {/* V1.5: wire to a wa-ai-assist edge function — see supabase/functions/email-generate/index.ts for the pattern */}
                <Tooltip title="Coming in V1.5 — AI message generation">
                  <span>
                    <Button size="small" disabled startIcon={<AutoAwesomeRounded />} sx={{ textTransform: 'none' }}>
                      ✨ Generate with AI
                    </Button>
                  </span>
                </Tooltip>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small" variant="contained" startIcon={busy ? <CircularProgress size={14} /> : <SaveRounded />}
                  disabled={busy || !isDirty(step)} onClick={() => saveStep(step)} sx={{ textTransform: 'none' }}
                >
                  Save
                </Button>
              </Stack>
            </Paper>
          );
        })}
      </Stack>

      <Divider sx={{ my: 2 }} />

      <MediaLibraryPicker
        open={!!pickerStepId}
        campaignId={campaignId}
        stepId={pickerStepId}
        onClose={() => setPickerStepId(null)}
        onAttached={() => refreshMediaCounts()}
        notify={notify}
      />
    </Box>
  );
}
