// Campaigns list + create. Each row shows status + live stats and opens the builder.
import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Paper, Stack, Typography, Button, Chip, IconButton, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem, Tooltip,
} from '@mui/material';
import {
  AddRounded, PlayArrowRounded, PauseRounded, EditOutlined, DeleteOutline, RefreshRounded,
} from '@mui/icons-material';
import campaignsService from '../../../services/campaignsService';

const STATUS_COLOR = {
  draft: 'default', active: 'success', paused: 'warning', completed: 'info', archived: 'default',
};

export default function CampaignsList({ onOpen, notify }) {
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState([]);
  const [stats, setStats] = useState({});
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', ai_tone: 'professional, warm, concise' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await campaignsService.listCampaigns();
      setCampaigns(list);
      const entries = await Promise.all(list.map(async (c) => [c.id, await campaignsService.getCampaignStats(c.id)]));
      setStats(Object.fromEntries(entries));
    } catch (e) {
      notify(e.message || 'Failed to load campaigns', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.name.trim()) { notify('Give the campaign a name', 'warning'); return; }
    setSaving(true);
    try {
      const c = await campaignsService.createCampaign(form);
      setCreateOpen(false);
      setForm({ name: '', description: '', ai_tone: 'professional, warm, concise' });
      onOpen(c.id);
    } catch (e) {
      notify(e.message || 'Could not create campaign', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (c) => {
    const next = c.status === 'active' ? 'paused' : 'active';
    try {
      await campaignsService.setCampaignStatus(c.id, next);
      notify(`Campaign ${next === 'active' ? 'activated' : 'paused'}`);
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete campaign "${c.name}"? This removes its steps, enrollments and message log.`)) return;
    try {
      await campaignsService.deleteCampaign(c.id);
      notify('Campaign deleted');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="overline" sx={{ fontWeight: 800, color: 'text.secondary' }}>
          {campaigns.length} campaign{campaigns.length === 1 ? '' : 's'}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" startIcon={<RefreshRounded />} onClick={load} sx={{ textTransform: 'none' }}>Refresh</Button>
          <Button size="small" variant="contained" startIcon={<AddRounded />} onClick={() => setCreateOpen(true)} sx={{ textTransform: 'none' }}>
            New campaign
          </Button>
        </Stack>
      </Stack>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : campaigns.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 2.5 }}>
          <Typography color="text.secondary">No campaigns yet. Create one to start sending AI-personalized sequences.</Typography>
        </Paper>
      ) : (
        <Stack spacing={1.25}>
          {campaigns.map((c) => {
            const s = stats[c.id] || {};
            return (
              <Paper key={c.id} variant="outlined" sx={{ p: 1.75, borderRadius: 2.5 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={1.5}>
                  <Box sx={{ minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(c.id)}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography sx={{ fontWeight: 700 }} noWrap>{c.name}</Typography>
                      <Chip size="small" label={c.status} color={STATUS_COLOR[c.status] || 'default'} />
                      {c.review_before_send && <Chip size="small" variant="outlined" label="review on" />}
                    </Stack>
                    {c.description && <Typography variant="body2" color="text.secondary" noWrap>{c.description}</Typography>}
                  </Box>

                  <Stack direction="row" spacing={2.5} alignItems="center">
                    <Stat label="Enrolled" value={s.enrolled} />
                    <Stat label="Sent" value={s.sent} />
                    <Stat label="Opened" value={s.opened} />
                    <Stat label="Replied" value={s.replied} />
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title={c.status === 'active' ? 'Pause' : 'Activate'}>
                        <IconButton size="small" onClick={() => toggleStatus(c)}>
                          {c.status === 'active' ? <PauseRounded /> : <PlayArrowRounded />}
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Open"><IconButton size="small" onClick={() => onOpen(c.id)}><EditOutlined /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => remove(c)}><DeleteOutline /></IconButton></Tooltip>
                    </Stack>
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New campaign</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="Campaign name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth autoFocus />
            <TextField label="Description (internal)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth />
            <TextField select label="Tone" value={form.ai_tone} onChange={(e) => setForm({ ...form, ai_tone: e.target.value })} fullWidth>
              {['professional, warm, concise', 'friendly and casual', 'formal and direct', 'enthusiastic and bold'].map((t) => (
                <MenuItem key={t} value={t}>{t}</MenuItem>
              ))}
            </TextField>
            <Typography variant="caption" color="text.secondary">
              You'll add the brief, steps and sender on the next screen.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" onClick={create} disabled={saving} sx={{ textTransform: 'none' }}>
            {saving ? 'Creating…' : 'Create & configure'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function Stat({ label, value }) {
  return (
    <Box sx={{ textAlign: 'center', minWidth: 52 }}>
      <Typography sx={{ fontWeight: 800, lineHeight: 1 }}>{value ?? 0}</Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Box>
  );
}
