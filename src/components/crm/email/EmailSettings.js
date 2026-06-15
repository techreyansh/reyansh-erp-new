// Senders: link a Gmail account (offline OAuth), test-send, and manually tick the scheduler.
import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Paper, Stack, Typography, Button, Chip, CircularProgress, TextField, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import {
  AddLinkRounded, SendRounded, LinkOffRounded, PlayCircleOutlineRounded, RefreshRounded,
  MarkChatReadRounded,
} from '@mui/icons-material';
import emailAccountsService from '../../../services/emailAccountsService';
import campaignsService from '../../../services/campaignsService';

export default function EmailSettings({ notify }) {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [testOpen, setTestOpen] = useState(null); // account
  const [test, setTest] = useState({ to: '', subject: 'Test from Reyansh ERP', body: 'Hi — this is a test from the Reyansh ERP email module.' });
  const [sending, setSending] = useState(false);
  const [running, setRunning] = useState(false);
  const [polling, setPolling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await emailAccountsService.listAccounts());
    } catch (e) {
      notify(e.message || 'Failed to load senders', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  // If we just came back from the Gmail OAuth redirect, capture the tokens.
  useEffect(() => {
    (async () => {
      if (emailAccountsService.isConnectPending()) {
        const res = await emailAccountsService.captureFromSessionIfPending();
        if (res.ok) notify(`Gmail connected: ${res.account.email}`);
        else if (res.reason === 'no_refresh_token') notify(res.detail, 'warning');
        else if (res.reason !== 'not_pending') notify(res.detail || 'Could not capture Gmail tokens', 'error');
      }
      load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    try {
      const { error } = await emailAccountsService.connectGmail();
      if (error) notify(error.message, 'error');
      // otherwise the browser redirects to Google
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const disconnect = async (a) => {
    if (!window.confirm(`Disconnect ${a.email}? Campaigns using it will stop sending.`)) return;
    try { await emailAccountsService.disconnect(a.id); notify('Disconnected'); load(); }
    catch (e) { notify(e.message, 'error'); }
  };

  const sendTest = async () => {
    if (!test.to.includes('@')) { notify('Enter a recipient', 'warning'); return; }
    setSending(true);
    try {
      await emailAccountsService.sendTest({ accountId: testOpen.id, to: test.to, subject: test.subject, body: test.body });
      notify(`Test sent to ${test.to}`);
      setTestOpen(null);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const runScheduler = async () => {
    setRunning(true);
    try {
      const r = await campaignsService.runSchedulerNow();
      notify(`Scheduler ran — sent ${r.sent}, drafted ${r.drafted}, completed ${r.completed}, skipped ${r.skipped}`, 'info');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const runReplyPoll = async () => {
    setPolling(true);
    try {
      const r = await campaignsService.runReplyPollNow();
      notify(`Reply check ran — ${r.replied} repl${r.replied === 1 ? 'y' : 'ies'} across ${r.accounts} account(s)`, 'info');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setPolling(false);
    }
  };

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="overline" sx={{ fontWeight: 800, color: 'text.secondary' }}>Linked Gmail senders</Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" startIcon={<RefreshRounded />} onClick={load} sx={{ textTransform: 'none' }}>Refresh</Button>
            <Button size="small" variant="contained" startIcon={<AddLinkRounded />} onClick={connect} sx={{ textTransform: 'none' }}>Connect Gmail</Button>
          </Stack>
        </Stack>

        <Alert severity="info" sx={{ mb: 2 }}>
          Connecting authorizes the ERP to send email <b>as you</b> via Gmail (with offline access so the scheduler can
          send in the background). Gmail consumer accounts can send ≈ 500/day. You'll be asked to approve the consent screen.
        </Alert>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : accounts.length === 0 ? (
          <Typography color="text.secondary">No Gmail linked yet. Click “Connect Gmail”.</Typography>
        ) : (
          <Stack spacing={1.25}>
            {accounts.map((a) => (
              <Paper key={a.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1}>
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography sx={{ fontWeight: 700 }}>{a.email}</Typography>
                      <Chip size="small" label={a.status} color={a.status === 'connected' ? 'success' : a.status === 'revoked' ? 'default' : 'warning'} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      Sent today: {a.sent_today_date === new Date().toISOString().slice(0, 10) ? a.sent_today : 0}
                      {a.last_error ? ` · last error: ${a.last_error}` : ''}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Button size="small" startIcon={<SendRounded />} onClick={() => setTestOpen(a)} sx={{ textTransform: 'none' }}>Send test</Button>
                    <Button size="small" color="error" startIcon={<LinkOffRounded />} onClick={() => disconnect(a)} sx={{ textTransform: 'none' }}>Disconnect</Button>
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5 }}>
        <Typography variant="overline" sx={{ fontWeight: 800, color: 'text.secondary', display: 'block', mb: 0.5 }}>Scheduler</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          In production a cron (pg_cron) ticks the scheduler every few minutes. Run it once now to generate/send any due steps.
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button variant="outlined" startIcon={<PlayCircleOutlineRounded />} onClick={runScheduler} disabled={running} sx={{ textTransform: 'none' }}>
            {running ? 'Running…' : 'Run scheduler now'}
          </Button>
          <Button variant="outlined" startIcon={<MarkChatReadRounded />} onClick={runReplyPoll} disabled={polling} sx={{ textTransform: 'none' }}>
            {polling ? 'Checking…' : 'Check replies now'}
          </Button>
        </Stack>
      </Paper>

      <Dialog open={!!testOpen} onClose={() => setTestOpen(null)} fullWidth maxWidth="sm">
        <DialogTitle>Send test from {testOpen?.email}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="To" value={test.to} onChange={(e) => setTest({ ...test, to: e.target.value })} fullWidth autoFocus />
            <TextField label="Subject" value={test.subject} onChange={(e) => setTest({ ...test, subject: e.target.value })} fullWidth />
            <TextField label="Body" value={test.body} onChange={(e) => setTest({ ...test, body: e.target.value })} fullWidth multiline minRows={4} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTestOpen(null)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" onClick={sendTest} disabled={sending} sx={{ textTransform: 'none' }}>
            {sending ? 'Sending…' : 'Send test'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
