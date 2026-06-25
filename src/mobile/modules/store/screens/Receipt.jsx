// Material Receipt — pick an open PO, then receive each line at qty + landed rate.
// Posts one inv_receive per line through the offline outbox. cap: store.receipt.
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Snackbar, Alert, Card, TextField, Chip, Button } from '@mui/material';
import PickerSheet from '../../../components/PickerSheet';
import SubmitBar from '../../../components/SubmitBar';
import RecentFeed from '../../../components/RecentFeed';
import { newKey } from '../../../core/api/idempotency';
import { listOpenPOs } from '../service';
import { poLineToReceiveIntent } from '../mappers';

const lineCode = (l) => l.itemCode || l.ItemCode || l.item_code || l.code || '';
const lineName = (l) => l.itemName || l.ItemName || l.item || l.Item || '';
const lineQty = (l) => l.quantity || l.Quantity || l.qty || '';
const lineRate = (l) => l.price ?? l.Price ?? l.rate ?? l.unitPrice ?? l.unit_price ?? '';

export default function Receipt({ api }) {
  const [pos, setPos] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [po, setPo] = useState(null);
  const [lines, setLines] = useState([]); // [{ qty, rate }]
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState([]);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' });

  useEffect(() => {
    listOpenPOs().then((rows) => setPos(rows || [])).catch(() => setPos([]));
  }, []);

  const poOptions = useMemo(
    () => (pos || []).map((p) => ({ value: p.POId, label: `${p.POId} · ${p?.VendorDetails?.vendorName || ''}`.trim(), raw: p })),
    [pos]
  );

  const choosePO = (poId, opt) => {
    const chosen = opt?.raw || (pos || []).find((p) => p.POId === poId) || null;
    setPo(chosen);
    const items = Array.isArray(chosen?.Items) ? chosen.Items : [];
    setLines(items.map((l) => ({ qty: String(lineQty(l) || ''), rate: String(lineRate(l) || '') })));
  };

  const setLine = (i, patch) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    if (!po) return;
    setBusy(true);
    const grnRef = `GRN-${po.POId}`;
    const items = Array.isArray(po.Items) ? po.Items : [];
    const newFeed = [];
    try {
      for (let i = 0; i < items.length; i += 1) {
        const qty = Number(lines[i]?.qty) || 0;
        if (qty <= 0) continue; // skip not-received lines
        const idempotencyKey = newKey();
        const { rpc, args } = poLineToReceiveIntent(items[i], {
          grnRef,
          qty,
          locationCode: undefined, // server/STORE default
        });
        // honour the per-line edited rate
        args.p_rate = lines[i]?.rate !== '' && lines[i]?.rate != null ? Number(lines[i].rate) : args.p_rate;
        await api.submit({ rpc, args, entity: 'inv_balance', idempotencyKey });
        newFeed.push({
          id: idempotencyKey,
          primary: `Receive ${lineCode(items[i])} × ${qty}`,
          secondary: new Date().toLocaleTimeString(),
          status: 'queued',
        });
      }
      if (newFeed.length === 0) {
        setSnack({ open: true, message: 'Enter a received qty on at least one line.', severity: 'warning' });
      } else {
        setFeed((f) => [...newFeed, ...f]);
        setSnack({
          open: true,
          message: api.isOnline() ? `Received ${newFeed.length} line(s) — syncing.` : `Saved offline — ${newFeed.length} line(s) will sync.`,
          severity: 'success',
        });
        setPo(null);
        setLines([]);
      }
    } catch (e) {
      setSnack({ open: true, message: e.message || 'Receipt failed', severity: 'error' });
    }
    setBusy(false);
  };

  const items = Array.isArray(po?.Items) ? po.Items : [];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '70vh' }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>Material Receipt</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        Receive against an open PO. Each line posts inv_receive at its landed rate.
      </Typography>

      <Button variant="outlined" onClick={() => setPickerOpen(true)} sx={{ height: 56, justifyContent: 'space-between', mb: 2 }} fullWidth>
        {po ? `PO ${po.POId}` : 'Pick an open PO'}
      </Button>

      {po && items.length === 0 && (
        <Typography variant="body2" color="text.secondary">This PO has no line items.</Typography>
      )}

      {items.map((l, i) => (
        <Card key={`${lineCode(l)}-${i}`} sx={{ p: 1.5, mb: 1.5, borderRadius: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography sx={{ fontWeight: 700 }}>{lineCode(l) || 'Item'}</Typography>
            <Chip size="small" label={`ordered ${lineQty(l) || 0}`} variant="outlined" />
          </Box>
          {lineName(l) && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{lineName(l)}</Typography>}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              label="Received qty"
              value={lines[i]?.qty ?? ''}
              onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^0-9.]/g, '') })}
              inputProps={{ inputMode: 'decimal' }}
              size="small"
              fullWidth
            />
            <TextField
              label="Rate"
              value={lines[i]?.rate ?? ''}
              onChange={(e) => setLine(i, { rate: e.target.value.replace(/[^0-9.]/g, '') })}
              inputProps={{ inputMode: 'decimal' }}
              size="small"
              fullWidth
            />
          </Box>
        </Card>
      ))}

      <Box sx={{ mt: 2, flex: 1 }}>
        <RecentFeed items={feed} title="This session" emptyText="No receipts yet." />
      </Box>

      <SubmitBar label="Post Receipt" onSubmit={submit} busy={busy} disabled={!po || items.length === 0} />

      <PickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Open POs"
        options={poOptions}
        onSelect={choosePO}
      />

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
