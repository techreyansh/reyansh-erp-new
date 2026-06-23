// AI Sales Copilot — context-aware sales intelligence for Reyansh. Picks a tool,
// pulls live CRM context, calls the ai-sales-copilot Edge Function, and renders
// structured output with Copy / Save-to-CRM actions. Degrades gracefully when
// the AI (GEMINI_API_KEY) isn't configured yet.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Card, CardContent, Chip, Grid, Button, Autocomplete, TextField,
  CircularProgress, Alert, IconButton, Tooltip, Divider,
} from '@mui/material';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import aiCopilot from '../../services/aiCopilotService';
import { listClients, listProspects } from '../../services/crmPipelineService';

const CATS = ['Targeting', 'Engage', 'Close', 'Grow', 'Recover', 'Manage'];

export default function AISalesCopilot() {
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
    try {
      const r = await aiCopilot.runTool(toolKey, { account, input });
      if (r.error) setErr(r.error); else setResult(r);
    } catch (e) { setErr(e.message || 'Failed'); } finally { setRunning(false); }
  }, [toolKey, account, input, needsAccount, tool]);

  const copyAll = () => {
    const text = (result?.sections || []).map((s) => `${s.heading}\n${s.body}`).join('\n\n');
    navigator.clipboard?.writeText(text).then(() => setSnack('Copied'), () => {});
  };
  const save = async () => {
    if (!account?.id) { setSnack('Select an account to save to its CRM timeline'); return; }
    try { await aiCopilot.saveToCRM(account.id, tool.label, result.sections); setSnack('Saved to CRM timeline'); }
    catch (e) { setSnack(e.message); }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <AutoAwesomeRounded color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>AI Sales Copilot</Typography>
        <Chip size="small" variant="outlined" label="context-aware" color="primary" />
      </Stack>

      <Grid container spacing={2}>
        {/* Tool catalogue */}
        <Grid item xs={12} md={4}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
            {CATS.map((cat) => {
              const tools = aiCopilot.COPILOT_TOOLS.filter((t) => t.cat === cat);
              if (!tools.length) return null;
              return (
                <Box key={cat} sx={{ mb: 1.25 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'primary.main', fontSize: '0.6rem' }}>{cat}</Typography>
                  <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                    {tools.map((t) => (
                      <Box key={t.key} onClick={() => { setToolKey(t.key); setResult(null); setErr(null); }}
                        sx={{ p: 1, borderRadius: 1.5, cursor: 'pointer', border: '1px solid', borderColor: toolKey === t.key ? 'primary.main' : 'divider', bgcolor: toolKey === t.key ? 'action.selected' : 'transparent' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.label}</Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              );
            })}
          </CardContent></Card>
        </Grid>

        {/* Run panel */}
        <Grid item xs={12} md={8}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{tool?.label}</Typography>
            <Typography variant="caption" color="text.secondary">{tool?.scope === 'base' ? 'Analyzes your whole client base.' : needsAccount ? 'Uses the selected account’s full CRM context.' : 'Free-form input.'}</Typography>
            <Stack spacing={1.5} sx={{ mt: 1.5 }}>
              {needsAccount && (
                <Autocomplete size="small" options={accounts} value={account}
                  getOptionLabel={(o) => `${o.company_name} (${o.customer_code || o.account_type})`} isOptionEqualToValue={(a, b) => a.id === b.id}
                  onChange={(e, v) => setAccount(v)} renderInput={(p) => <TextField {...p} label="Account" placeholder="Search client / prospect…" />} />
              )}
              {needsInput && (
                <TextField size="small" fullWidth multiline minRows={tool?.scope === 'input' ? 3 : 1} label={tool?.inputLabel || 'Input'} value={input} onChange={(e) => setInput(e.target.value)} />
              )}
              <Box>
                <Button variant="contained" startIcon={running ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeRounded />} onClick={run} disabled={running} sx={{ borderRadius: 2 }}>
                  {running ? 'Thinking…' : tool?.button || 'Run'}
                </Button>
              </Box>
            </Stack>

            {err && <Alert severity={/configured|GEMINI|not deployed|Failed to send|Edge Function/i.test(err) ? 'warning' : 'error'} sx={{ mt: 2, borderRadius: 2 }}>{err}</Alert>}

            {result?.sections?.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ flexGrow: 1 }}>Output</Typography>
                  <Tooltip title="Copy all"><IconButton size="small" onClick={copyAll}><ContentCopyRounded fontSize="small" /></IconButton></Tooltip>
                  {account?.id && <Tooltip title="Save to CRM timeline"><IconButton size="small" onClick={save}><SaveOutlined fontSize="small" /></IconButton></Tooltip>}
                </Stack>
                {result.sections.map((s, i) => (
                  <Box key={i} sx={{ mb: 1.5 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{s.heading}</Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>{s.body}</Typography>
                    {i < result.sections.length - 1 && <Divider sx={{ mt: 1 }} />}
                  </Box>
                ))}
              </Box>
            )}
          </CardContent></Card>
        </Grid>
      </Grid>

      {snack && <Alert severity="success" onClose={() => setSnack(null)} sx={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1400 }}>{snack}</Alert>}
    </Container>
  );
}
