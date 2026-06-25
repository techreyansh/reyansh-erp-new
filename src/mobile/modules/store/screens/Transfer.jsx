// Rack Transfer — item → from-location → to-location → qty → inv_transfer
// (posts an OUT + IN pair, value carried). cap: store.transfer.
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Snackbar, Alert, Button, Stack } from '@mui/material';
import NumPad from '../../../components/NumPad';
import PickerSheet from '../../../components/PickerSheet';
import SubmitBar from '../../../components/SubmitBar';
import RecentFeed from '../../../components/RecentFeed';
import { newKey } from '../../../core/api/idempotency';
import { listItems, listLocations } from '../service';
import { transferIntent } from '../mappers';

export default function Transfer({ api }) {
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [item, setItem] = useState(null);
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [qty, setQty] = useState('');
  const [picker, setPicker] = useState(null); // 'item' | 'from' | 'to' | null
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState([]);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' });

  useEffect(() => {
    listItems(api).then((r) => setItems(r || [])).catch(() => setItems([]));
    listLocations(api).then((r) => setLocations(r || [])).catch(() => setLocations([]));
  }, [api]);

  const itemOptions = useMemo(
    () => (items || []).map((i) => ({ value: i.id, label: `${i.code} · ${i.name || ''}`.trim(), raw: i })),
    [items]
  );
  const locOptions = useMemo(
    () => (locations || []).map((l) => ({ value: l.code, label: `${l.code} · ${l.name || ''}`.trim(), raw: l })),
    [locations]
  );

  const sameLoc = from && to && from.code === to.code;

  const submit = async () => {
    if (!item || !from || !to || sameLoc) return;
    setBusy(true);
    const idempotencyKey = newKey();
    try {
      const { rpc, args } = transferIntent({ itemCode: item.code, fromCode: from.code, toCode: to.code, qty: Number(qty) || 0 });
      await api.submit({ rpc, args, entity: 'inv_balance', idempotencyKey });
      setFeed((f) => [
        { id: idempotencyKey, primary: `Move ${item.code} × ${qty || 0}: ${from.code}→${to.code}`, secondary: new Date().toLocaleTimeString(), status: 'queued' },
        ...f,
      ]);
      setSnack({ open: true, message: api.isOnline() ? 'Transfer queued — syncing.' : 'Saved offline — will sync.', severity: 'success' });
      setQty('');
    } catch (e) {
      setSnack({ open: true, message: e.message || 'Transfer failed', severity: 'error' });
    }
    setBusy(false);
  };

  const onPick = (v, o) => {
    const raw = o?.raw || null;
    if (picker === 'item') setItem(raw);
    else if (picker === 'from') setFrom(raw);
    else if (picker === 'to') setTo(raw);
    setPicker(null);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '70vh' }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Rack Transfer</Typography>

      <Button variant="outlined" onClick={() => setPicker('item')} sx={{ height: 56, mb: 1.5 }} fullWidth>
        {item ? `${item.code} · ${item.name || ''}` : 'Pick an item'}
      </Button>
      <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
        <Button variant="outlined" onClick={() => setPicker('from')} sx={{ height: 56, flex: 1 }}>
          {from ? `From ${from.code}` : 'From'}
        </Button>
        <Button variant="outlined" onClick={() => setPicker('to')} sx={{ height: 56, flex: 1 }} color={sameLoc ? 'error' : 'primary'}>
          {to ? `To ${to.code}` : 'To'}
        </Button>
      </Stack>
      {sameLoc && <Typography variant="caption" color="error" sx={{ mb: 1 }}>From and To must differ.</Typography>}

      {item && from && to && !sameLoc && <NumPad label={`Qty — ${from.code}→${to.code}`} value={qty} onChange={setQty} />}

      <Box sx={{ mt: 2, flex: 1 }}>
        <RecentFeed items={feed} title="This session" emptyText="Nothing transferred yet." />
      </Box>

      <SubmitBar label="Transfer" onSubmit={submit} busy={busy} disabled={!item || !from || !to || sameLoc} />

      <PickerSheet
        open={picker !== null}
        onClose={() => setPicker(null)}
        title={picker === 'item' ? 'Items' : 'Locations'}
        options={picker === 'item' ? itemOptions : locOptions}
        onSelect={onPick}
      />

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack((s) => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ width: '100%' }}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
