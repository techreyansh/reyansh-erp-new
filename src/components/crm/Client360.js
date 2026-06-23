// Client-360 — full account hub (A Phase 2). Opens for a CLIENT from the CRM
// board. Health score + every operational signal (sales, production, dispatch,
// finance/AR, engagement, complaints) wired to client360Service + crm data.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Drawer, Box, Stack, Typography, Chip, Tabs, Tab, Table, TableHead, TableRow, TableCell,
  TableBody, CircularProgress, IconButton, Grid, TextField, MenuItem, Button, Tooltip, Avatar, Alert,
} from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CallRounded from '@mui/icons-material/CallRounded';
import WhatsApp from '@mui/icons-material/WhatsApp';
import EmailOutlined from '@mui/icons-material/EmailOutlined';
import crmPipelineService from '../../services/crmPipelineService';
import client360Service from '../../services/client360Service';
import aiCopilot from '../../services/aiCopilotService';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';

const AI_ACTIONS = [
  { key: 'oem_research', label: 'Analyze Account' },
  { key: 'persona', label: 'Decision-Maker', input: true },
  { key: 'recovery', label: 'Recover / Re-engage' },
  { key: 'relationship', label: 'Relationship Insights' },
  { key: 'outreach', label: 'Outreach' },
  { key: 'followup', label: 'Follow-Up Plan' },
];

function AICopilotTab({ account, notify }) {
  const [busy, setBusy] = useState(null);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState(null);
  const [input, setInput] = useState('');
  const run = async (toolKey) => {
    setBusy(toolKey); setErr(null); setOut(null);
    try {
      const r = await aiCopilot.runTool(toolKey, { account, input });
      if (r.error) setErr(r.error); else setOut({ tool: toolKey, sections: r.sections });
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };
  const save = async () => { try { await aiCopilot.saveToCRM(account.id, out.tool, out.sections); notify?.('Saved to timeline'); } catch (e) { notify?.(e.message, 'error'); } };
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">AI Copilot — uses this account's full context</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ my: 1 }}>
        {AI_ACTIONS.map((a) => (
          <Button key={a.key} size="small" variant="outlined" startIcon={busy === a.key ? <CircularProgress size={14} /> : <AutoAwesomeRounded fontSize="small" />} disabled={!!busy} onClick={() => run(a.key)} sx={{ borderRadius: 2 }}>{a.label}</Button>
        ))}
      </Stack>
      <TextField size="small" fullWidth placeholder="Optional: decision-maker designation / extra notes" value={input} onChange={(e) => setInput(e.target.value)} sx={{ mb: 1 }} />
      {err && <Alert severity={/configured|GEMINI|Edge Function|send a request/i.test(err) ? 'warning' : 'error'} sx={{ mt: 1 }}>{err}</Alert>}
      {out?.sections?.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Stack direction="row" justifyContent="flex-end"><Button size="small" onClick={save}>Save to timeline</Button></Stack>
          {out.sections.map((s, i) => (
            <Box key={i} sx={{ mb: 1.5 }}><Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{s.heading}</Typography><Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{s.body}</Typography></Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const BAND = { green: '#2e7d32', yellow: '#ed6c02', red: '#d32f2f' };
const dt = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

function HealthGauge({ health }) {
  if (!health) return <Chip size="small" variant="outlined" label="Health: n/a" />;
  const c = BAND[health.band] || '#888';
  return (
    <Tooltip title={`Order ${health.components?.order_recency} · Contact ${health.components?.contact} · Pay ${health.components?.payments} · Complaints ${health.components?.complaints} · Freq ${health.components?.frequency}`}>
      <Box sx={{ textAlign: 'center', px: 1.5, py: 0.5, borderRadius: 2, border: `2px solid ${c}`, minWidth: 78 }}>
        <Typography variant="h5" sx={{ fontWeight: 800, color: c, lineHeight: 1 }}>{health.health_score}</Typography>
        <Typography variant="caption" sx={{ color: c, fontWeight: 700, textTransform: 'uppercase', fontSize: '0.55rem' }}>Health</Typography>
      </Box>
    </Tooltip>
  );
}

function MiniTable({ cols, rows, render, empty }) {
  if (!rows || rows.length === 0) return <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>{empty}</Typography>;
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small"><TableHead><TableRow>{cols.map((c) => <TableCell key={c} sx={{ fontWeight: 700, fontSize: '0.68rem' }}>{c}</TableCell>)}</TableRow></TableHead>
        <TableBody>{rows.map((r, i) => <TableRow key={i} hover>{render(r)}</TableRow>)}</TableBody></Table>
    </Box>
  );
}

export default function Client360({ account, onClose, notify }) {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState(null);
  const [crm, setCrm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [act, setAct] = useState({ activity_type: 'note', subject: '', body: '', next_follow_up_date: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bundle, company, contacts] = await Promise.all([
        client360Service.getClient360(account),
        crmPipelineService.getCompany(account.id),
        crmPipelineService.listContacts(account.id),
      ]);
      setData(bundle); setCrm({ ...company, contacts });
    } finally { setLoading(false); }
  }, [account]);
  useEffect(() => { load(); }, [load]);

  const saveActivity = async () => {
    if (!act.subject && !act.body) return;
    try { await crmPipelineService.addActivity(account.id, act); setAct({ activity_type: 'note', subject: '', body: '', next_follow_up_date: '' }); notify?.('Activity logged'); load(); }
    catch (e) { notify?.(e.message || 'Failed', 'error'); }
  };

  const s = data?.summary || {};
  const c = crm?.company || account;
  const TABS = ['Overview', 'Sales', 'Production & Dispatch', 'Finance', 'Engagement', 'Complaints', 'AI Copilot'];

  return (
    <Drawer anchor="right" open onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', md: 980 }, maxWidth: '100%' } }}>
      {/* Header */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>{c.company_name || account.company_name}</Typography>
              <Chip size="small" label={c.customer_code || account.customer_code} sx={{ fontFamily: 'monospace' }} />
              {c.client_stage && <Chip size="small" color="primary" variant="outlined" label={String(c.client_stage).replace(/_/g, ' ')} />}
            </Stack>
            <Typography variant="caption" color="text.secondary">{c.industry || '—'}{c.city ? ` · ${c.city}` : ''}{c.owner_email ? ` · ${c.owner_email}` : ' · unassigned'}</Typography>
          </Box>
          {data && <HealthGauge health={data.health} />}
          <Stack direction="row" spacing={0.5}>
            {c.phone && <Tooltip title="Call"><IconButton size="small" component="a" href={`tel:${c.phone}`}><CallRounded fontSize="small" /></IconButton></Tooltip>}
            {c.phone && <Tooltip title="WhatsApp"><IconButton size="small" component="a" href={`https://wa.me/${String(c.phone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><WhatsApp fontSize="small" /></IconButton></Tooltip>}
            {c.email && <Tooltip title="Email"><IconButton size="small" component="a" href={`mailto:${c.email}`}><EmailOutlined fontSize="small" /></IconButton></Tooltip>}
            <IconButton onClick={onClose}><CloseRounded /></IconButton>
          </Stack>
        </Stack>
        {/* KPI strip */}
        <Stack direction="row" spacing={2} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
          {[['Orders', s.totalOrders, 'text.primary'], ['Open orders', s.openOrders, 'primary.main'], ['Outstanding', inr(s.outstanding), s.outstanding ? 'error.main' : 'success.main'], ['Billed', inr(s.billed), 'text.primary'], ['Open complaints', s.openComplaints, s.openComplaints ? 'error.main' : 'success.main']].map(([l, v, col]) => (
            <Box key={l}><Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.58rem', display: 'block' }}>{l}</Typography><Typography variant="subtitle2" sx={{ fontWeight: 800, color: col }}>{v ?? 0}</Typography></Box>
          ))}
        </Stack>
      </Box>

      <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ borderBottom: 1, borderColor: 'divider' }}>
        {TABS.map((t) => <Tab key={t} label={t} />)}
      </Tabs>

      {loading || !data ? <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress /></Stack> : (
        <Box sx={{ p: 2, overflowY: 'auto' }}>
          {/* OVERVIEW */}
          {tab === 0 && (
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <Typography variant="overline" color="text.secondary">Company</Typography>
                {[['GSTIN', c.gstin], ['Payment terms', c.payment_terms], ['Credit limit', c.credit_limit ? inr(c.credit_limit) : null], ['Annual potential', c.annual_potential ? inr(c.annual_potential) : null], ['Lead source', c.lead_source], ['Rating', c.rating]].filter(([, v]) => v).map(([k, v]) => (
                  <Stack key={k} direction="row" justifyContent="space-between" sx={{ py: 0.25 }}><Typography variant="body2" color="text.secondary">{k}</Typography><Typography variant="body2" sx={{ fontWeight: 600 }}>{v}</Typography></Stack>
                ))}
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="overline" color="text.secondary">Contacts ({crm?.contacts?.length || 0})</Typography>
                {(crm?.contacts || []).map((ct, i) => (
                  <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ py: 0.25 }}><Avatar sx={{ width: 24, height: 24, fontSize: 12 }}>{(ct.contact_person || '?')[0]}</Avatar><Box><Typography variant="body2" sx={{ fontWeight: 600 }}>{ct.contact_person}</Typography><Typography variant="caption" color="text.secondary">{ct.designation || ''} {ct.phone || ''}</Typography></Box></Stack>
                ))}
                {!crm?.contacts?.length && <Typography variant="body2" color="text.secondary">No contacts.</Typography>}
              </Grid>
            </Grid>
          )}
          {/* SALES */}
          {tab === 1 && (
            <Stack spacing={2}>
              <Box><Typography variant="overline" color="text.secondary">Products ({data.products.length})</Typography>
                <MiniTable cols={['Code', 'Product', 'Status', 'Rev']} rows={data.products} empty="No products linked." render={(r) => <><TableCell sx={{ fontFamily: 'monospace' }}>{r.product_code}</TableCell><TableCell>{r.product_name}</TableCell><TableCell>{r.status}</TableCell><TableCell>{r.current_revision}</TableCell></>} /></Box>
              <Box><Typography variant="overline" color="text.secondary">Quotations ({data.quotations.length})</Typography>
                <MiniTable cols={['Quote', 'Date', 'Total', 'Status']} rows={data.quotations} empty="No quotations." render={(r) => <><TableCell>{r.quote_number}</TableCell><TableCell>{dt(r.quote_date)}</TableCell><TableCell>{inr(r.total)}</TableCell><TableCell>{r.status}</TableCell></>} /></Box>
              <Box><Typography variant="overline" color="text.secondary">Sales orders ({data.orders.length})</Typography>
                <MiniTable cols={['SO', 'PO', 'Value', 'Expected', 'Status']} rows={data.orders} empty="No sales orders." render={(r) => <><TableCell sx={{ fontFamily: 'monospace' }}>{r.so_number}</TableCell><TableCell>{r.po_number || '—'}</TableCell><TableCell>{inr(r.total_value)}</TableCell><TableCell>{dt(r.expected_dispatch_date)}</TableCell><TableCell>{r.status}</TableCell></>} /></Box>
            </Stack>
          )}
          {/* PRODUCTION & DISPATCH */}
          {tab === 2 && (
            <Stack spacing={2}>
              <Box><Typography variant="overline" color="text.secondary">Production demand ({data.prodDemand.length})</Typography>
                <MiniTable cols={['SO', 'Product', 'Qty', 'Required', 'Status']} rows={data.prodDemand} empty="No production demand." render={(r) => <><TableCell sx={{ fontFamily: 'monospace' }}>{r.so_number}</TableCell><TableCell>{r.product_name}</TableCell><TableCell>{r.qty} {r.uom}</TableCell><TableCell>{dt(r.required_date)}</TableCell><TableCell>{r.status}</TableCell></>} /></Box>
              <Box><Typography variant="overline" color="text.secondary">Order cycles ({data.orderCycles.length})</Typography>
                <MiniTable cols={['Order', 'Stage', 'Amount', 'Date']} rows={data.orderCycles} empty="No order cycles." render={(r) => <><TableCell>{r.order_number}</TableCell><TableCell><Chip size="small" variant="outlined" label={String(r.cycle_stage || '').replace(/_/g, ' ')} /></TableCell><TableCell>{inr(r.amount)}</TableCell><TableCell>{dt(r.order_date)}</TableCell></>} /></Box>
              <Box><Typography variant="overline" color="text.secondary">Dispatches ({data.dispatches.length})</Typography>
                <MiniTable cols={['SO', 'Planned', 'Dispatched', 'Status']} rows={data.dispatches} empty="No dispatches." render={(r) => <><TableCell sx={{ fontFamily: 'monospace' }}>{r.so_number}</TableCell><TableCell>{dt(r.dispatch_date)}</TableCell><TableCell>{dt(r.actual_dispatch_date)}</TableCell><TableCell>{r.status}</TableCell></>} /></Box>
            </Stack>
          )}
          {/* FINANCE */}
          {tab === 3 && (
            <Box>
              <Stack direction="row" spacing={3} sx={{ mb: 1.5 }}>
                <Box><Typography variant="caption" color="text.secondary">Billed</Typography><Typography variant="h6" sx={{ fontWeight: 800 }}>{inr(s.billed)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Outstanding</Typography><Typography variant="h6" sx={{ fontWeight: 800, color: s.outstanding ? 'error.main' : 'success.main' }}>{inr(s.outstanding)}</Typography></Box>
              </Stack>
              <MiniTable cols={['Invoice', 'Date', 'Amount', 'Balance', 'Due', 'Status']} rows={data.invoices} empty="No invoices." render={(r) => <><TableCell sx={{ fontFamily: 'monospace' }}>{r.invoice_number}</TableCell><TableCell>{dt(r.invoice_date)}</TableCell><TableCell>{inr(r.amount)}</TableCell><TableCell sx={{ color: Number(r.balance) > 0 ? 'error.main' : 'text.primary', fontWeight: 600 }}>{inr(r.balance)}</TableCell><TableCell>{dt(r.due_date)}</TableCell><TableCell>{r.status}</TableCell></>} />
            </Box>
          )}
          {/* ENGAGEMENT */}
          {tab === 4 && (
            <Stack spacing={2}>
              <Box sx={{ p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider' }}>
                <Typography variant="overline" color="text.secondary">Log activity</Typography>
                <Grid container spacing={1} sx={{ mt: 0 }}>
                  <Grid item xs={4}><TextField select size="small" fullWidth label="Type" value={act.activity_type} onChange={(e) => setAct({ ...act, activity_type: e.target.value })}>{['note', 'call', 'meeting', 'whatsapp', 'email'].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}</TextField></Grid>
                  <Grid item xs={8}><TextField size="small" fullWidth label="Subject" value={act.subject} onChange={(e) => setAct({ ...act, subject: e.target.value })} /></Grid>
                  <Grid item xs={12}><TextField size="small" fullWidth label="Notes" value={act.body} onChange={(e) => setAct({ ...act, body: e.target.value })} /></Grid>
                  <Grid item xs={8}><TextField size="small" fullWidth type="date" label="Follow-up" InputLabelProps={{ shrink: true }} value={act.next_follow_up_date} onChange={(e) => setAct({ ...act, next_follow_up_date: e.target.value })} /></Grid>
                  <Grid item xs={4}><Button fullWidth variant="contained" onClick={saveActivity} sx={{ height: '100%', borderRadius: 2 }}>Save</Button></Grid>
                </Grid>
              </Box>
              <Box><Typography variant="overline" color="text.secondary">Activity timeline ({crm?.activities?.length || 0})</Typography>
                {(crm?.activities || []).slice(0, 30).map((a, i) => (
                  <Box key={i} sx={{ py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
                    <Stack direction="row" spacing={1} alignItems="center"><Chip size="small" label={a.activity_type} variant="outlined" /><Typography variant="body2" sx={{ fontWeight: 600 }}>{a.subject || '—'}</Typography><Box sx={{ flexGrow: 1 }} /><Typography variant="caption" color="text.secondary">{dt(a.activity_at || a.created_at)}</Typography></Stack>
                    {a.body && <Typography variant="caption" color="text.secondary">{a.body}</Typography>}
                  </Box>
                ))}
                {!crm?.activities?.length && <Typography variant="body2" color="text.secondary">No activities yet.</Typography>}
              </Box>
              <Box><Typography variant="overline" color="text.secondary">KIT messages ({data.kit.length})</Typography>
                <MiniTable cols={['Channel', 'Dir', 'Subject', 'Status', 'When']} rows={data.kit} empty="No KIT messages." render={(r) => <><TableCell>{r.channel}</TableCell><TableCell>{r.direction}</TableCell><TableCell>{r.subject || '—'}</TableCell><TableCell>{r.status}</TableCell><TableCell>{dt(r.sent_at || r.created_at)}</TableCell></>} /></Box>
            </Stack>
          )}
          {/* COMPLAINTS */}
          {tab === 5 && (
            <MiniTable cols={['Subject', 'Severity', 'Status', 'Raised', 'Resolved']} rows={data.complaints} empty="No complaints — clean record." render={(r) => <><TableCell sx={{ fontWeight: 600 }}>{r.subject}</TableCell><TableCell><Chip size="small" color={r.severity === 'high' ? 'error' : 'default'} variant="outlined" label={r.severity || '—'} /></TableCell><TableCell>{r.status}</TableCell><TableCell>{dt(r.created_at)}</TableCell><TableCell>{dt(r.resolved_at)}</TableCell></>} />
          )}
          {tab === 6 && <AICopilotTab account={account} notify={notify} />}
        </Box>
      )}
    </Drawer>
  );
}
