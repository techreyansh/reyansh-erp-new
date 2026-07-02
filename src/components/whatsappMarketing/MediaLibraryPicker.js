// WhatsApp Marketing — per-campaign media library picker. Opened from
// StepMessages' "Attach media" action for one message step at a time. Shows
// every media file already uploaded for the campaign (across all steps, plus
// any unattached), lets the user upload new files (scoped to the step being
// edited) and multi-select existing files to (re)attach to that step.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Stack, Typography, Button,
  IconButton, Chip, CircularProgress, Alert, Checkbox, Tooltip,
} from '@mui/material';
import {
  CloseRounded, CloudUploadRounded, ImageRounded, VideocamRounded, DescriptionRounded,
  AudiotrackRounded, InsertDriveFileRounded, CheckCircleRounded,
} from '@mui/icons-material';
import waMediaService from '../../services/waMediaService';
import { computeMediaAttachDiff } from './wizardHelpers';

const CATEGORY_ICON = {
  image: <ImageRounded fontSize="small" />,
  video: <VideocamRounded fontSize="small" />,
  document: <DescriptionRounded fontSize="small" />,
  audio: <AudiotrackRounded fontSize="small" />,
  other: <InsertDriveFileRounded fontSize="small" />,
};

const CATEGORY_COLOR = {
  image: 'success',
  video: 'info',
  document: 'warning',
  audio: 'secondary',
  other: 'default',
};

function MediaThumb({ item }) {
  const [thumbUrl, setThumbUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (item.category === 'image') {
      waMediaService.mediaUrl(item.storage_path).then((url) => { if (!cancelled) setThumbUrl(url); }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [item.category, item.storage_path]);

  if (item.category === 'image' && thumbUrl) {
    return (
      <Box
        component="img"
        src={thumbUrl}
        alt={item.file_name || 'media'}
        sx={{ width: '100%', height: 88, objectFit: 'cover', borderRadius: 1.5, bgcolor: 'action.hover' }}
      />
    );
  }
  return (
    <Box sx={{
      width: '100%', height: 88, borderRadius: 1.5, bgcolor: 'action.hover',
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary',
    }}
    >
      {CATEGORY_ICON[item.category] || CATEGORY_ICON.other}
    </Box>
  );
}

/**
 * Props:
 *  - open, onClose()
 *  - campaignId (required — media are always scoped to a campaign)
 *  - stepId (the step currently being edited; new uploads + "attach" target this step)
 *  - onAttached(mediaForStep[]) — called after a successful Attach with the
 *    step's final media list, so StepMessages can show an attachment count.
 *  - notify(message, severity)
 */
export default function MediaLibraryPicker({ open, campaignId, stepId, onClose, onAttached, notify }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    try {
      const media = await waMediaService.listMedia(campaignId);
      setItems(media);
      setSelected(new Set(media.filter((m) => m.step_id === stepId).map((m) => m.id)));
    } catch (e) {
      setError(e?.message || 'Failed to load media library');
    } finally {
      setLoading(false);
    }
  }, [campaignId, stepId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (fileRef.current) fileRef.current.value = '';
    if (!files.length || !campaignId) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        await waMediaService.uploadMedia(campaignId, stepId, file);
      }
      notify?.(`Uploaded ${files.length} file${files.length === 1 ? '' : 's'}`);
      await load();
    } catch (e) {
      setError(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const attach = async () => {
    setError(null);
    const { toAttach, toDetach } = computeMediaAttachDiff(items, selected, stepId);
    // toAttach also includes previously-unattached media (item.step_id is
    // null) — only the subset that's *currently on a different step* is a
    // steal that deserves a confirmation before silently moving it.
    const reassignedCount = toAttach.filter((id) => {
      const item = items.find((m) => m.id === id);
      return item?.step_id && item.step_id !== stepId;
    }).length;
    if (reassignedCount > 0) {
      const ok = window.confirm(
        `${reassignedCount} file${reassignedCount === 1 ? ' is' : 's are'} currently attached to another step. `
        + `Attaching ${reassignedCount === 1 ? 'it' : 'them'} here will remove ${reassignedCount === 1 ? 'it' : 'them'} from the other step. Continue?`,
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      // eslint-disable-next-line no-restricted-syntax
      for (const id of toAttach) {
        // eslint-disable-next-line no-await-in-loop
        await waMediaService.attachMediaToStep(id, stepId);
      }
      // eslint-disable-next-line no-restricted-syntax
      for (const id of toDetach) {
        // eslint-disable-next-line no-await-in-loop
        await waMediaService.attachMediaToStep(id, null);
      }
      const media = await waMediaService.listMedia(campaignId);
      const forStep = media.filter((m) => m.step_id === stepId);
      onAttached?.(forStep);
      notify?.(`${forStep.length} file${forStep.length === 1 ? '' : 's'} attached to this step`);
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Could not update attachments');
    } finally {
      setSaving(false);
    }
  };

  const stepCount = useMemo(() => items.filter((m) => selected.has(m.id)).length, [items, selected]);

  return (
    <Dialog open={!!open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          Media library
          <Typography variant="caption" color="text.secondary" display="block">
            Select files to attach to this message step, or upload new ones.
          </Typography>
        </Box>
        <IconButton onClick={onClose}><CloseRounded /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
          <input ref={fileRef} type="file" hidden multiple onChange={handleUpload} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" />
          <Button
            variant="outlined" startIcon={uploading ? <CircularProgress size={16} /> : <CloudUploadRounded />}
            disabled={uploading || !campaignId} onClick={() => fileRef.current?.click()} sx={{ textTransform: 'none' }}
          >
            {uploading ? 'Uploading…' : 'Upload media'}
          </Button>
          <Chip size="small" color="primary" label={`${stepCount} selected for this step`} />
        </Stack>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        ) : items.length === 0 ? (
          <Box sx={{ py: 5, textAlign: 'center' }}>
            <Typography color="text.secondary">No media uploaded for this campaign yet.</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5 }}>
            {items.map((item) => {
              const isSelected = selected.has(item.id);
              return (
                <Box
                  key={item.id}
                  onClick={() => toggle(item.id)}
                  sx={{
                    position: 'relative', p: 1, borderRadius: 2, cursor: 'pointer',
                    border: '2px solid', borderColor: isSelected ? 'primary.main' : 'divider',
                    bgcolor: isSelected ? 'action.selected' : 'background.paper',
                  }}
                >
                  <Checkbox
                    checked={isSelected}
                    size="small"
                    icon={<Box sx={{ width: 18, height: 18, borderRadius: '50%', border: '1px solid', borderColor: 'divider' }} />}
                    checkedIcon={<CheckCircleRounded color="primary" fontSize="small" />}
                    sx={{ position: 'absolute', top: 2, right: 2, p: 0.5, zIndex: 1 }}
                  />
                  <MediaThumb item={item} />
                  <Tooltip title={item.file_name || ''}>
                    <Typography variant="caption" noWrap sx={{ display: 'block', mt: 0.75, fontWeight: 600 }}>
                      {item.file_name || 'file'}
                    </Typography>
                  </Tooltip>
                  <Chip
                    size="small" variant="outlined" label={item.category || 'other'}
                    color={CATEGORY_COLOR[item.category] || 'default'}
                    sx={{ height: 18, fontSize: 10, mt: 0.5 }}
                  />
                  {item.step_id && item.step_id !== stepId && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
                      on another step
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button
          variant="contained" onClick={attach} disabled={saving || loading}
          startIcon={saving ? <CircularProgress size={16} /> : null}
          sx={{ textTransform: 'none' }}
        >
          {saving ? 'Saving…' : `Attach (${stepCount})`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
