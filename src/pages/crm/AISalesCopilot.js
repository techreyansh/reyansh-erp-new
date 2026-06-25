// AI Sales Copilot — Dashboard (data-driven, works now) + 13 context-aware tools
// (need the NVIDIA_API_KEY Nemotron secret to respond). Reyansh manufacturing sales intelligence.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Card, CardContent, Chip, Grid, Button, Autocomplete, TextField,
  CircularProgress, Alert, IconButton, Tooltip, Divider, Tabs, Tab, Table, TableHead, TableRow, TableCell, TableBody,
} from '@mui/material';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import aiCopilot from '../../services/aiCopilotService';
import { listClients, listProspects, clientHealth, repWorklist } from '../../services/crmPipelineService';

const CATS = ['Targeting', 'Engage', 'Close', 'Grow', 'Recover', 'Manage'];
const BAND = { green: 'success', yellow: 'warning', red: 'error' };
const inrK = (n) => { const v = Number(n || 0); return v >= 1e7 ? `₹${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : v ? `₹${v.toLocaleString('en-IN')}` : '—'; };

function DashboardTab() {
  const [health, setHealth] = useState([]);
  const [work, setWork] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ai, setAi] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState(null);

  useEffect(() => { (async () => {
    try { const [h, w] = await Promise.all([clientHealth().catch(() => []), repWorklist(null).catch(() => [])]); setHealth(h || []); setWork(w || []); }
    finally { setLoading(false); }
  })(); }, []);

  const atRisk = useMemo(() => health.filter((h) => h.band === 'red').sort((a, b) => a.health_score - b.health_score), [health]);
  const recovery = useMemo(() => health.filter((h) => h.due_status === 'overdue' || (h.recency_days || 0) > 120).sort((a, b) => (b.value_12mo || 0) - (a.value_12mo || 0)), [health]);
  const topValue = useMemo(() => [...health].sort((a, b) => (b.value_12mo || 0) - (a.value_12mo || 0)).slice(0, 8), [health]);
  const followups = useMemo(() => work.filter((w) => (w.reasons || []).some((r) => /followup|payment|reorder/.test(r.code || ''))), [work]);

  const runAi = async () => {
    setAiBusy(true); setAiErr(null); setAi(null);
    try { const r = await aiCopilot.runTool('pipeline', {}); if (r.error) setAiErr(r.error); else setAi(r.sections); }
    catch (e) { setAiErr(e.message); } finally { setAiBusy(false); }
  };

  if (loading) return <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress /></Stack>;
  const KPIList = ({ title, color, rows, render, empty }) => (
    <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
      <Box sx={{ px: 2, py: 1, bgcolor: 'action.hover', display: 'flex', gap: 1, alignItems: 'center' }}><Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{title}</Typography><Chip size="small" color={color} label={rows.length} /></Box>
      {rows.length === 0 ? <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">{empty}</Typography></Box> : <Box sx={{ p: 1 }}>{rows.slice(0, 8).map(render)}</Box>}
    </Card>
  );
  const row = (name, right, key, sub) => (
    <Stack key={key} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}><Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{name}</Typography>{sub && <Typography variant="caption" color="text.secondary" noWrap>{sub}</Typography>}</Box>{right}
    </Stack>
  );

  return (
    <Box>
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {[['Accounts at risk', atRisk.length, 'error'], ['Recovery queue', recovery.length, 'warning'], ['Needs follow-up', followups.length, 'info'], ['Clients tracked', health.length, 'primary']].map(([l, v, c]) => (
          <Grid item xs={6} sm={3} key={l}><Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.58rem' }}>{l}</Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, color: `${c}.main` }}>{v}</Typography>
          </CardContent></Card></Grid>
        ))}
      </Grid>
      <Grid container spacing={2}>
        <Grid item xs={12} md={4}><KPIList title="Accounts at risk" color="error" rows={atRisk} empty="No at-risk accounts." render={(h) => row(h.company_name, <Chip size="small" color="error" variant="outlined" label={h.health_score} />, h.customer_code, `${h.recency_days}d since order`)} /></Grid>
        <Grid item xs={12} md={4}><KPIList title="Recovery queue" color="warning" rows={recovery} empty="Nothing dormant." render={(h) => row(h.company_name, <Typography variant="caption" sx={{ fontWeight: 700 }}>{inrK(h.value_12mo)}</Typography>, h.customer_code, h.due_status)} /></Grid>
        <Grid item xs={12} md={4}><KPIList title="Top revenue accounts" color="success" rows={topValue} empty="No data." render={(h) => row(h.company_name, <Typography variant="caption" sx={{ fontWeight: 700 }}>{inrK(h.value_12mo)}</Typography>, h.customer_code, `health ${h.health_score}`)} /></Grid>
      </Grid>

      <Card variant="outlined" sx={{ borderRadius: 2, mt: 2 }}><CardContent>
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }}><Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1 }}>AI Recommendations</Typography>
          <Button size="small" variant="outlined" startIcon={aiBusy ? <CircularProgress size={14} /> : <AutoAwesomeRounded fontSize="small" />} onClick={runAi} disabled={aiBusy} sx={{ borderRadius: 2 }}>Prioritize my pipeline</Button>
        </Stack>
        {aiErr && <Alert severity="warning" sx={{ borderRadius: 2 }}>{aiErr}</Alert>}
        {ai && ai.map((s, i) => <Box key={i} sx={{ mb: 1 }}><Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{s.heading}</Typography><Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{s.body}</Typography></Box>)}
        {!ai && !aiErr && <Typography variant="body2" color="text.secondary">Click to have the AI rank your open pipeline (needs the NVIDIA Nemotron key).</Typography>}
      </CardContent></Card>
    </Box>
  );
}

function ToolsTab() {
  const [accounts, setAccounts] = useState([]);
  const [toolKey, setToolKey] = useState('oem_research');
  const [account, setAccount] = useState(null);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [snack, setSnack] = useState(null);

  useEffect(() => { (async () => {
    try {
      const [cl, pr] = await Promise.all([listClients().catch(() => []), listProspects().catch(() => [])]);
      const map = (arr, t) => (arr || []).map((a) => ({ id: a.id, company_name: a.company_name, customer_code: a.customer_code, account_type: t }));
      setAccounts([...map(cl, 'client'), ...map(pr, 'prospect')]);
    } catch { /* ignore */ }
  })(); }, []);

  const tool = useMemo(() => aiCopilot.COPILOT_TOOLS.find((t) => t.key === toolKey), [toolKey]);
  const needsAccount = tool?.scope === 'account' || tool?.needsAccount;
  const needsInput = tool?.scope === 'input' || tool?.needsInput;

  const run = useCallback(async () => {
    setErr(null); setResult(null);
    if (needsAccount && !account) { setErr('Select an account for this tool.'); return; }
    if (tool?.scope === 'input' && !input.trim()) { setErr('Enter the input text for this tool.'); return; }
    setRunning(true);
    try { const r = await aiCopilot.runTool(toolKey, { account, input }); if (r.error) setErr(r.error); else setResult(r); }
    catch (e) { setErr(e.message || 'Failed'); } finally { setRunning(false); }
  }, [toolKey, account, input, needsAccount, tool]);

  const copyAll = () => navigator.clipboard?.writeText((result?.sections || []).map((s) => `${s.heading}\n${s.body}`).join('\n\n')).then(() => setSnack('Copied'), () => {});
  const save = async () => { if (!account?.id) { setSnack('Select an account to save'); return; } try { await aiCopilot.saveToCRM(account.id, tool.label, result.sections); setSnack('Saved to CRM timeline'); } catch (e) { setSnack(e.message); } };

  return (
    <Grid container spacing={2}>
      <Grid item xs={12} md={4}><Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
        {CATS.map((cat) => { const tools = aiCopilot.COPILOT_TOOLS.filter((t) => t.cat === cat); if (!tools.length) return null;
          return (<Box key={cat} sx={{ mb: 1.25 }}><Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'primary.main', fontSize: '0.6rem' }}>{cat}</Typography>
            <Stack spacing={0.5} sx={{ mt: 0.5 }}>{tools.map((t) => (
              <Box key={t.key} onClick={() => { setToolKey(t.key); setResult(null); setErr(null); }} sx={{ p: 1, borderRadius: 1.5, cursor: 'pointer', border: '1px solid', borderColor: toolKey === t.key ? 'primary.main' : 'divider', bgcolor: toolKey === t.key ? 'action.selected' : 'transparent' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.label}</Typography></Box>))}
            </Stack></Box>);
        })}
      </CardContent></Card></Grid>
      <Grid item xs={12} md={8}><Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{tool?.label}</Typography>
        <Typography variant="caption" color="text.secondary">{tool?.scope === 'base' ? 'Analyzes your whole client base.' : needsAccount ? 'Uses the selected account’s full CRM context.' : 'Free-form input.'}</Typography>
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          {needsAccount && <Autocomplete size="small" options={accounts} value={account} getOptionLabel={(o) => `${o.company_name} (${o.customer_code || o.account_type})`} isOptionEqualToValue={(a, b) => a.id === b.id} onChange={(e, v) => setAccount(v)} renderInput={(p) => <TextField {...p} label="Account" placeholder="Search client / prospect…" />} />}
          {needsInput && <TextField size="small" fullWidth multiline minRows={tool?.scope === 'input' ? 3 : 1} label={tool?.inputLabel || 'Input'} value={input} onChange={(e) => setInput(e.target.value)} />}
          <Box><Button variant="contained" startIcon={running ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeRounded />} onClick={run} disabled={running} sx={{ borderRadius: 2 }}>{running ? 'Thinking…' : tool?.button || 'Run'}</Button></Box>
        </Stack>
        {err && <Alert severity={/configured|NVIDIA|GEMINI|not deployed|send a request|Edge Function/i.test(err) ? 'warning' : 'error'} sx={{ mt: 2, borderRadius: 2 }}>{err}</Alert>}
        {result?.sections?.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Stack direction="row" alignItems="center" sx={{ mb: 1 }}><Typography variant="overline" color="text.secondary" sx={{ flexGrow: 1 }}>Output</Typography>
              <Tooltip title="Copy all"><IconButton size="small" onClick={copyAll}><ContentCopyRounded fontSize="small" /></IconButton></Tooltip>
              {account?.id && <Tooltip title="Save to CRM timeline"><IconButton size="small" onClick={save}><SaveOutlined fontSize="small" /></IconButton></Tooltip>}
            </Stack>
            {result.sections.map((s, i) => (<Box key={i} sx={{ mb: 1.5 }}><Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{s.heading}</Typography><Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>{s.body}</Typography>{i < result.sections.length - 1 && <Divider sx={{ mt: 1 }} />}</Box>))}
          </Box>
        )}
      </CardContent></Card></Grid>
      {snack && <Alert severity="success" onClose={() => setSnack(null)} sx={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1400 }}>{snack}</Alert>}
    </Grid>
  );
}

export default function AISalesCopilot() {
  const [tab, setTab] = useState(0);
  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <AutoAwesomeRounded color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>AI Sales Copilot</Typography>
        <Chip size="small" variant="outlined" label="context-aware" color="primary" />
      </Stack>
      <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Dashboard" /><Tab label="Copilot Tools" />
      </Tabs>
      {tab === 0 ? <DashboardTab /> : <ToolsTab />}
    </Container>
  );
}
