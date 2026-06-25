// Material Issue — two tabs:
//   WO-kit:   pick WO → kit lines (req−issued) → NumPad qty → inv_issue_kit_line
//             plus "Issue full kit" → inv_issue_kit (allow-partial toggle).
//   Free-form: pick item → NumPad qty → STORE→WIP → inv_issue.
// All posts go through the offline outbox. cap: store.issue.
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Snackbar, Alert, Tabs, Tab, Button, Card, Chip } from '@mui/material';
import NumPad from '../../../components/NumPad';
import PickerSheet from '../../../components/PickerSheet';
import SubmitBar from '../../../components/SubmitBar';
import RecentFeed from '../../../components/RecentFeed';
import Toggle from '../../../components/Toggle';
import { newKey } from '../../../core/api/idempotency';
import { listItems, listOpenWOs, listKitLines } from '../service';
import { woLineToIssueIntent, woToIssueKitIntent, freeIssueIntent } from '../mappers';

export default function Issue({ api }) {
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState([]);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' });

  // shared lookups
  const [items, setItems] = useState([]);
  const [wos, setWos] = useState([]);

  // WO-kit tab state
  const [woPicker, setWoPicker] = useState(false);
  const [wo, setWo] = useState(null);
  const [kitLines, setKitLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState(null);
  const [kitQty, setKitQty] = useState('');
  const [allowPartial, setAllowPartial] = useState(false);

  // Free-form tab state
  const [itemPicker, setItemPicker] = useState(false);
  const [item, setItem] = useState(null);
  const [freeQty, setFreeQty] = useState('');

  useEffect(() => {
    listItems(api).then((r) => setItems(r || [])).catch(() => setItems([]));
    listOpenWOs(api).then((r) => setWos(r || [])).catch(() => setWos([]));
  }, [api]);

  const itemById = useMemo(() => new Map((items || []).map((i) => [i.id, i])), [items]);
  const itemOptions = useMemo(
    () => (items || []).map((i) => ({ value: i.id, label: `${i.code} · ${i.name || ''}`.trim(), raw: i })),
    [items]
  );
  const woOptions = useMemo(
    () => (wos || []).map((w) => ({ value: w.id, label: `${w.wo_number} · ${w.status}`, raw: w })),
    [wos]
  );

  const chooseWO = async (woId, opt) => {
    const chosen = opt?.raw || (wos || []).find((w) => w.id === woId) || null;
    setWo(chosen);
    setSelectedLine(null);
    setKitQty('');
    const lines = await listKitLines(api, woId);
    setKitLines(lines || []);
  };

  const labelFor = (itemId) => {
    const it = itemById.get(itemId);
    return it ? `${it.code}${it.name ? ` · ${it.name}` : ''}` : `Item ${itemId}`;
  };

  const submitKitLine = async () => {
    if (!selectedLine) return;
    setBusy(true);
    const idempotencyKey = newKey();
    try {
      const { rpc, args } = woLineToIssueIntent(selectedLine, Number(kitQty) || 0);
      await api.submit({ rpc, args, entity: 'inv_balance', idempotencyKey });
      setFeed((f) => [
        { id: idempotencyKey, primary: `Issue ${labelFor(selectedLine.item_id)} × ${kitQty || 0}`, secondary: new Date().toLocaleTimeString(), status: 'queued' },
        ...f,
      ]);
      setSnack({ open: true, message: api.isOnline() ? 'Issued — syncing.' : 'Saved offline — will sync.', severity: 'success' });
      setKitQty('');
      setSelectedLine(null);
    } catch (e) {
      setSnack({ open: true, message: e.message || 'Issue failed', severity: 'error' });
    }
    setBusy(false);
  };

  const submitFullKit = async () => {
    if (!wo) return;
    setBusy(true);
    const idempotencyKey = newKey();
    try {
      const { rpc, args } = woToIssueKitIntent(wo.id, allowPartial);
      await api.submit({ rpc, args, entity: 'inv_balance', idempotencyKey });
      setFeed((f) => [
        { id: idempotencyKey, primary: `Full kit ${wo.wo_number}${allowPartial ? ' (partial)' : ''}`, secondary: new Date().toLocaleTimeString(), status: 'queued' },
        ...f,
      ]);
      setSnack({ open: true, message: api.isOnline() ? 'Kit issue queued — syncing.' : 'Saved offline — will sync.', severity: 'success' });
    } catch (e) {
      setSnack({ open: true, message: e.message || 'Kit issue failed', severity: 'error' });
    }
    setBusy(false);
  };

  const submitFree = async () => {
    if (!item) return;
    setBusy(true);
    const idempotencyKey = newKey();
    try {
      const { rpc, args } = freeIssueIntent(item.code, Number(freeQty) || 0);
      await api.submit({ rpc, args, entity: 'inv_balance', idempotencyKey });
      setFeed((f) => [
        { id: idempotencyKey, primary: `Issue ${item.code} × ${freeQty || 0} (STORE→WIP)`, secondary: new Date().toLocaleTimeString(), status: 'queued' },
        ...f,
      ]);
      setSnack({ open: true, message: api.isOnline() ? 'Issued — syncing.' : 'Saved offline — will sync.', severity: 'success' });
      setFreeQty('');
    } catch (e) {
      setSnack({ open: true, message: e.message || 'Issue failed', severity: 'error' });
    }
    setBusy(false);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '70vh' }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Material Issue</Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" sx={{ mb: 2 }}>
        <Tab label="WO Kit" />
        <Tab label="Free-form" />
      </Tabs>

      {tab === 0 && (
        <Box>
          <Button variant="outlined" onClick={() => setWoPicker(true)} sx={{ height: 56, mb: 2 }} fullWidth>
            {wo ? `WO ${wo.wo_number}` : 'Pick a work order'}
          </Button>

          {wo && kitLines.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>No kit lines for this WO.</Typography>
          )}

          {kitLines.map((l) => {
            const remaining = (Number(l.qty_required) || 0) - (Number(l.qty_issued) || 0);
            const active = selectedLine?.id === l.id;
            return (
              <Card
                key={l.id}
                onClick={() => { setSelectedLine(l); setKitQty(String(remaining > 0 ? remaining : '')); }}
                sx={{ p: 1.5, mb: 1, borderRadius: 2, cursor: 'pointer', border: '2px solid', borderColor: active ? 'primary.main' : 'transparent' }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ fontWeight: 700 }}>{labelFor(l.item_id)}</Typography>
                  <Chip size="small" label={`rem ${remaining}`} color={remaining > 0 ? 'warning' : 'success'} variant="outlined" />
                </Box>
                <Typography variant="caption" color="text.secondary">
                  required {l.qty_required ?? 0} · issued {l.qty_issued ?? 0}
                </Typography>
              </Card>
            );
          })}

          {selectedLine && (
            <Box sx={{ mt: 2 }}>
              <NumPad label={`Issue qty — ${labelFor(selectedLine.item_id)}`} value={kitQty} onChange={setKitQty} />
            </Box>
          )}

          {wo && (
            <Box sx={{ mt: 2 }}>
              <Toggle label="Allow partial on full kit" checked={allowPartial} onChange={setAllowPartial} helper="Issue what's available when components are short" />
              <Button variant="text" onClick={submitFullKit} disabled={busy} sx={{ mt: 1 }} fullWidth>
                Issue full kit for {wo.wo_number}
              </Button>
            </Box>
          )}

          <Box sx={{ mt: 2 }}>
            <RecentFeed items={feed} title="This session" emptyText="Nothing issued yet." />
          </Box>

          <SubmitBar label="Issue Line" onSubmit={submitKitLine} busy={busy} disabled={!selectedLine} />
        </Box>
      )}

      {tab === 1 && (
        <Box>
          <Button variant="outlined" onClick={() => setItemPicker(true)} sx={{ height: 56, mb: 2 }} fullWidth>
            {item ? `${item.code} · ${item.name || ''}` : 'Pick an item'}
          </Button>
          {item && <NumPad label={`Issue qty — STORE→WIP — ${item.code}`} value={freeQty} onChange={setFreeQty} />}
          <Box sx={{ mt: 2 }}>
            <RecentFeed items={feed} title="This session" emptyText="Nothing issued yet." />
          </Box>
          <SubmitBar label="Issue to WIP" onSubmit={submitFree} busy={busy} disabled={!item} />
        </Box>
      )}

      <PickerSheet open={woPicker} onClose={() => setWoPicker(false)} title="Open WOs" options={woOptions} onSelect={chooseWO} />
      <PickerSheet open={itemPicker} onClose={() => setItemPicker(false)} title="Items" options={itemOptions} onSelect={(v, o) => setItem(o?.raw || null)} />

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
