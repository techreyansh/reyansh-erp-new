// Stock Adjustment (cycle count) — pick item + location → counted qty →
// inv_adjust (sets on-hand to the absolute counted value). cap: store.adjust.
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Snackbar, Alert, Button } from '@mui/material';
import NumPad from '../../../components/NumPad';
import PickerSheet from '../../../components/PickerSheet';
import SubmitBar from '../../../components/SubmitBar';
import RecentFeed from '../../../components/RecentFeed';
import { newKey } from '../../../core/api/idempotency';
import { listItems, listLocations } from '../service';
import { countToAdjustIntent } from '../mappers';

export default function Adjust({ api }) {
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [item, setItem] = useState(null);
  const [loc, setLoc] = useState(null);
  const [qty, setQty] = useState('');
  const [itemPicker, setItemPicker] = useState(false);
  const [locPicker, setLocPicker] = useState(false);
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

  const submit = async () => {
    if (!item || !loc) return;
    setBusy(true);
    const idempotencyKey = newKey();
    try {
      const { rpc, args } = countToAdjustIntent({ itemCode: item.code, locationCode: loc.code, countedQty: Number(qty) || 0 });
      await api.submit({ rpc, args, entity: 'inv_balance', idempotencyKey });
      setFeed((f) => [
        { id: idempotencyKey, primary: `Count ${item.code} @ ${loc.code} = ${qty || 0}`, secondary: new Date().toLocaleTimeString(), status: 'queued' },
        ...f,
      ]);
      setSnack({ open: true, message: api.isOnline() ? 'Adjusted — syncing.' : 'Saved offline — will sync.', severity: 'success' });
      setQty('');
    } catch (e) {
      setSnack({ open: true, message: e.message || 'Adjustment failed', severity: 'error' });
    }
    setBusy(false);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '70vh' }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Stock Adjustment</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 2 }}>
        Set the counted on-hand for an item at a location.
      </Typography>

      <Button variant="outlined" onClick={() => setItemPicker(true)} sx={{ height: 56, mb: 1.5 }} fullWidth>
        {item ? `${item.code} · ${item.name || ''}` : 'Pick an item'}
      </Button>
      <Button variant="outlined" onClick={() => setLocPicker(true)} sx={{ height: 56, mb: 2 }} fullWidth>
        {loc ? `${loc.code} · ${loc.name || ''}` : 'Pick a location'}
      </Button>

      {item && loc && <NumPad label={`Counted qty — ${item.code} @ ${loc.code}`} value={qty} onChange={setQty} />}

      <Box sx={{ mt: 2, flex: 1 }}>
        <RecentFeed items={feed} title="This session" emptyText="Nothing adjusted yet." />
      </Box>

      <SubmitBar label="Post Count" onSubmit={submit} busy={busy} disabled={!item || !loc} />

      <PickerSheet open={itemPicker} onClose={() => setItemPicker(false)} title="Items" options={itemOptions} onSelect={(v, o) => setItem(o?.raw || null)} />
      <PickerSheet open={locPicker} onClose={() => setLocPicker(false)} title="Locations" options={locOptions} onSelect={(v, o) => setLoc(o?.raw || null)} />

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack((s) => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ width: '100%' }}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
