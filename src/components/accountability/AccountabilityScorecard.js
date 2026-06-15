import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Container, Divider, Grid, MenuItem,
  Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography, alpha, useTheme,
} from '@mui/material';
import {
  ShieldOutlined, SendOutlined, EventAvailableOutlined, InfoOutlined,
  AssignmentIndOutlined, GroupsOutlined, FiberManualRecord,
} from '@mui/icons-material';
import {
  getMyScorecard, getRoles, registerMe, updateKpi, setScorecardStatus, getMyOpenActions,
  loadScorecard, subscribeScorecard,
} from '../../services/accountabilityService';
import AccountabilityRoster from './AccountabilityRoster';

const BAND = { GREEN: '#059669', AMBER: '#D97706', RED: '#C0392B' };
const STATUS_LABEL = {
  DRAFT: 'Draft', TARGETS_SET: 'Targets set', IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted', LOCKED: 'Locked',
};

const fmtWeek = (w) => {
  if (!w) return '—';
  const s = new Date(w.week_start), e = new Date(w.week_end);
  const opt = { day: '2-digit', month: 'short' };
  return `Week ${w.iso_week} · ${s.toLocaleDateString('en-GB', opt)}–${e.toLocaleDateString('en-GB', opt)}`;
};

function Onboarding({ onDone }) {
  const [roles, setRoles] = useState([]);
  const [name, setName] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { getRoles().then(setRoles).catch(() => {}); }, []);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await registerMe(name.trim(), roleCode, 'HOD'); onDone(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2.5, maxWidth: 520, mx: 'auto', mt: 4 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
        <ShieldOutlined color="primary" />
        <Typography variant="h6" fontWeight={800}>Set up your scorecard</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        You're not on the accountability register yet. Pick your role to get your weekly KPI scorecard.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}
      <Stack spacing={2}>
        <TextField label="Your full name" value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" />
        <TextField select label="Your role" value={roleCode} onChange={(e) => setRoleCode(e.target.value)} fullWidth size="small">
          {roles.map((r) => <MenuItem key={r.code} value={r.code}>{r.name}</MenuItem>)}
        </TextField>
        <Button variant="contained" disabled={!name.trim() || !roleCode || busy} onClick={submit} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <ShieldOutlined />}>
          Create my scorecard
        </Button>
      </Stack>
    </Paper>
  );
}

const AccountabilityScorecard = () => {
  const theme = useTheme();
  const [data, setData] = useState(null);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(0);
  const [live, setLive] = useState(false);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      const res = await getMyScorecard();
      setData(res);
      if (res.registered) setActions(await getMyOpenActions(res.scorecard?.employee_id));
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live: re-pull silently when my scorecard row changes server-side.
  const myEmpId = data?.registered ? data.scorecard?.employee_id : null;
  useEffect(() => {
    if (!myEmpId) return undefined;
    setLive(true);
    const unsub = subscribeScorecard(myEmpId, () => load(false));
    return () => { setLive(false); unsub?.(); };
  }, [myEmpId, load]);

  const sc = data?.registered ? data.scorecard : null;
  const kpis = data?.registered ? data.kpis : [];
  const locked = !sc || sc.status === 'LOCKED' || sc.status === 'SUBMITTED' || sc.week?.is_locked;
  const band = sc?.band;
  const score = sc?.final_score_pct;

  const persist = async (row, patch) => {
    setSavingId(row.id);
    try {
      await updateKpi(sc.id, row.id, patch);
      const fresh = await loadScorecard(sc.id);
      setData(fresh);
    } catch (e) { setError(e.message); } finally { setSavingId(null); }
  };

  const submit = async () => {
    setLoading(true);
    try { await setScorecardStatus(sc.id, 'SUBMITTED'); await load(); }
    catch (e) { setError(e.message); setLoading(false); }
  };

  const measuredNote = useMemo(() => {
    if (!kpis.length) return null;
    const missing = kpis.filter((k) => k.achievement_pct == null).length;
    return missing > 0 ? `${missing} KPI(s) have no target/actual yet — score is on the measured weight base.` : null;
  }, [kpis]);

  if (loading && !data) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress /></Box>;
  }
  if (data && !data.registered) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 8 }}>
        {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
        <Onboarding onDone={load} />
        <Container maxWidth="xl" sx={{ px: { xs: 2, sm: 3 }, mt: 4 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
            Admin — pull the whole team in with “Sync ERP employees”, then assign each person a role.
          </Typography>
          <AccountabilityRoster />
        </Container>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 8 }}>
      {/* Hero */}
      <Box sx={{ background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 60%, ${theme.palette.primary.light} 120%)`, color: '#fff', px: { xs: 2, sm: 3 }, py: { xs: 3, md: 3.5 } }}>
        <Container maxWidth="xl" disableGutters>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} gap={2}>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.03em' }}>My Scorecard</Typography>
              <Typography variant="body1" sx={{ opacity: 0.9 }}>
                {sc?.employee?.full_name} · {sc?.employee?.role?.name}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1.5} alignItems="center">
              {live && (
                <Chip icon={<FiberManualRecord sx={{ fontSize: '10px !important', color: '#7CFFB2 !important' }} />} label="Live"
                  sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: '#fff', fontWeight: 700 }} />
              )}
              <Chip label={fmtWeek(sc?.week)} sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: '#fff', fontWeight: 700 }} />
              <Chip label={STATUS_LABEL[sc?.status] || sc?.status} sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: '#fff', fontWeight: 700 }} />
            </Stack>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ px: { xs: 2, sm: 3 }, mt: 3 }}>
        {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab icon={<AssignmentIndOutlined fontSize="small" />} iconPosition="start" label="My Scorecard" sx={{ fontWeight: 700, minHeight: 48 }} />
          <Tab icon={<GroupsOutlined fontSize="small" />} iconPosition="start" label="Team Register" sx={{ fontWeight: 700, minHeight: 48 }} />
        </Tabs>

        {tab === 1 && <AccountabilityRoster />}

        {tab === 0 && (
        <Grid container spacing={2}>
          {/* Score + actions rail */}
          <Grid item xs={12} md={3}>
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, textAlign: 'center', borderTop: `4px solid ${BAND[band] || theme.palette.divider}` }}>
              <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', letterSpacing: '0.06em' }}>
                {sc?.status === 'SUBMITTED' || sc?.status === 'LOCKED' ? 'Final score' : 'Provisional score'}
              </Typography>
              <Typography variant="h2" sx={{ fontWeight: 800, color: BAND[band] || 'text.primary', lineHeight: 1.1, my: 0.5 }}>
                {score != null ? `${score}%` : '—'}
              </Typography>
              {band && <Chip label={band} sx={{ fontWeight: 800, bgcolor: alpha(BAND[band], 0.14), color: BAND[band] }} />}
              {!locked && (
                <Button fullWidth variant="contained" startIcon={<SendOutlined />} sx={{ mt: 2 }} onClick={submit}>
                  Submit for review
                </Button>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mt: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <EventAvailableOutlined fontSize="small" color="primary" />
                <Typography variant="subtitle2" fontWeight={800}>My open actions</Typography>
              </Stack>
              {actions.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No open actions — keep it that way.</Typography>
              ) : (
                <Stack spacing={1}>
                  {actions.map((a) => (
                    <Box key={a.id} sx={{ p: 1, borderRadius: 1.5, border: '1px solid', borderColor: 'divider' }}>
                      <Typography variant="body2" fontWeight={600}>{a.title}</Typography>
                      <Typography variant="caption" color="text.secondary">Due {a.due_date} · {a.status}</Typography>
                    </Box>
                  ))}
                </Stack>
              )}
            </Paper>
          </Grid>

          {/* KPI table */}
          <Grid item xs={12} md={9}>
            {measuredNote && <Alert severity="info" icon={<InfoOutlined />} sx={{ mb: 2, borderRadius: 2 }}>{measuredNote}</Alert>}
            <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ '& th': { bgcolor: 'grey.100', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'text.secondary', whiteSpace: 'nowrap' } }}>
                      <TableCell>KPI</TableCell>
                      <TableCell align="center">Wt</TableCell>
                      <TableCell align="center">Dir</TableCell>
                      <TableCell align="center">Target</TableCell>
                      <TableCell align="center">Actual</TableCell>
                      <TableCell align="center">Ach.</TableCell>
                      <TableCell align="center">Score</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {kpis.map((k) => (
                      <KpiRow key={k.id} row={k} locked={locked} saving={savingId === k.id} onSave={persist} />
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Weights sum to 100. Achievement caps at 120%. Score recomputes on the server when you edit.
            </Typography>
          </Grid>
        </Grid>
        )}
      </Container>
    </Box>
  );
};

function KpiRow({ row, locked, saving, onSave }) {
  const theme = useTheme();
  const [target, setTarget] = useState(row.target_value ?? '');
  const [actual, setActual] = useState(row.actual_value ?? '');
  const [note, setNote] = useState(row.note ?? '');
  useEffect(() => { setTarget(row.target_value ?? ''); setActual(row.actual_value ?? ''); setNote(row.note ?? ''); }, [row.target_value, row.actual_value, row.note]);

  const isBinary = row.direction_snapshot === 'BINARY';
  const dirColor = row.direction_snapshot === 'HIGHER' ? '#059669' : row.direction_snapshot === 'LOWER' ? '#1E7DBE' : '#7C3AED';
  const ach = row.achievement_pct;
  const achColor = ach == null ? 'text.disabled' : ach >= 1 ? '#059669' : ach >= 0.7 ? '#D97706' : '#C0392B';

  const saveField = (field, value) => {
    const v = value === '' ? null : Number(value);
    if (row[field] === v) return;
    onSave(row, { [field]: v });
  };

  return (
    <TableRow hover>
      <TableCell sx={{ maxWidth: 320 }}>
        <Typography variant="body2" fontWeight={600}>{row.name_snapshot}</Typography>
        <Typography variant="caption" color="text.secondary">{row.unit_snapshot}</Typography>
      </TableCell>
      <TableCell align="center"><Typography variant="body2" fontWeight={700}>{row.weight_snapshot}</Typography></TableCell>
      <TableCell align="center">
        <Chip size="small" label={row.direction_snapshot[0]} sx={{ width: 26, fontWeight: 800, color: dirColor, bgcolor: alpha(dirColor, 0.12) }} />
      </TableCell>
      <TableCell align="center">
        {isBinary ? (
          <Typography variant="caption" color="text.secondary">Y</Typography>
        ) : (
          <TextField type="number" size="small" value={target} disabled={locked}
            onChange={(e) => setTarget(e.target.value)} onBlur={(e) => saveField('target_value', e.target.value)}
            sx={{ width: 80, '& input': { textAlign: 'center', py: 0.5 } }} />
        )}
      </TableCell>
      <TableCell align="center">
        {isBinary ? (
          <ToggleButtonGroup size="small" exclusive value={actual === '' ? null : Number(actual) >= 1 ? 'Y' : 'N'}
            disabled={locked}
            onChange={(e, val) => { if (val == null) return; const v = val === 'Y' ? 1 : 0; setActual(v); onSave(row, { actual_value: v }); }}>
            <ToggleButton value="Y" sx={{ px: 1.25, py: 0.25 }}>Y</ToggleButton>
            <ToggleButton value="N" sx={{ px: 1.25, py: 0.25 }}>N</ToggleButton>
          </ToggleButtonGroup>
        ) : (
          <TextField type="number" size="small" value={actual} disabled={locked}
            onChange={(e) => setActual(e.target.value)} onBlur={(e) => saveField('actual_value', e.target.value)}
            sx={{ width: 80, '& input': { textAlign: 'center', py: 0.5 } }} />
        )}
      </TableCell>
      <TableCell align="center">
        {saving ? <CircularProgress size={14} /> : (
          <Typography variant="body2" fontWeight={700} sx={{ color: achColor }}>
            {ach == null ? '—' : `${Math.round(ach * 100)}%`}
          </Typography>
        )}
      </TableCell>
      <TableCell align="center">
        <Typography variant="body2" color="text.secondary">{row.weighted_score == null ? '—' : Number(row.weighted_score).toFixed(2)}</Typography>
      </TableCell>
    </TableRow>
  );
}

export default AccountabilityScorecard;
