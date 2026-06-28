// Client Pipeline — Account Management Workspace. Full parity with the Prospect
// board: 12 DB-driven operational stages, draggable cards (revenue/outstanding/
// health/days-since-contact/next-action), a MANDATORY next-action engine (cards
// with no next action are flagged UNMANAGED), a management drawer with the
// activity timeline + per-stage quick actions + ownership, and a link to the
// full Client-360. Data comes from crm_client_cards() + crm_client_stage_def.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container, Box, Stack, Typography, Chip, CircularProgress, Alert, Snackbar, Avatar, Tooltip,
  IconButton, Menu, MenuItem, Button, TextField, Dialog, DialogTitle, DialogContent, DialogActions,
  Drawer, Divider, ToggleButtonGroup, ToggleButton, Autocomplete, InputAdornment, ListItemIcon, Badge,
  Table, TableHead, TableRow, TableCell, TableBody, Collapse,
} from '@mui/material';
import BulkImportButton from '../../components/common/BulkImport/BulkImportButton';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import CallRounded from '@mui/icons-material/CallRounded';
import WhatsApp from '@mui/icons-material/WhatsApp';
import EmailRounded from '@mui/icons-material/EmailRounded';
import EventRounded from '@mui/icons-material/EventRounded';
import NoteAddRounded from '@mui/icons-material/NoteAddRounded';
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded';
import FlagRounded from '@mui/icons-material/FlagRounded';
import PersonRounded from '@mui/icons-material/PersonRounded';
import { supabase } from '../../lib/supabaseClient';
import {
  clientCards, listClientStageDefs, listAssignableUsers, moveClientPipelineStage, addActivity,
  assignOwner, setClientNextAction, getCompany, listContacts,
  listAllCollaborators, addCollaborator, removeCollaborator, addCompany,
} from '../../services/crmPipelineService';
import Client360 from '../../components/crm/Client360';
import { AddCompanyDialog } from './CRMPipelineBoard';

const BAND = { green: 'success', yellow: 'warning', red: 'error' };
const PRIORITIES = ['high', 'normal', 'low'];
const QUICK_NEXT = ['Call Purchase Manager', 'Send revised quotation', 'Follow up on invoice', 'Schedule plant visit', 'Ask for July forecast'];
const inrK = (n) => { const v = Number(n || 0); return v >= 1e7 ? `₹${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : v ? `₹${v.toLocaleString('en-IN')}` : '—'; };
const nm = (names, email) => names[(email || '').toLowerCase()] || (email ? email.split('@')[0] : 'Unassigned');
const today = () => new Date().toISOString().slice(0, 10);
async function currentEmail() { try { return (await supabase.auth.getUser()).data?.user?.email || null; } catch { return null; } }

/* ---- mandatory next-action dialog (also used on stage move) ---- */
function NextActionDialog({ open, card, stageDef, users, names, onClose, onSave }) {
  const [action, setAction] = useState('');
  const [date, setDate] = useState('');
  const [owner, setOwner] = useState('');
  const [priority, setPriority] = useState('normal');
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (open && card) {
      setAction(card.next_action || ''); setDate(card.next_action_date || today());
      setOwner(card.next_action_owner_email || card.owner_email || '');
      setPriority(card.next_action_priority || 'normal'); setStatus(card.current_status || '');
    }
  }, [open, card]);
  const picks = [...(stageDef?.action_set || []).map((a) => a.label), ...QUICK_NEXT].filter((v, i, a) => a.indexOf(v) === i).slice(0, 9);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Next action — {card?.company_name}
        {stageDef?.requires_next_action && <Typography variant="caption" color="error" display="block">Required — an account with no next action is unmanaged.</Typography>}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <TextField label="Current status" size="small" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="e.g. Awaiting PO; quote sent 20 Jun" fullWidth />
          <TextField label="Next action *" size="small" value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. Call Purchase Manager about July order" fullWidth multiline minRows={1} />
          <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ gap: 0.5 }}>
            {picks.map((p) => <Chip key={p} size="small" label={p} variant="outlined" onClick={() => setAction(p)} sx={{ cursor: 'pointer' }} />)}
          </Stack>
          <Stack direction="row" spacing={1.5}>
            <TextField label="Due date" type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />
            <TextField label="Priority" select size="small" value={priority} onChange={(e) => setPriority(e.target.value)} sx={{ flex: 1 }}>
              {PRIORITIES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </TextField>
          </Stack>
          <Autocomplete size="small" options={users.map((u) => u.email)} value={owner || null} onChange={(e, v) => setOwner(v || '')}
            getOptionLabel={(o) => nm(names, o)} renderInput={(p) => <TextField {...p} label="Action owner" />} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!action.trim()} onClick={() => onSave({ action: action.trim(), date, owner, priority, status })}>Save next action</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ---- a client card ---- */
function ClientCard({ card, names, onOpen, onMenu, onDragStart }) {
  const overdueAction = card.next_action_date && card.next_action_date < today();
  return (
    <Box draggable onDragStart={() => onDragStart(card)} onClick={() => onOpen(card)}
      sx={{
        p: 1, borderRadius: 1.5, bgcolor: 'background.paper', border: '1px solid', cursor: 'pointer',
        borderColor: card.is_unmanaged ? 'error.main' : 'divider', borderLeftWidth: 3,
        borderLeftColor: card.is_unmanaged ? 'error.main' : (card.next_action_priority === 'high' ? 'warning.main' : 'primary.main'),
        '&:hover': { boxShadow: 2 },
      }}>
      <Stack direction="row" alignItems="flex-start" spacing={0.5}>
        <Typography variant="body2" sx={{ fontWeight: 700, flexGrow: 1, minWidth: 0 }} noWrap>{card.company_name}</Typography>
        {card.band && <Tooltip title={`Health ${card.health_score ?? '—'}`}><Chip size="small" color={BAND[card.band]} variant="outlined" label={card.health_score ?? '—'} sx={{ height: 18, '& .MuiChip-label': { px: 0.6, fontSize: '0.62rem' } }} /></Tooltip>}
        <IconButton size="small" sx={{ p: 0.2, mt: -0.4 }} onClick={(e) => { e.stopPropagation(); onMenu(e, card); }}><MoreVertRounded sx={{ fontSize: 16 }} /></IconButton>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace' }}>{card.customer_code || '—'}</Typography>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
        <Avatar sx={{ width: 18, height: 18, fontSize: 10 }}>{nm(names, card.owner_email)[0]?.toUpperCase()}</Avatar>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ flexGrow: 1 }}>{nm(names, card.owner_email)}</Typography>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>{inrK(card.revenue)}</Typography>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mt: 0.25 }}>
        {Number(card.outstanding) > 0 && <Typography variant="caption" color="error.main" sx={{ fontWeight: 600 }}>Due {inrK(card.outstanding)}</Typography>}
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="caption" color={card.days_since_contact > 30 ? 'error.main' : 'text.disabled'}>{card.days_since_contact != null ? `${card.days_since_contact}d` : '—'}</Typography>
      </Stack>
      {card.is_unmanaged ? (
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.5, color: 'error.main' }}>
          <WarningAmberRounded sx={{ fontSize: 14 }} /><Typography variant="caption" sx={{ fontWeight: 800 }}>UNMANAGED — set next action</Typography>
        </Stack>
      ) : (
        <Typography variant="caption" sx={{ color: overdueAction ? 'error.main' : 'primary.main', display: 'block', mt: 0.5, fontWeight: 600 }} noWrap>
          ▸ {card.next_action}{card.next_action_date ? ` · ${card.next_action_date}` : ''}
        </Typography>
      )}
    </Box>
  );
}

/* ---- management drawer (timeline + actions + ownership) ---- */
function ManagementDrawer({ card, stageDef, users, names, onClose, onChanged, onFull, notify }) {
  const [data, setData] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [actType, setActType] = useState('note');
  const [actText, setActText] = useState('');
  const [collabEmails, setCollabEmails] = useState([]);
  const [savingCollab, setSavingCollab] = useState(false);
  const load = useCallback(async () => {
    if (!card) return;
    const [d, c, collabs] = await Promise.all([
      getCompany(card.id).catch(() => null),
      listContacts(card.id).catch(() => []),
      listAllCollaborators().catch(() => []),
    ]);
    setData(d); setContacts(c || []);
    setCollabEmails((collabs || []).filter((r) => r.pipeline_id === card.id).map((r) => String(r.email || '').toLowerCase()).filter(Boolean));
  }, [card]);
  useEffect(() => { load(); }, [load]);
  const primary = contacts.find((c) => c.is_primary) || contacts[0] || {};

  const log = async (type, subject, body) => {
    try { await addActivity({ pipeline_id: card.id, activity_type: type, subject, body: body || null, activity_at: new Date().toISOString() }); await load(); notify(`Logged: ${subject}`); }
    catch (e) { notify(e.message || 'Failed', 'error'); }
  };
  const runAction = async (a) => {
    if (a.kind === 'call' && primary.phone) window.open(`tel:${primary.phone}`);
    else if (a.kind === 'whatsapp' && primary.phone) window.open(`https://wa.me/${String(primary.phone).replace(/[^0-9]/g, '')}`, '_blank');
    else if (a.kind === 'email' && primary.email) window.open(`mailto:${primary.email}`);
    else if (a.kind === 'navigate' && a.to) { window.location.href = a.to; return; }
    const typeMap = { call: 'call', whatsapp: 'whatsapp', email: 'email', meeting: 'meeting', note: 'note' };
    await log(typeMap[a.kind] || 'note', a.label, a.kind === 'escalate' ? 'Payment escalated.' : null);
  };
  const submitActivity = async () => { if (!actText.trim()) return; await log(actType, actText.trim()); setActText(''); };
  const reassign = async (email) => { try { await assignOwner(card.id, email); notify('Owner updated'); onChanged(); } catch (e) { notify(e.message, 'error'); } };
  const onChangeCollaborators = async (nextRaw) => {
    const next = (nextRaw || []).map((e) => String(e).toLowerCase()).filter(Boolean);
    const prevSet = new Set(collabEmails); const nextSet = new Set(next);
    const toAdd = next.filter((e) => !prevSet.has(e));
    const toRemove = collabEmails.filter((e) => !nextSet.has(e));
    if (!toAdd.length && !toRemove.length) return;
    setSavingCollab(true); setCollabEmails(next);
    try {
      await Promise.all([...toAdd.map((e) => addCollaborator(card.id, e)), ...toRemove.map((e) => removeCollaborator(card.id, e))]);
      notify('Collaborators updated'); onChanged();
    } catch (e) { notify(e.message || 'Failed to update collaborators', 'error'); load(); }
    finally { setSavingCollab(false); }
  };

  return (
    <Drawer anchor="right" open={!!card} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 460 } } }}>
      {card && (
        <Box sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>{card.company_name}</Typography>
              <Typography variant="caption" color="text.secondary">{card.customer_code} · {stageDef?.label || card.pipeline_stage}</Typography>
            </Box>
            {card.band && <Chip size="small" color={BAND[card.band]} label={`Health ${card.health_score ?? '—'}`} />}
            <Tooltip title="Open full Client-360"><IconButton onClick={() => onFull(card)}><OpenInFullRounded /></IconButton></Tooltip>
          </Stack>

          {/* quick actions for this stage */}
          <Typography variant="overline" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>{stageDef?.label} actions</Typography>
          <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ gap: 0.5, mb: 1 }}>
            {(stageDef?.action_set || []).map((a) => (
              <Button key={a.key} size="small" variant="outlined" onClick={() => runAction(a)}
                startIcon={a.kind === 'call' ? <CallRounded /> : a.kind === 'whatsapp' ? <WhatsApp /> : a.kind === 'email' ? <EmailRounded /> : a.kind === 'meeting' ? <EventRounded /> : <NoteAddRounded />}
                sx={{ borderRadius: 5, textTransform: 'none' }}>{a.label}</Button>
            ))}
          </Stack>

          {/* next action panel */}
          <Box sx={{ p: 1.25, borderRadius: 2, border: '1px solid', borderColor: card.is_unmanaged ? 'error.main' : 'divider', bgcolor: card.is_unmanaged ? 'error.light' : 'action.hover', mb: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <FlagRounded color={card.is_unmanaged ? 'error' : 'primary'} fontSize="small" />
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="caption" color="text.secondary">Next action {card.current_status ? `· ${card.current_status}` : ''}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{card.is_unmanaged ? 'None set — UNMANAGED' : `${card.next_action} · ${card.next_action_date || ''} (${card.next_action_priority})`}</Typography>
              </Box>
              <Button size="small" variant="contained" onClick={() => onChanged('nextaction')}>{card.is_unmanaged ? 'Set' : 'Edit'}</Button>
            </Stack>
          </Box>

          {/* ownership */}
          <Autocomplete size="small" options={users.map((u) => u.email)} value={card.owner_email || null} onChange={(e, v) => v && reassign(v)}
            getOptionLabel={(o) => nm(names, o)} sx={{ mb: 1.5 }}
            renderInput={(p) => <TextField {...p} label="Account owner" InputProps={{ ...p.InputProps, startAdornment: <InputAdornment position="start"><PersonRounded fontSize="small" /></InputAdornment> }} />} />

          {/* collaborators (co-working) — multiple people on this account */}
          <Autocomplete multiple size="small" disabled={savingCollab}
            options={users.map((u) => u.email).filter((e) => e !== (card.owner_email || ''))}
            value={collabEmails} onChange={(e, v) => onChangeCollaborators(v)}
            getOptionLabel={(o) => nm(names, o)}
            isOptionEqualToValue={(o, v) => String(o).toLowerCase() === String(v).toLowerCase()}
            sx={{ mb: 1.5 }}
            renderInput={(p) => <TextField {...p} label="Collaborators (co-working)" placeholder="Add co-workers" InputProps={{ ...p.InputProps, startAdornment: (<><InputAdornment position="start"><GroupsRounded fontSize="small" /></InputAdornment>{p.InputProps.startAdornment}</>) }} />} />

          {/* activity composer */}
          <Divider sx={{ mb: 1 }}><Typography variant="caption" color="text.secondary">TIMELINE</Typography></Divider>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <TextField select size="small" value={actType} onChange={(e) => setActType(e.target.value)} sx={{ width: 120 }}>
              {['note', 'call', 'whatsapp', 'email', 'meeting'].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
            <TextField size="small" fullWidth placeholder="Log an activity…" value={actText} onChange={(e) => setActText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitActivity()} />
            <Button variant="contained" onClick={submitActivity} disabled={!actText.trim()}>Add</Button>
          </Stack>
          <Stack spacing={1} sx={{ maxHeight: '40vh', overflow: 'auto' }}>
            {(data?.activities || []).length === 0 && <Typography variant="caption" color="text.disabled">No activity yet.</Typography>}
            {(data?.activities || []).map((a) => (
              <Box key={a.id} sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', borderLeft: '3px solid', borderColor: 'primary.main' }}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'capitalize' }}>{a.activity_type}{a.subject ? ` · ${a.subject}` : ''}</Typography>
                  <Typography variant="caption" color="text.disabled">{(a.activity_at || a.created_at || '').slice(0, 10)}</Typography>
                </Stack>
                {a.body && <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{a.body}</Typography>}
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Drawer>
  );
}

export default function ClientPipeline() {
  const [cards, setCards] = useState([]);
  const [defs, setDefs] = useState([]);
  const [users, setUsers] = useState([]);
  const [names, setNames] = useState({});
  const [me, setMe] = useState(null);
  const [scope, setScope] = useState('all');
  const [search, setSearch] = useState('');
  const [onlyUnmanaged, setOnlyUnmanaged] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState(null);   // email or null
  const [showTeam, setShowTeam] = useState(false);
  const [loading, setLoading] = useState(true);
  const [drag, setDrag] = useState(null);
  const [menu, setMenu] = useState(null);       // { anchor, card }
  const [drawer, setDrawer] = useState(null);   // card for management drawer
  const [full, setFull] = useState(null);       // card for Client360
  const [naDialog, setNaDialog] = useState(null); // card for next-action dialog
  const [addOpen, setAddOpen] = useState(false);  // add-client dialog
  const [snack, setSnack] = useState(null);

  const notify = (message, severity = 'success') => setSnack({ message, severity });

  // Add a client directly (defaultKind='client' in the dialog). Lets the dialog
  // catch/show errors (duplicate name → Claim, etc.), so don't swallow here.
  const handleAddClient = async (payload) => { await addCompany(payload); notify('Client added'); load(); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const email = me || (await currentEmail()); if (!me) setMe(email);
      const owner = scope === 'mine' ? email : null;
      const [cd, dfs, us] = await Promise.all([
        clientCards(owner), listClientStageDefs(), listAssignableUsers().catch(() => []),
      ]);
      const nMap = {}; (us || []).forEach((u) => { nMap[(u.email || '').toLowerCase()] = u.full_name || u.name || u.email; });
      setCards(cd || []); setDefs(dfs || []); setUsers(us || []); setNames(nMap);
    } catch (e) { notify(e.message || 'Load failed', 'error'); } finally { setLoading(false); }
  }, [scope, me]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => (!onlyUnmanaged || c.is_unmanaged)
      && (!ownerFilter || (c.owner_email || '').toLowerCase() === ownerFilter)
      && (!q || `${c.company_name} ${c.customer_code}`.toLowerCase().includes(q)));
  }, [cards, search, onlyUnmanaged, ownerFilter]);
  const unmanagedCount = cards.filter((c) => c.is_unmanaged).length;

  // Owner rollup — who owns what, at a glance (manager view, computed client-side).
  const rollup = useMemo(() => {
    const m = new Map();
    cards.forEach((c) => {
      const key = (c.owner_email || '').toLowerCase() || '__unassigned';
      const r = m.get(key) || { email: c.owner_email || '', accounts: 0, unmanaged: 0, outstanding: 0, revenue: 0, dueSoon: 0 };
      r.accounts += 1; if (c.is_unmanaged) r.unmanaged += 1;
      r.outstanding += Number(c.outstanding || 0); r.revenue += Number(c.revenue || 0);
      if (c.next_action_date && c.next_action_date <= today()) r.dueSoon += 1;
      m.set(key, r);
    });
    return Array.from(m.values()).sort((a, b) => b.unmanaged - a.unmanaged || b.outstanding - a.outstanding);
  }, [cards]);
  const colCards = (key) => filtered.filter((c) => (c.pipeline_stage || 'active') === key);
  const stageDefOf = (key) => defs.find((d) => d.stage_key === key);

  const onDrop = async (stageKey) => {
    const card = drag; setDrag(null);
    if (!card || card.pipeline_stage === stageKey) return;
    setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, pipeline_stage: stageKey } : c))); // optimistic
    try {
      await moveClientPipelineStage(card.id, stageKey, `Moved to ${stageDefOf(stageKey)?.label}`);
      notify(`Moved to ${stageDefOf(stageKey)?.label}`);
      setNaDialog({ ...card, pipeline_stage: stageKey }); // FORCE next-action capture
    } catch (e) { notify(e.message || 'Move failed', 'error'); load(); }
  };

  const saveNextAction = async (vals) => {
    try { await setClientNextAction(naDialog.id, vals); setNaDialog(null); notify('Next action set'); load(); }
    catch (e) { notify(e.message || 'Failed', 'error'); }
  };

  const menuAction = async (action) => {
    const card = menu?.card; setMenu(null); if (!card) return;
    if (action === 'view') setDrawer(card);
    else if (action === 'full') setFull(card);
    else if (action === 'nextaction' || action === 'followup') setNaDialog(card);
    else if (action === 'archive') {
      try { await moveClientPipelineStage(card.id, 'lost', 'Archived'); notify('Archived to Lost / Inactive'); load(); }
      catch (e) { notify(e.message, 'error'); }
    }
  };

  return (
    <Container maxWidth={false} sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <AccountTreeOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Client Pipeline</Typography>
        <Typography variant="caption" color="text.secondary">Account Management Workspace</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <ToggleButtonGroup size="small" exclusive value={scope} onChange={(e, v) => v && setScope(v)}>
          <ToggleButton value="all">All clients</ToggleButton>
          <ToggleButton value="mine">My clients</ToggleButton>
        </ToggleButtonGroup>
        <Button size="small" variant="contained" startIcon={<PersonRounded />} onClick={() => setAddOpen(true)} sx={{ borderRadius: 2 }}>Add client</Button>
        <BulkImportButton dataset="crm_clients" label="Import Excel" onApplied={load} sx={{ borderRadius: 2 }} />
        <Button size="small" variant={showTeam ? 'contained' : 'outlined'} startIcon={<GroupsRounded />} onClick={() => setShowTeam((v) => !v)} sx={{ borderRadius: 2 }}>Team</Button>
        <Badge badgeContent={unmanagedCount} color="error">
          <Button size="small" variant={onlyUnmanaged ? 'contained' : 'outlined'} color="error" startIcon={<WarningAmberRounded />} onClick={() => setOnlyUnmanaged((v) => !v)} sx={{ borderRadius: 2 }}>Unmanaged</Button>
        </Badge>
        <TextField size="small" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> }} sx={{ width: 200 }} />
      </Stack>

      {ownerFilter && (
        <Chip sx={{ mb: 1.5 }} color="primary" label={`Filtered to ${nm(names, ownerFilter)}`} onDelete={() => setOwnerFilter(null)} />
      )}

      <Collapse in={showTeam} unmountOnExit>
        <Box sx={{ mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1, bgcolor: 'action.hover' }}><Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Team overview — who owns what</Typography></Box>
          <Table size="small">
            <TableHead><TableRow>{['Account Manager', 'Accounts', 'Unmanaged', 'Action Due', 'Outstanding', 'Revenue (12m)', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.7rem' }} align={['Account Manager', ''].includes(h) ? 'left' : 'right'}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {rollup.map((r) => (
                <TableRow key={r.email || 'unassigned'} hover sx={{ cursor: 'pointer' }} onClick={() => { setOwnerFilter((r.email || '').toLowerCase() || null); setShowTeam(false); }}>
                  <TableCell><Stack direction="row" alignItems="center" spacing={1}><Avatar sx={{ width: 22, height: 22, fontSize: 11 }}>{nm(names, r.email)[0]?.toUpperCase()}</Avatar><Typography variant="body2" sx={{ fontWeight: 600 }}>{r.email ? nm(names, r.email) : 'Unassigned'}</Typography></Stack></TableCell>
                  <TableCell align="right">{r.accounts}</TableCell>
                  <TableCell align="right">{r.unmanaged > 0 ? <Chip size="small" color="error" label={r.unmanaged} sx={{ height: 18, '& .MuiChip-label': { px: 0.7, fontSize: '0.62rem' } }} /> : '—'}</TableCell>
                  <TableCell align="right">{r.dueSoon > 0 ? <Chip size="small" color="warning" label={r.dueSoon} sx={{ height: 18, '& .MuiChip-label': { px: 0.7, fontSize: '0.62rem' } }} /> : '—'}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, color: r.outstanding ? 'error.main' : 'text.disabled' }}>{r.outstanding ? inrK(r.outstanding) : '—'}</TableCell>
                  <TableCell align="right">{inrK(r.revenue)}</TableCell>
                  <TableCell align="right"><Button size="small">View</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Collapse>

      {loading ? <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress /></Stack> : (
        <Box sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 2, alignItems: 'flex-start' }}>
          {defs.map((st) => {
            const items = colCards(st.stage_key);
            const unm = items.filter((c) => c.is_unmanaged).length;
            return (
              <Box key={st.stage_key} onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(st.stage_key)}
                sx={{ minWidth: 260, width: 260, flexShrink: 0, bgcolor: 'action.hover', borderRadius: 2, p: 1 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, px: 0.5 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: st.color || 'grey.500' }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1 }} noWrap>{st.label}</Typography>
                  {unm > 0 && <Tooltip title={`${unm} unmanaged`}><Chip size="small" color="error" label={unm} sx={{ height: 18, '& .MuiChip-label': { px: 0.6, fontSize: '0.6rem' } }} /></Tooltip>}
                  <Chip size="small" label={items.length} />
                </Stack>
                <Stack spacing={1}>
                  {items.length === 0 && <Typography variant="caption" color="text.disabled" sx={{ px: 0.5 }}>—</Typography>}
                  {items.map((c) => (
                    <ClientCard key={c.id} card={c} names={names} onOpen={setDrawer}
                      onMenu={(e, card) => setMenu({ anchor: e.currentTarget, card })} onDragStart={setDrag} />
                  ))}
                </Stack>
              </Box>
            );
          })}
        </Box>
      )}

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => menuAction('view')}><ListItemIcon><OpenInFullRounded fontSize="small" /></ListItemIcon>View / manage</MenuItem>
        <MenuItem onClick={() => menuAction('full')}><ListItemIcon><AccountTreeOutlined fontSize="small" /></ListItemIcon>Full Client-360</MenuItem>
        <MenuItem onClick={() => menuAction('nextaction')}><ListItemIcon><FlagRounded fontSize="small" /></ListItemIcon>Set next action</MenuItem>
        <Divider />
        <MenuItem onClick={() => menuAction('archive')}><ListItemIcon><WarningAmberRounded fontSize="small" /></ListItemIcon>Archive (Lost / Inactive)</MenuItem>
      </Menu>

      <ManagementDrawer card={drawer} stageDef={drawer ? stageDefOf(drawer.pipeline_stage) : null} users={users} names={names}
        onClose={() => setDrawer(null)} onFull={(c) => { setDrawer(null); setFull(c); }}
        onChanged={(what) => { if (what === 'nextaction') setNaDialog(drawer); else { setDrawer(null); load(); } }} notify={notify} />

      <NextActionDialog open={!!naDialog} card={naDialog} stageDef={naDialog ? stageDefOf(naDialog.pipeline_stage) : null}
        users={users} names={names} onClose={() => setNaDialog(null)} onSave={saveNextAction} />

      {full && <Client360 account={{ id: full.id, customer_code: full.customer_code, company_name: full.company_name, account_id: full.id }} onClose={() => setFull(null)} onChanged={load} notify={notify} />}

      <AddCompanyDialog open={addOpen} defaultKind="client" currentEmail={me}
        onClose={() => setAddOpen(false)} onSubmit={handleAddClient} onClaimed={() => { notify('Claimed'); load(); }} />

      <Snackbar open={!!snack} autoHideDuration={3500} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
