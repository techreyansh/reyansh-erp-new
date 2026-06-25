// Lookup — pick an item → on-hand per location (from the cached balance snapshot,
// works offline) + recent movements (online, best-effort). cap: store.lookup.
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Button, Card, Chip, Stack, Divider } from '@mui/material';
import PickerSheet from '../../../components/PickerSheet';
import { listItems, listLocations, lookup } from '../service';

const fmtQty = (n) => (Number(n) || 0).toLocaleString('en-IN');

export default function Lookup({ api }) {
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [item, setItem] = useState(null);
  const [picker, setPicker] = useState(false);
  const [result, setResult] = useState({ balances: [], movements: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listItems(api).then((r) => setItems(r || [])).catch(() => setItems([]));
    listLocations(api).then((r) => setLocations(r || [])).catch(() => setLocations([]));
  }, [api]);

  const itemOptions = useMemo(
    () => (items || []).map((i) => ({ value: i.id, label: `${i.code} · ${i.name || ''}`.trim(), raw: i })),
    [items]
  );
  const locCode = useMemo(() => new Map((locations || []).map((l) => [l.id, l.code || l.id])), [locations]);

  const choose = async (v, o) => {
    const chosen = o?.raw || null;
    setItem(chosen);
    setPicker(false);
    if (!chosen) return;
    setLoading(true);
    try { setResult(await lookup(api, chosen.id)); }
    catch { setResult({ balances: [], movements: [] }); }
    setLoading(false);
  };

  const totalOnHand = (result.balances || []).reduce((s, b) => s + (Number(b.on_hand) || 0), 0);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '70vh' }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Stock Lookup</Typography>

      <Button variant="outlined" onClick={() => setPicker(true)} sx={{ height: 56, mb: 2 }} fullWidth>
        {item ? `${item.code} · ${item.name || ''}` : 'Pick an item'}
      </Button>

      {item && (
        <Card sx={{ p: 2, mb: 2, borderRadius: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography sx={{ fontWeight: 700 }}>{item.code}</Typography>
            <Chip label={`${fmtQty(totalOnHand)} ${item.uom || ''}`.trim()} color="primary" />
          </Stack>
          <Typography variant="caption" color="text.secondary">{item.name}</Typography>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>On hand by location</Typography>
          {loading ? (
            <Typography variant="body2" color="text.secondary">Loading…</Typography>
          ) : (result.balances || []).length === 0 ? (
            <Typography variant="body2" color="text.secondary">No stock recorded.</Typography>
          ) : (
            (result.balances || []).map((b) => (
              <Stack key={`${b.item_id}-${b.location_id}`} direction="row" justifyContent="space-between" sx={{ py: 0.25 }}>
                <Typography variant="body2">{locCode.get(b.location_id) || 'loc'}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{fmtQty(b.on_hand)}</Typography>
              </Stack>
            ))
          )}
        </Card>
      )}

      {item && (
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Recent movements</Typography>
          {(result.movements || []).length === 0 ? (
            <Typography variant="body2" color="text.secondary">{api.isOnline() ? 'No recent movements.' : 'Offline — movements unavailable.'}</Typography>
          ) : (
            (result.movements || []).map((m) => (
              <Stack key={m.id} direction="row" justifyContent="space-between" sx={{ py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.movement_type}</Typography>
                  <Typography variant="caption" color="text.secondary">{m.posted_at ? new Date(m.posted_at).toLocaleString('en-IN') : ''}</Typography>
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 700, color: (Number(m.qty_delta) || 0) < 0 ? 'error.main' : 'success.main' }}>
                  {(Number(m.qty_delta) || 0) > 0 ? '+' : ''}{fmtQty(m.qty_delta)}
                </Typography>
              </Stack>
            ))
          )}
        </Box>
      )}

      <PickerSheet open={picker} onClose={() => setPicker(false)} title="Items" options={itemOptions} onSelect={choose} />
    </Box>
  );
}
