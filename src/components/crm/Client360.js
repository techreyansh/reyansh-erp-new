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
import { listAccountTasks, createTask } from '../../services/taskService';
import EventRepeatRounded from '@mui/icons-material/EventRepeatRounded';
import AddTaskRounded from '@mui/icons-material/AddTaskRounded';
import RequestQuoteRounded from '@mui/icons-material/RequestQuoteRounded';
import ScienceRounded from '@mui/icons-material/ScienceRounded';
import NPDDevelopmentPanel from './NPDDevelopmentPanel';
import CompanyContacts from './CompanyContacts';
import CompanyAddresses from './CompanyAddresses';
import CompanyDocuments from './CompanyDocuments';
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

// Unified chronological timeline — every event on the account in one feed.
const TL_COLOR = { call: '#0288d1', whatsapp: '#25d366', email: '#5d4037', meeting: '#7b1fa2', note: '#607d8b', stage: '#455a64', quotation: '#0288d1', order: '#7b1fa2', invoice: '#5d4037', payment: '#2e7d32', complaint: '#d32f2f', kit: '#ed6c02' };
function TimelineTab({ account }) {
  const [events, setEvents] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  useEffect(() => {
    let on = true;
    crmPipelineService.clientTimeline(account).then((e) => on && setEvents(e || [])).catch(() => on && setEvents([]));
    return () => { on = false; };
  }, [account]);
  if (!events) return <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={22} /></Stack>;
  const kinds = ['all', ...Array.from(new Set(events.map((e) => e.kind)))];
  const ql = q.trim().toLowerCase();
  const shown = events
    .filter((e) => filter === 'all' || e.kind === filter)
    .filter((e) => !ql || `${e.title || ''} ${e.detail || ''} ${e.owner || ''}`.toLowerCase().includes(ql));
  return (
    <Box>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        {kinds.map((k) => <Chip key={k} size="small" label={k === 'all' ? `All (${events.length})` : k} variant={filter === k ? 'filled' : 'outlined'} color={filter === k ? 'primary' : 'default'} onClick={() => setFilter(k)} sx={{ cursor: 'pointer', textTransform: 'capitalize' }} />)}
      </Stack>
      <TextField size="small" fullWidth placeholder="Search the timeline…" value={q} onChange={(e) => setQ(e.target.value)} sx={{ mb: 1.5 }} />
      {shown.length === 0 ? <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No events yet.</Typography> : (
        <Box sx={{ position: 'relative', pl: 2, '&::before': { content: '""', position: 'absolute', left: 6, top: 6, bottom: 6, width: 2, bgcolor: 'divider' } }}>
          {shown.map((e, i) => (
            <Box key={i} sx={{ position: 'relative', mb: 1.75 }}>
              <Box sx={{ position: 'absolute', left: -16, top: 4, width: 11, height: 11, borderRadius: '50%', bgcolor: TL_COLOR[e.kind] || 'grey.500', border: '2px solid', borderColor: 'background.paper' }} />
              <Stack direction="row" alignItems="baseline" spacing={1}>
                <Chip size="small" label={e.kind} sx={{ height: 18, textTransform: 'capitalize', bgcolor: TL_COLOR[e.kind] || 'grey.500', color: '#fff', '& .MuiChip-label': { px: 0.7, fontSize: '0.6rem', fontWeight: 700 } }} />
                <Typography variant="body2" sx={{ fontWeight: 700, flexGrow: 1, minWidth: 0 }}>{e.title}</Typography>
                {e.status && e.status !== 'open' && <Chip size="small" variant="outlined" color={e.status === 'completed' ? 'success' : e.status === 'cancelled' ? 'default' : 'warning'} label={e.status} sx={{ height: 16, '& .MuiChip-label': { px: 0.6, fontSize: '0.6rem' } }} />}
                <Typography variant="caption" color="text.disabled">{dt(e.at)}</Typography>
              </Stack>
              {e.outcome && <Typography variant="caption" color="success.main" sx={{ display: 'block', ml: 0.5, fontWeight: 600 }}>Outcome: {e.outcome}</Typography>}
              {e.detail && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'pre-wrap', ml: 0.5 }}>{e.detail}</Typography>}
              {e.owner && <Typography variant="caption" color="text.disabled" sx={{ ml: 0.5 }}>· {String(e.owner).split('@')[0]}</Typography>}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}


// Company master — full field view, grouped. (Editing stays in the CRM board's
// company dialog; this is the read-complete 360 surface.)
function CompanyFields({ c }) {
  const GROUPS = [
    ['Identity', [['Legal name', c.legal_name], ['Customer type', c.customer_type], ['Industry', c.industry], ['Business type', c.business_type], ['Category', c.customer_category], ['Employees', c.num_employees], ['Annual turnover', c.annual_turnover ? inr(c.annual_turnover) : null], ['Website', c.website], ['Description', c.company_description]]],
    ['Tax & registration', [['GSTIN', c.gstin], ['PAN', c.pan], ['CIN', c.cin], ['IEC', c.iec]]],
    ['Commercial', [['Lead source', c.lead_source], ['Rating', c.rating], ['Territory', c.territory], ['Currency', c.currency], ['Payment terms', c.payment_terms], ['Credit limit', c.credit_limit ? inr(c.credit_limit) : null], ['Credit period', c.credit_period], ['Delivery terms', c.delivery_terms], ['Owner', c.owner_email]]],
    ['Business', [['Products manufactured', c.products_manufactured], ['Markets served', c.markets_served], ['Current products', c.current_products], ['Interested products', c.interested_products], ['Monthly consumption', c.monthly_consumption], ['Competitors', c.competitors], ['Existing suppliers', c.existing_suppliers]]],
  ];
  return (
    <Grid container spacing={2}>
      {GROUPS.map(([title, rows]) => {
        const shown = rows.filter(([, v]) => v != null && v !== '');
        if (!shown.length) return null;
        return (
          <Grid item xs={12} sm={6} key={title}>
            <Typography variant="overline" color="text.secondary">{title}</Typography>
            {shown.map(([k, v]) => (
              <Stack key={k} direction="row" justifyContent="space-between" spacing={2} sx={{ py: 0.25 }}>
                <Typography variant="body2" color="text.secondary">{k}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{String(v)}</Typography>
              </Stack>
            ))}
          </Grid>
        );
      })}
    </Grid>
  );
}

// Account-linked tasks: list + quick add (assigned to the account owner).
function TasksTab({ accountId, ownerEmail, notify }) {
  const [tasks, setTasks] = useState(null);
  const [form, setForm] = useState({ title: '', due_date: '', priority: 'medium' });
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => { listAccountTasks(accountId).then(setTasks).catch(() => setTasks([])); }, [accountId]);
  useEffect(() => { reload(); }, [reload]);
  const add = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      await createTask({ title: form.title.trim(), due_date: form.due_date || null, priority: form.priority, account_id: accountId, assigned_email: ownerEmail || undefined }, null);
      setForm({ title: '', due_date: '', priority: 'medium' }); notify?.('Task created'); reload();
    } catch (e) { notify?.(e.message || 'Could not create task', 'error'); } finally { setBusy(false); }
  };
  return (
    <Stack spacing={2}>
      <Box sx={{ p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider' }}>
        <Typography variant="overline" color="text.secondary">New task{ownerEmail ? ` → ${String(ownerEmail).split('@')[0]}` : ''}</Typography>
        <Grid container spacing={1} sx={{ mt: 0 }}>
          <Grid item xs={12} sm={5}><TextField size="small" fullWidth label="Task" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Grid>
          <Grid item xs={6} sm={3}><TextField size="small" fullWidth type="date" label="Due" InputLabelProps={{ shrink: true }} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Grid>
          <Grid item xs={6} sm={2}><TextField select size="small" fullWidth label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{['low', 'medium', 'high', 'urgent'].map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} sm={2}><Button fullWidth variant="contained" disabled={busy || !form.title.trim()} onClick={add} sx={{ height: '100%', borderRadius: 2 }}>Add</Button></Grid>
        </Grid>
      </Box>
      {!tasks ? <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={20} /></Stack> : (
        <MiniTable cols={['Task', 'Owner', 'Due', 'Priority', 'Status']} rows={tasks} empty="No tasks on this account yet." render={(r) => (
          <><TableCell sx={{ fontWeight: 600 }}>{r.title}</TableCell><TableCell>{(r.assigned_name || r.assigned_email || '—').toString().split('@')[0]}</TableCell><TableCell sx={{ color: r.task_status !== 'completed' && r.due_date && new Date(r.due_date) < new Date() ? 'error.main' : 'text.primary' }}>{dt(r.due_date)}</TableCell><TableCell><Chip size="small" variant="outlined" color={r.priority === 'urgent' || r.priority === 'high' ? 'error' : 'default'} label={r.priority} /></TableCell><TableCell><Chip size="small" variant="outlined" color={r.task_status === 'completed' ? 'success' : 'default'} label={String(r.task_status).replace('_', ' ')} /></TableCell></>
        )} />
      )}
    </Stack>
  );
}

// Notes — the note-type slice of the activity feed + a quick add.
function NotesTab({ accountId, activities, onAdded, notify }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const notes = (activities || []).filter((a) => a.activity_type === 'note');
  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await crmPipelineService.addActivity(accountId, { activity_type: 'note', subject: text.trim().slice(0, 60), body: text.trim() }); setText(''); notify?.('Note added'); onAdded?.(); }
    catch (e) { notify?.(e.message || 'Failed', 'error'); } finally { setBusy(false); }
  };
  return (
    <Stack spacing={2}>
      <Box sx={{ p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider' }}>
        <TextField size="small" fullWidth multiline minRows={2} placeholder="Add a note about this account…" value={text} onChange={(e) => setText(e.target.value)} />
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}><Button size="small" variant="contained" disabled={busy || !text.trim()} onClick={add} sx={{ borderRadius: 2 }}>Add note</Button></Stack>
      </Box>
      {notes.length === 0 ? <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>No notes yet.</Typography> : notes.map((n, i) => (
        <Box key={i} sx={{ py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" justifyContent="space-between"><Typography variant="body2" sx={{ fontWeight: 600 }}>{n.subject || 'Note'}</Typography><Typography variant="caption" color="text.disabled">{dt(n.activity_at || n.created_at)}</Typography></Stack>
          {n.body && n.body !== n.subject && <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{n.body}</Typography>}
        </Box>
      ))}
    </Stack>
  );
}

export default function Client360({ account, onClose, notify }) {
  const [tab, setTab] = useState('overview');
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
  const phoneDigits = String(c.phone || account.phone || '').replace(/\D/g, '');
  // Tab order follows the 360 spec; extra operational tabs (Production…AI) follow.
  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'company', label: 'Company' },
    { key: 'contacts', label: 'Contacts' },
    { key: 'addresses', label: 'Addresses' },
    { key: 'products', label: 'Products' },
    { key: 'sales', label: 'Sales' },
    { key: 'npd', label: 'NPD' },
    { key: 'documents', label: 'Documents' },
    { key: 'timeline', label: 'Timeline' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'financial', label: 'Financial' },
    { key: 'notes', label: 'Notes' },
    { key: 'production', label: 'Production' },
    { key: 'dispatch', label: 'Dispatch' },
    { key: 'kit', label: 'KIT' },
    { key: 'complaints', label: 'Complaints' },
    { key: 'ai', label: 'AI Copilot' },
  ];
  // Quick actions — jump to the relevant tab, or fire a direct channel link.
  const QUICK = [
    { label: 'Follow-up', icon: <EventRepeatRounded fontSize="small" />, onClick: () => setTab('timeline') },
    { label: 'Task', icon: <AddTaskRounded fontSize="small" />, onClick: () => setTab('tasks') },
    phoneDigits && { label: 'WhatsApp', icon: <WhatsApp fontSize="small" />, href: `https://wa.me/${phoneDigits}` },
    (c.email || account.email) && { label: 'Email', icon: <EmailOutlined fontSize="small" />, href: `mailto:${c.email || account.email}` },
    { label: 'Quotation', icon: <RequestQuoteRounded fontSize="small" />, onClick: () => setTab('sales') },
    { label: 'NPD request', icon: <ScienceRounded fontSize="small" />, onClick: () => setTab('npd') },
    { label: 'AI summary', icon: <AutoAwesomeRounded fontSize="small" />, onClick: () => setTab('ai') },
  ].filter(Boolean);

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
        {/* Quick actions */}
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
          {QUICK.map((q) => (q.href ? (
            <Button key={q.label} size="small" variant="outlined" startIcon={q.icon} component="a" href={q.href} target="_blank" rel="noreferrer" sx={{ borderRadius: 2, textTransform: 'none' }}>{q.label}</Button>
          ) : (
            <Button key={q.label} size="small" variant="outlined" startIcon={q.icon} onClick={q.onClick} sx={{ borderRadius: 2, textTransform: 'none' }}>{q.label}</Button>
          )))}
        </Stack>
      </Box>

      <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ borderBottom: 1, borderColor: 'divider' }}>
        {TABS.map((t) => <Tab key={t.key} value={t.key} label={t.label} />)}
      </Tabs>

      {loading || !data ? <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress /></Stack> : (
        <Box sx={{ p: 2, overflowY: 'auto' }}>
          {tab === 'overview' && (
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <Typography variant="overline" color="text.secondary">Company</Typography>
                {[['GSTIN', c.gstin], ['Payment terms', c.payment_terms], ['Credit limit', c.credit_limit ? inr(c.credit_limit) : null], ['Annual potential', c.annual_potential ? inr(c.annual_potential) : null], ['Industry', c.industry], ['City', c.city], ['Lead source', c.lead_source], ['Rating', c.rating], ['Owner', c.owner_email]].filter(([, v]) => v).map(([k, v]) => (
                  <Stack key={k} direction="row" justifyContent="space-between" sx={{ py: 0.25 }}><Typography variant="body2" color="text.secondary">{k}</Typography><Typography variant="body2" sx={{ fontWeight: 600 }}>{v}</Typography></Stack>
                ))}
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="overline" color="text.secondary">Recent activity</Typography>
                {(crm?.activities || []).slice(0, 6).map((a, i) => (
                  <Box key={i} sx={{ py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
                    <Stack direction="row" spacing={1} alignItems="center"><Chip size="small" label={a.activity_type} variant="outlined" sx={{ height: 18 }} /><Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1, minWidth: 0 }} noWrap>{a.subject || a.body || '—'}</Typography><Typography variant="caption" color="text.disabled">{dt(a.activity_at || a.created_at)}</Typography></Stack>
                  </Box>
                ))}
                {!crm?.activities?.length && <Typography variant="body2" color="text.secondary">No activity yet.</Typography>}
              </Grid>
            </Grid>
          )}
          {tab === 'company' && <CompanyFields c={c} />}
          {tab === 'contacts' && account?.id && <CompanyContacts accountId={account.id} />}
          {tab === 'addresses' && account?.id && <CompanyAddresses accountId={account.id} />}
          {tab === 'products' && <MiniTable cols={['Code', 'Product', 'Status', 'Rev']} rows={data.products} empty="No products linked." render={(r) => <><TableCell sx={{ fontFamily: 'monospace' }}>{r.product_code}</TableCell><TableCell>{r.product_name}</TableCell><TableCell>{r.status}</TableCell><TableCell>{r.current_revision}</TableCell></>} />}
          {tab === 'sales' && (
            <Stack spacing={2}>
              <Box><Typography variant="overline" color="text.secondary">Quotations ({data.quotations?.length || 0})</Typography>
                <MiniTable cols={['Quote', 'Date', 'Valid', 'Total', 'Status']} rows={data.quotations} empty="No quotations." render={(r) => <><TableCell sx={{ fontFamily: 'monospace' }}>{r.quote_number}</TableCell><TableCell>{dt(r.quote_date)}</TableCell><TableCell>{dt(r.valid_until)}</TableCell><TableCell>{inr(r.total)}</TableCell><TableCell>{r.status}</TableCell></>} /></Box>
              <Box><Typography variant="overline" color="text.secondary">Sales orders ({data.orders?.length || 0})</Typography>
                <MiniTable cols={['SO', 'PO', 'Qty', 'Value', 'Expected', 'Status']} rows={data.orders} empty="No sales orders." render={(r) => <><TableCell sx={{ fontFamily: 'monospace' }}>{r.so_number}</TableCell><TableCell>{r.po_number || '—'}</TableCell><TableCell>{r.total_qty}</TableCell><TableCell>{inr(r.total_value)}</TableCell><TableCell>{dt(r.expected_dispatch_date)}</TableCell><TableCell>{r.status}</TableCell></>} /></Box>
            </Stack>
          )}
          {tab === 'npd' && <NPDDevelopmentPanel accountId={account.id} customerCode={c.customer_code || account.customer_code} companyName={c.company_name || account.company_name} notify={notify} />}
          {tab === 'documents' && account?.id && <CompanyDocuments accountId={account.id} />}
          {tab === 'timeline' && (
            <Stack spacing={2}>
              <Box sx={{ p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider' }}>
                <Typography variant="overline" color="text.secondary">Log activity</Typography>
                <Grid container spacing={1} sx={{ mt: 0 }}>
                  <Grid item xs={4}><TextField select size="small" fullWidth label="Type" value={act.activity_type} onChange={(e) => setAct({ ...act, activity_type: e.target.value })}>{['note', 'call', 'meeting', 'whatsapp', 'email'].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}</TextField></Grid>
                  <Grid item xs={8}><TextField size="small" fullWidth label="Subject" value={act.subject} onChange={(e) => setAct({ ...act, subject: e.target.value })} /></Grid>
                  <Grid item xs={8}><TextField size="small" fullWidth label="Notes" value={act.body} onChange={(e) => setAct({ ...act, body: e.target.value })} /></Grid>
                  <Grid item xs={4}><Button fullWidth variant="contained" onClick={saveActivity} sx={{ height: '100%', borderRadius: 2 }}>Save</Button></Grid>
                </Grid>
              </Box>
              <TimelineTab account={account} />
            </Stack>
          )}
          {tab === 'tasks' && account?.id && <TasksTab accountId={account.id} ownerEmail={c.owner_email} notify={notify} />}
          {tab === 'financial' && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="overline" color="text.secondary">Terms</Typography>
                <Grid container spacing={2}>
                  {[['Payment terms', c.payment_terms], ['Credit limit', c.credit_limit ? inr(c.credit_limit) : null], ['Credit period', c.credit_period], ['Annual turnover', c.annual_turnover ? inr(c.annual_turnover) : null]].filter(([, v]) => v).map(([k, v]) => (
                    <Grid item xs={6} sm={3} key={k}><Typography variant="caption" color="text.secondary">{k}</Typography><Typography variant="body2" sx={{ fontWeight: 700 }}>{v}</Typography></Grid>
                  ))}
                </Grid>
              </Box>
              <Stack direction="row" spacing={3}>
                <Box><Typography variant="caption" color="text.secondary">Billed</Typography><Typography variant="h6" sx={{ fontWeight: 800 }}>{inr(s.billed)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Outstanding</Typography><Typography variant="h6" sx={{ fontWeight: 800, color: s.outstanding ? 'error.main' : 'success.main' }}>{inr(s.outstanding)}</Typography></Box>
              </Stack>
              <Box><Typography variant="overline" color="text.secondary">Invoices</Typography>
                <MiniTable cols={['Invoice', 'Date', 'Amount', 'Balance', 'Due', 'Status']} rows={data.invoices} empty="No invoices." render={(r) => <><TableCell sx={{ fontFamily: 'monospace' }}>{r.invoice_number}</TableCell><TableCell>{dt(r.invoice_date)}</TableCell><TableCell>{inr(r.amount)}</TableCell><TableCell sx={{ color: Number(r.balance) > 0 ? 'error.main' : 'text.primary', fontWeight: 600 }}>{inr(r.balance)}</TableCell><TableCell>{dt(r.due_date)}</TableCell><TableCell>{r.status}</TableCell></>} /></Box>
              <Box><Typography variant="overline" color="text.secondary">Outstanding payments</Typography>
                <MiniTable cols={['Invoice', 'Due', 'Amount', 'Balance', 'Status']} rows={(data.invoices || []).filter((i) => Number(i.balance) > 0)} empty="All settled." render={(r) => <><TableCell sx={{ fontFamily: 'monospace' }}>{r.invoice_number}</TableCell><TableCell>{dt(r.due_date)}</TableCell><TableCell>{inr(r.amount)}</TableCell><TableCell sx={{ color: 'error.main', fontWeight: 700 }}>{inr(r.balance)}</TableCell><TableCell>{r.status}</TableCell></>} /></Box>
            </Stack>
          )}
          {tab === 'notes' && account?.id && <NotesTab accountId={account.id} activities={crm?.activities} onAdded={load} notify={notify} />}
          {tab === 'production' && (
            <Stack spacing={2}>
              <Box><Typography variant="overline" color="text.secondary">Production demand ({data.prodDemand.length})</Typography>
                <MiniTable cols={['SO', 'Product', 'Qty', 'Required', 'Status']} rows={data.prodDemand} empty="No production demand." render={(r) => <><TableCell sx={{ fontFamily: 'monospace' }}>{r.so_number}</TableCell><TableCell>{r.product_name}</TableCell><TableCell>{r.qty} {r.uom}</TableCell><TableCell>{dt(r.required_date)}</TableCell><TableCell>{r.status}</TableCell></>} /></Box>
              <Box><Typography variant="overline" color="text.secondary">Order cycles ({data.orderCycles.length})</Typography>
                <MiniTable cols={['Order', 'Stage', 'Amount', 'Date']} rows={data.orderCycles} empty="No order cycles." render={(r) => <><TableCell>{r.order_number}</TableCell><TableCell><Chip size="small" variant="outlined" label={String(r.cycle_stage || '').replace(/_/g, ' ')} /></TableCell><TableCell>{inr(r.amount)}</TableCell><TableCell>{dt(r.order_date)}</TableCell></>} /></Box>
            </Stack>
          )}
          {tab === 'dispatch' && <MiniTable cols={['SO', 'Planned', 'Dispatched', 'Value', 'Status']} rows={data.dispatches} empty="No dispatches." render={(r) => <><TableCell sx={{ fontFamily: 'monospace' }}>{r.so_number}</TableCell><TableCell>{dt(r.dispatch_date)}</TableCell><TableCell>{dt(r.actual_dispatch_date)}</TableCell><TableCell>{inr(r.total_value)}</TableCell><TableCell>{r.status}</TableCell></>} />}
          {tab === 'kit' && <MiniTable cols={['Channel', 'Dir', 'Subject', 'Status', 'When']} rows={data.kit} empty="No KIT messages." render={(r) => <><TableCell sx={{ textTransform: 'capitalize' }}>{r.channel}</TableCell><TableCell>{r.direction}</TableCell><TableCell>{r.subject || '—'}</TableCell><TableCell>{r.status}</TableCell><TableCell>{dt(r.sent_at || r.created_at)}</TableCell></>} />}
          {tab === 'complaints' && <MiniTable cols={['Subject', 'Severity', 'Status', 'Raised', 'Resolved']} rows={data.complaints} empty="No complaints — clean record." render={(r) => <><TableCell sx={{ fontWeight: 600 }}>{r.subject}</TableCell><TableCell><Chip size="small" color={r.severity === 'high' ? 'error' : 'default'} variant="outlined" label={r.severity || '—'} /></TableCell><TableCell>{r.status}</TableCell><TableCell>{dt(r.created_at)}</TableCell><TableCell>{dt(r.resolved_at)}</TableCell></>} />}
          {tab === 'ai' && <AICopilotTab account={account} notify={notify} />}
        </Box>
      )}
    </Drawer>
  );
}
