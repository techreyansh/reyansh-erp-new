// Scan — QR/barcode → resolve to an item or location and show a quick read.
// NOTE: no item/location labels are printed yet, so scanning won't match real
// codes in production until a label-printing step exists. The pick-from-list
// flows (Issue/Receipt/Adjust/Transfer/Lookup) are the working path meanwhile.
// cap: store.scan.
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Alert, Card, Chip, Stack } from '@mui/material';
import ScanButton from '../../../components/ScanButton';
import { listItems, listLocations, lookup } from '../service';

const fmtQty = (n) => (Number(n) || 0).toLocaleString('en-IN');
const norm = (s) => String(s || '').trim().toUpperCase();

export default function Scan({ api }) {
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [match, setMatch] = useState(null); // { kind:'item'|'location', value, onHand? }

  useEffect(() => {
    listItems(api).then((r) => setItems(r || [])).catch(() => setItems([]));
    listLocations(api).then((r) => setLocations(r || [])).catch(() => setLocations([]));
  }, [api]);

  const itemByCode = useMemo(() => new Map((items || []).map((i) => [norm(i.code), i])), [items]);
  const locByCode = useMemo(() => new Map((locations || []).map((l) => [norm(l.code), l])), [locations]);

  const onResult = async (text) => {
    const code = norm(text);
    const it = itemByCode.get(code);
    if (it) {
      let onHand = null;
      try { const r = await lookup(api, it.id); onHand = (r.balances || []).reduce((s, b) => s + (Number(b.on_hand) || 0), 0); } catch { /* offline */ }
      setMatch({ kind: 'item', value: it, onHand });
      return;
    }
    const loc = locByCode.get(code);
    if (loc) { setMatch({ kind: 'location', value: loc }); return; }
    setMatch({ kind: 'none', raw: text });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '70vh' }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Scan</Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        No barcode/QR labels are printed yet — scanning won't match production codes until labels exist. Use the pick-from-list screens meanwhile.
      </Alert>

      <ScanButton label="Scan item / location" onResult={onResult} />

      <Box sx={{ mt: 2 }}>
        {match?.kind === 'item' && (
          <Card sx={{ p: 2, borderRadius: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography sx={{ fontWeight: 700 }}>{match.value.code}</Typography>
              {match.onHand != null && <Chip label={`${fmtQty(match.onHand)} ${match.value.uom || ''}`.trim()} color="primary" />}
            </Stack>
            <Typography variant="caption" color="text.secondary">{match.value.name}</Typography>
          </Card>
        )}
        {match?.kind === 'location' && (
          <Card sx={{ p: 2, borderRadius: 2 }}>
            <Typography sx={{ fontWeight: 700 }}>{match.value.code}</Typography>
            <Typography variant="caption" color="text.secondary">{match.value.name} · {match.value.kind}</Typography>
          </Card>
        )}
        {match?.kind === 'none' && (
          <Alert severity="warning">No item or location matches “{match.raw}”.</Alert>
        )}
      </Box>
    </Box>
  );
}
