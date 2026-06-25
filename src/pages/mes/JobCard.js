import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Stack, Card, CardContent, Typography, Button, IconButton, Chip, TextField,
  CircularProgress, Snackbar, Alert, Divider, useTheme, alpha,
} from '@mui/material';
import {
  Assignment as JobIcon, Refresh as RefreshIcon, ArrowBack as BackIcon,
  Add as PlusIcon, Remove as MinusIcon, CheckCircle as DoneIcon,
} from '@mui/icons-material';
import jobcardService from '../../services/jobcardService';

// Big touch-friendly number field with +/- steppers (gloved-operator friendly).
function NumField({ label, value, onChange, color }) {
  const n = Number(value) || 0;
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700 }}>{label}</Typography>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ mt: 0.5 }}>
        <IconButton size="large" onClick={() => onChange(Math.max(0, n - 1))} sx={{ border: '1px solid', borderColor: 'divider' }}><MinusIcon /></IconButton>
        <TextField value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
          inputProps={{ inputMode: 'numeric', style: { textAlign: 'center', fontSize: 28, fontWeight: 700, width: 90, color } }} variant="standard" />
        <IconButton size="large" onClick={() => onChange(n + 1)} sx={{ border: '1px solid', borderColor: 'divider' }}><PlusIcon /></IconButton>
      </Stack>
    </Box>
  );
}

const JobCard = () => {
  const theme = useTheme();
  const [wos, setWos] = useState([]);
  const [wo, setWo] = useState(null);
  const [stages, setStages] = useState([]);
  const [stage, setStage] = useState(null);
  const [reasons, setReasons] = useState([]);
  const [defects, setDefects] = useState([]);
  const [molds, setMolds] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const blank = { operator: '', output: '', reject: '', downtime: '', downtimeReason: null, defect: null, note: '', mold: null };
  const [form, setForm] = useState(blank);

  const loadWos = useCallback(async () => {
    setLoading(true);
    try {
      const [w, r, d, m] = await Promise.all([jobcardService.listOpenWorkOrders(), jobcardService.listReasons(), jobcardService.listDefects(), jobcardService.listMolds()]);
      setWos(w); setReasons(r); setDefects(d); setMolds(m);
    } catch (e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
    setLoading(false);
  }, []);
  useEffect(() => { loadWos(); }, [loadWos]);

  const openWo = async (w) => {
    setWo(w); setStage(null);
    try { setStages(await jobcardService.listStages(w.id)); } catch (e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
  };
  const openStage = async (s) => {
    setStage(s); setForm(blank);
    try { setRecent(await jobcardService.listStageLog(s.id)); } catch { setRecent([]); }
  };
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const post = async () => {
    if (!form.operator.trim()) { setSnackbar({ open: true, message: 'Enter your name / operator ID first.', severity: 'warning' }); return; }
    if (!form.output && !form.reject && !form.downtime) { setSnackbar({ open: true, message: 'Enter output, reject or downtime.', severity: 'warning' }); return; }
    setSaving(true);
    try {
      const res = await jobcardService.postJobcard({
        stageId: stage.id, output: form.output, reject: form.reject, downtime: form.downtime,
        downtimeReason: form.downtimeReason, defect: form.defect, operator: form.operator, note: form.note, mold: form.mold,
      });
      setSnackbar({ open: true, message: `Saved. Stage total: ${res.output_total} good, ${res.reject_total} reject.`, severity: 'success' });
      setForm((f) => ({ ...blank, operator: f.operator })); // keep operator for the next entry
      const [fresh, st] = await Promise.all([jobcardService.listStageLog(stage.id), jobcardService.listStages(wo.id)]);
      setRecent(fresh); setStages(st); setStage(st.find((x) => x.id === stage.id) || stage);
    } catch (e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
    setSaving(false);
  };

  const Hero = ({ title, sub, back }) => (
    <Card sx={{ background: `linear-gradient(135deg, ${theme.palette.success.main} 0%, ${theme.palette.success.dark} 100%)`, color: 'white', borderRadius: 3, mb: 2 }}>
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
        {back ? <IconButton onClick={back} sx={{ color: 'white' }}><BackIcon /></IconButton> : <JobIcon sx={{ fontSize: 32 }} />}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }} noWrap>{title}</Typography>
          <Typography variant="body2" sx={{ opacity: 0.9 }} noWrap>{sub}</Typography>
        </Box>
        {!back && <IconButton onClick={loadWos} sx={{ color: 'white' }}><RefreshIcon /></IconButton>}
      </CardContent>
    </Card>
  );

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>;

  // STEP 3 — single-stage entry
  if (stage) {
    const target = Number(wo.qty) || 0;
    const done = Number(stage.output_qty) || 0;
    return (
      <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 640, mx: 'auto' }}>
        <Hero title={stage.stage_name} sub={`${wo.wo_number} · ${wo.item?.name || ''}`} back={() => setStage(null)} />
        <Card sx={{ borderRadius: 3, mb: 2 }}><CardContent>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mb: 2 }}>
            Target {target} · done so far <b>{done}</b> good, {stage.scrap_qty || 0} reject
          </Typography>
          <TextField label="Your name / operator ID" value={form.operator} onChange={(e) => set('operator', e.target.value)} fullWidth sx={{ mb: 2.5 }} />
          {/mold/i.test(stage.stage_name) && molds.length > 0 && (
            <Box sx={{ mb: 2.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>Which mold?</Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mt: 0.5 }}>
                {molds.map((m) => {
                  const wear = m.tool_life_shots ? Math.round((Number(m.shots_done || 0) / Number(m.tool_life_shots)) * 100) : null;
                  return <Chip key={m.id} label={`${m.mold_number}${wear != null ? ` · ${wear}%` : ''}`} onClick={() => set('mold', form.mold === m.id ? null : m.id)} color={form.mold === m.id ? 'secondary' : wear >= 90 ? 'error' : 'default'} variant={form.mold === m.id ? 'filled' : 'outlined'} sx={{ height: 36, fontSize: 15 }} />;
                })}
              </Stack>
            </Box>
          )}
          <Stack direction="row" spacing={2} justifyContent="space-around" sx={{ mb: 2.5 }}>
            <NumField label="Good" value={form.output} onChange={(v) => set('output', v)} color={theme.palette.success.main} />
            <NumField label="Reject" value={form.reject} onChange={(v) => set('reject', v)} color={theme.palette.error.main} />
            <NumField label="Downtime (min)" value={form.downtime} onChange={(v) => set('downtime', v)} />
          </Stack>
          {Number(form.downtime) > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>Downtime reason</Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mt: 0.5 }}>
                {reasons.map((r) => <Chip key={r.id} label={r.name} onClick={() => set('downtimeReason', form.downtimeReason === r.id ? null : r.id)} color={form.downtimeReason === r.id ? 'primary' : 'default'} variant={form.downtimeReason === r.id ? 'filled' : 'outlined'} sx={{ height: 36, fontSize: 15 }} />)}
              </Stack>
            </Box>
          )}
          {Number(form.reject) > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>Defect</Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mt: 0.5 }}>
                {defects.map((d) => <Chip key={d.id} label={d.name} onClick={() => set('defect', form.defect === d.id ? null : d.id)} color={form.defect === d.id ? 'error' : 'default'} variant={form.defect === d.id ? 'filled' : 'outlined'} sx={{ height: 36, fontSize: 15 }} />)}
              </Stack>
            </Box>
          )}
          <Button onClick={post} disabled={saving} fullWidth variant="contained" color="success" size="large" sx={{ py: 1.5, fontSize: 18, fontWeight: 700 }}>
            {saving ? <CircularProgress size={26} color="inherit" /> : 'Post entry'}
          </Button>
        </CardContent></Card>
        {recent.length > 0 && (
          <Card sx={{ borderRadius: 2 }}><CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Recent entries</Typography>
            <Divider sx={{ mb: 1 }} />
            <Stack spacing={0.5}>
              {recent.map((e) => (
                <Stack key={e.id} direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                  <DoneIcon fontSize="small" color="success" />
                  <Typography variant="body2"><b>{e.output_qty}</b> good{e.reject_qty ? ` · ${e.reject_qty} reject` : ''}{e.downtime_min ? ` · ${e.downtime_min}m down` : ''}</Typography>
                  <Typography variant="caption" color="text.secondary">{e.operator_name || '—'} · {new Date(e.logged_at).toLocaleTimeString('en-IN')}</Typography>
                </Stack>
              ))}
            </Stack>
          </CardContent></Card>
        )}
        <Snackbar open={snackbar.open} autoHideDuration={3500} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
          <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
        </Snackbar>
      </Box>
    );
  }

  // STEP 2 — pick a stage
  if (wo) {
    return (
      <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 640, mx: 'auto' }}>
        <Hero title={wo.wo_number} sub={`${wo.item?.name || ''} · qty ${wo.qty}`} back={() => setWo(null)} />
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>Which stage are you working on?</Typography>
        <Stack spacing={1.5}>
          {stages.map((s) => (
            <Card key={s.id} sx={{ borderRadius: 2, cursor: 'pointer', '&:active': { bgcolor: alpha(theme.palette.success.main, 0.08) } }} onClick={() => openStage(s)}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 2 }}>
                <Box><Typography variant="h6" sx={{ fontWeight: 700 }}>{s.sequence + 1}. {s.stage_name}</Typography>
                  <Typography variant="caption" color="text.secondary">{s.output_qty || 0} good · {s.scrap_qty || 0} reject</Typography></Box>
                <Chip label={s.status} color={s.status === 'done' ? 'success' : s.status === 'running' ? 'primary' : 'default'} />
              </CardContent>
            </Card>
          ))}
          {stages.length === 0 && <Typography variant="body2" color="text.secondary">No stages on this work order.</Typography>}
        </Stack>
        <Snackbar open={snackbar.open} autoHideDuration={3500} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
          <Alert severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
        </Snackbar>
      </Box>
    );
  }

  // STEP 1 — pick a work order
  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 640, mx: 'auto' }}>
      <Hero title="Job Cards" sub="Tap your work order to log output" />
      {wos.length === 0 ? (
        <Card sx={{ borderRadius: 2 }}><CardContent sx={{ textAlign: 'center', py: 6 }}>
          <JobIcon sx={{ fontSize: 44, color: 'text.disabled', mb: 1 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>No open work orders</Typography>
          <Typography variant="body2" color="text.secondary">Once production releases a work order, it shows here for the operators to log against.</Typography>
        </CardContent></Card>
      ) : (
        <Stack spacing={1.5}>
          {wos.map((w) => (
            <Card key={w.id} sx={{ borderRadius: 2, cursor: 'pointer', '&:active': { bgcolor: alpha(theme.palette.success.main, 0.08) } }} onClick={() => openWo(w)}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 2 }}>
                <Box><Typography variant="h6" sx={{ fontWeight: 700 }}>{w.item?.name || w.item?.code || 'Item'}</Typography>
                  <Typography variant="caption" color="text.secondary">{w.wo_number} · qty {w.qty}</Typography></Box>
                <Chip label={w.status} color={w.status === 'in_progress' ? 'primary' : 'default'} />
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
      <Snackbar open={snackbar.open} autoHideDuration={3500} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
};

export default JobCard;
