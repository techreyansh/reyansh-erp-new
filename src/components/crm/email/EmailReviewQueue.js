// Review queue: AI drafts waiting on human approval before they're sent.
// Approve → email-send (DB trigger advances the enrollment). Edit / skip inline.
import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Paper, Stack, Typography, Button, Chip, CircularProgress, TextField, Divider, Tooltip,
} from '@mui/material';
import {
  SendRounded, CloseRounded, RefreshRounded, EditRounded, SaveRounded,
} from '@mui/icons-material';
import campaignsService from '../../../services/campaignsService';

export default function EmailReviewQueue({ notify }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState({}); // id -> {subject, body}
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await campaignsService.listReviewQueue());
    } catch (e) {
      notify(e.message || 'Failed to load review queue', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (m) => setEditing((s) => ({ ...s, [m.id]: { subject: m.subject, body: m.body } }));
  const cancelEdit = (id) => setEditing((s) => { const c = { ...s }; delete c[id]; return c; });

  const saveEdit = async (m) => {
    const e = editing[m.id];
    try {
      await campaignsService.updateMessage(m.id, { subject: e.subject, body: e.body, generated_by_ai: false });
      setItems((arr) => arr.map((x) => (x.id === m.id ? { ...x, ...e } : x)));
      cancelEdit(m.id);
      notify('Draft updated');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const approve = async (m) => {
    setBusyId(m.id);
    try {
      await campaignsService.approveAndSend(m.id);
      setItems((arr) => arr.filter((x) => x.id !== m.id));
      notify(`Sent to ${m.to_email}`);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const skip = async (m) => {
    try {
      await campaignsService.skipMessage(m.id);
      setItems((arr) => arr.filter((x) => x.id !== m.id));
      notify('Draft skipped');
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const approveAll = async () => {
    if (!window.confirm(`Send all ${items.length} drafts now?`)) return;
    for (const m of [...items]) {
      // sequential to respect ordering and surface per-message errors
      // eslint-disable-next-line no-await-in-loop
      await approve(m);
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="overline" sx={{ fontWeight: 800, color: 'text.secondary' }}>
          {items.length} draft{items.length === 1 ? '' : 's'} awaiting review
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" startIcon={<RefreshRounded />} onClick={load} sx={{ textTransform: 'none' }}>Refresh</Button>
          <Button size="small" variant="contained" startIcon={<SendRounded />} disabled={!items.length} onClick={approveAll} sx={{ textTransform: 'none' }}>
            Approve & send all
          </Button>
        </Stack>
      </Stack>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 2.5 }}>
          <Typography color="text.secondary">Nothing to review. Drafts appear here when a review-mode campaign generates emails.</Typography>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          {items.map((m) => {
            const ed = editing[m.id];
            return (
              <Paper key={m.id} variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                    <Chip size="small" color="primary" label={`Step ${m.step_order}`} />
                    <Typography sx={{ fontWeight: 700 }} noWrap>{m.contact?.full_name || m.to_email}</Typography>
                    {m.contact?.company && <Typography variant="body2" color="text.secondary" noWrap>· {m.contact.company}</Typography>}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" noWrap>{m.campaign?.name}</Typography>
                </Stack>

                {ed ? (
                  <Stack spacing={1.5}>
                    <TextField label="Subject" value={ed.subject} size="small" fullWidth
                      onChange={(e) => setEditing((s) => ({ ...s, [m.id]: { ...ed, subject: e.target.value } }))} />
                    <TextField label="Body" value={ed.body} size="small" fullWidth multiline minRows={6}
                      onChange={(e) => setEditing((s) => ({ ...s, [m.id]: { ...ed, body: e.target.value } }))} />
                    <Stack direction="row" spacing={1}>
                      <Button size="small" variant="contained" startIcon={<SaveRounded />} onClick={() => saveEdit(m)} sx={{ textTransform: 'none' }}>Save</Button>
                      <Button size="small" onClick={() => cancelEdit(m.id)} sx={{ textTransform: 'none' }}>Cancel</Button>
                    </Stack>
                  </Stack>
                ) : (
                  <>
                    <Typography sx={{ fontWeight: 600, mb: 0.5 }}>{m.subject}</Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>{m.body}</Typography>
                  </>
                )}

                <Divider sx={{ my: 1.5 }} />
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Tooltip title="To"><Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', mr: 'auto' }}>{m.to_email}</Typography></Tooltip>
                  {!ed && <Button size="small" startIcon={<EditRounded />} onClick={() => startEdit(m)} sx={{ textTransform: 'none' }}>Edit</Button>}
                  <Button size="small" color="inherit" startIcon={<CloseRounded />} onClick={() => skip(m)} sx={{ textTransform: 'none' }}>Skip</Button>
                  <Button size="small" variant="contained" startIcon={<SendRounded />} disabled={busyId === m.id} onClick={() => approve(m)} sx={{ textTransform: 'none' }}>
                    {busyId === m.id ? 'Sending…' : 'Approve & send'}
                  </Button>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
