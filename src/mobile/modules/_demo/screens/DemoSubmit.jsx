// STUB screen: proves the offline write path end-to-end.
//   NumPad → SubmitBar → api.submit({ rpc:'mobile_ping', args, idempotencyKey }).
// Works offline: the intent lands in the Dexie outbox and flushes (idempotently)
// when connectivity returns. A local RecentFeed shows what was queued/sent.
import React, { useState } from 'react';
import { Box, Typography, Snackbar, Alert } from '@mui/material';
import NumPad from '../../../components/NumPad';
import SubmitBar from '../../../components/SubmitBar';
import RecentFeed from '../../../components/RecentFeed';
import { newKey } from '../../../core/api/idempotency';

export default function DemoSubmit({ api }) {
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState([]);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' });

  const submit = async () => {
    setBusy(true);
    const idempotencyKey = newKey();
    try {
      const res = await api.submit({
        rpc: 'mobile_ping',
        args: { p_idempotency_key: idempotencyKey, p_value: Number(val) || 0 },
        entity: 'mobile_ping_log',
        idempotencyKey,
      });
      setFeed((f) => [
        { id: res.idempotencyKey, primary: `Ping ${val || 0}`, secondary: new Date().toLocaleTimeString(), status: 'queued' },
        ...f,
      ]);
      setSnack({ open: true, message: api.isOnline() ? 'Submitted — syncing to ERP.' : 'Saved offline — will sync when online.', severity: 'success' });
      setVal('');
    } catch (e) {
      setSnack({ open: true, message: e.message || 'Submit failed', severity: 'error' });
    }
    setBusy(false);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '70vh' }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>Offline Submit (stub)</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        Posts a trivial mobile_ping through the outbox. Try it with the network off.
      </Typography>

      <NumPad label="Ping value" value={val} onChange={setVal} />

      <Box sx={{ mt: 2, flex: 1 }}>
        <RecentFeed items={feed} title="This session" emptyText="Nothing queued yet." />
      </Box>

      <SubmitBar label="Submit Ping" onSubmit={submit} busy={busy} />

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snack.severity} variant="filled" sx={{ width: '100%' }}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
