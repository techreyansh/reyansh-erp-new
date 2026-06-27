// Inspect — pick an open WO → (optional) routed stage → check type → Pass/Fail
// (+ optional measured value) → ppc_record_qc through the offline outbox.
// cap: quality.inspect.
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Snackbar, Alert, Button, TextField, Stack, Chip, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import PickerSheet from '../../../components/PickerSheet';
import SubmitBar from '../../../components/SubmitBar';
import RecentFeed from '../../../components/RecentFeed';
import { newKey } from '../../../core/api/idempotency';
import { listOpenWOs, listStages } from '../service';
import { recordQcIntent } from '../mappers';

const CHECK_TYPES = ['incoming', 'in_process', 'final', 'dispatch'];

export default function Inspect({ api }) {
  const [wos, setWos] = useState([]);
  const [woPicker, setWoPicker] = useState(false);
  const [wo, setWo] = useState(null);
  const [stages, setStages] = useState([]);
  const [stagePicker, setStagePicker] = useState(false);
  const [stage, setStage] = useState(null);
  const [checkType, setCheckType] = useState('in_process');
  const [result, setResult] = useState(null); // 'pass' | 'fail'
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState([]);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' });

  useEffect(() => { listOpenWOs(api).then((r) => setWos(r || [])).catch(() => setWos([])); }, [api]);

  const woOptions = useMemo(() => (wos || []).map((w) => ({ value: w.id, label: `${w.wo_number} · ${w.status}`, raw: w })), [wos]);
  const stageOptions = useMemo(() => (stages || []).map((s) => ({ value: s.id, label: `${s.stage_name} · ${s.status}`, raw: s })), [stages]);

  const chooseWO = async (woId, opt) => {
    const chosen = opt?.raw || (wos || []).find((w) => w.id === woId) || null;
    setWo(chosen); setStage(null); setStages([]);
    try { setStages(await listStages(api, woId) || []); } catch { setStages([]); }
  };

  const submit = async () => {
    if (!wo || !result) return;
    setBusy(true);
    try {
      const { rpc, args } = recordQcIntent({ wo, stage, checkType, result, value });
      const idempotencyKey = newKey();
      await api.submit({ rpc, args, entity: 'open_wos', idempotencyKey });
      setFeed((f) => [{ id: idempotencyKey, title: `${wo.wo_number} · ${checkType}: ${result.toUpperCase()}${value ? ` (${value})` : ''}`, at: Date.now() }, ...f].slice(0, 20));
      setSnack({ open: true, message: 'QC recorded.', severity: 'success' });
      setResult(null); setValue('');
    } catch (e) {
      setSnack({ open: true, message: e?.message || 'Could not record QC.', severity: 'error' });
    } finally { setBusy(false); }
  };

  return (
    <Box>
      <Button variant="outlined" fullWidth onClick={() => setWoPicker(true)} sx={{ mb: 1.5, justifyContent: 'flex-start', py: 1.5 }}>
        {wo ? `${wo.wo_number} · ${wo.status}` : 'Pick a work order'}
      </Button>
      {wo && (
        <Button variant="outlined" fullWidth onClick={() => setStagePicker(true)} disabled={!stages.length} sx={{ mb: 1.5, justifyContent: 'flex-start', py: 1.5 }}>
          {stage ? `${stage.stage_name} · ${stage.status}` : (stages.length ? 'Pick a stage (optional)' : 'No routed stages — WO-level QC')}
        </Button>
      )}
      {wo && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700 }}>Check type</Typography>
          <Stack direction="row" spacing={0.75} sx={{ mt: 0.5, mb: 1.5, flexWrap: 'wrap' }} useFlexGap>
            {CHECK_TYPES.map((t) => (
              <Chip key={t} label={t.replace('_', '-')} onClick={() => setCheckType(t)} color={checkType === t ? 'primary' : 'default'} variant={checkType === t ? 'filled' : 'outlined'} sx={{ cursor: 'pointer' }} />
            ))}
          </Stack>
          <Stack direction="row" spacing={1.5} sx={{ mb: 1.5 }}>
            <Button fullWidth size="large" variant={result === 'pass' ? 'contained' : 'outlined'} color="success" startIcon={<CheckCircleIcon />} onClick={() => setResult('pass')} sx={{ py: 2 }}>Pass</Button>
            <Button fullWidth size="large" variant={result === 'fail' ? 'contained' : 'outlined'} color="error" startIcon={<CancelIcon />} onClick={() => setResult('fail')} sx={{ py: 2 }}>Fail</Button>
          </Stack>
          <TextField label="Measured value / note (optional)" value={value} onChange={(e) => setValue(e.target.value)} fullWidth size="small" />
        </>
      )}
      <Box sx={{ mt: 2 }}><RecentFeed items={feed} title="This session" emptyText="No checks recorded yet." /></Box>
      <SubmitBar label="Record QC" onSubmit={submit} busy={busy} disabled={!wo || !result} />

      <PickerSheet open={woPicker} onClose={() => setWoPicker(false)} title="Open WOs" options={woOptions} onSelect={chooseWO} />
      <PickerSheet open={stagePicker} onClose={() => setStagePicker(false)} title="Stages" options={stageOptions} onSelect={(v, o) => setStage(o?.raw || null)} />

      <Snackbar open={snack.open} autoHideDuration={3000} onClose={() => setSnack({ ...snack, open: false })} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} variant="filled" onClose={() => setSnack({ ...snack, open: false })}>{snack.message}</Alert>
      </Snackbar>
    </Box>
  );
}
