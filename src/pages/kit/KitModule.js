import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  AddRounded,
  AutoAwesomeRounded,
  BoltRounded,
  CakeOutlined,
  CampaignOutlined,
  DeleteOutlineRounded,
  EditOutlined,
  EmailOutlined,
  EventBusyOutlined,
  EventRepeatOutlined,
  ForumOutlined,
  GroupsOutlined,
  InsightsOutlined,
  MoreVertRounded,
  PersonAddAltOutlined,
  ScheduleSendOutlined,
  SearchRounded,
  SendRounded,
  SpeakerNotesOffOutlined,
  WarningAmberRounded,
  WhatsApp,
} from '@mui/icons-material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import kitService, { CHANNELS, CHANNEL_LABELS } from '../../services/kitService';
import { rankForOutreach } from '../../services/kitCadence';
import { listAssignableUsers, getCurrentUserEmail } from '../../services/crmPipelineService';

/* ------------------------------------------------------------------ helpers */

const PROSPECT_LABELS = {
  lead: 'Lead',
  contacted: 'Contacted',
  meeting_scheduled: 'Meeting Scheduled',
  qualified: 'Qualified',
  sample_sent: 'Sample Sent',
  quotation_sent: 'Quotation Sent',
  negotiation: 'Negotiation',
  converted: 'Converted',
};
const CLIENT_LABELS = {
  active: 'Active Client',
  repeat_business: 'Repeat Business',
  key_account: 'Key Account',
  dormant: 'Dormant',
};

const titleize = (v) =>
  String(v || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

function stageLabel(c) {
  if (c.account_type === 'client') return CLIENT_LABELS[c.client_stage] || titleize(c.client_stage) || 'Client';
  return PROSPECT_LABELS[c.prospect_stage] || titleize(c.prospect_stage) || 'Prospect';
}

const namePrefix = (email) => String(email || '').split('@')[0].replace(/[._]/g, ' ');
const ownerLabel = (email, users) => {
  if (!email) return 'Unassigned';
  const u = users.find((x) => String(x.email).toLowerCase() === String(email).toLowerCase());
  return u?.full_name || namePrefix(email);
};

const digitsOnly = (phone) => String(phone || '').replace(/\D/g, '');

/** Fill {variables} from a contact + the current user. */
function fillVariables(text, ctx) {
  if (!text) return '';
  const map = {
    company: ctx.company_name || '',
    // Greet the person; fall back to a neutral salutation, never the company name.
    contact: ctx.contact || 'there',
    industry: ctx.industry || 'your industry',
    city: ctx.city || '',
    me: ctx.me || '',
    stage: ctx.stage || '',
    customer_type: ctx.customer_type || '',
    days_since: ctx.days_since != null ? String(ctx.days_since) : 'some',
    last_contact: ctx.last_contact || 'a while back',
  };
  return String(text)
    .replace(/\{(\w+)\}/g, (m, key) => (key in map ? map[key] : m))
    // Templates may store URL-encoded newlines (%0A) meant for the mailto link;
    // show them as real line breaks. encodeURIComponent re-encodes them on send.
    .replace(/%0D%0A|%0A|%0D/gi, '\n');
}

/* ----------------------------------------------------------- shared widgets */

function StatCard({ label, value, sub, icon: Icon, accent }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2.5, height: '100%' }}>
      <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {label}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5, lineHeight: 1.15 }}>
              {value}
            </Typography>
            {sub && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                {sub}
              </Typography>
            )}
          </Box>
          <Box sx={{ p: 1, borderRadius: 2, bgcolor: `${accent}1a`, color: accent, display: 'flex' }}>
            <Icon />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

function Panel({ title, subtitle, children, height = 300, action }) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 1.5, sm: 2 }, display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{title}</Typography>
          {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
        </Box>
        {action}
      </Stack>
      <Box sx={{ flex: 1, height }}>{children}</Box>
    </Paper>
  );
}

const Empty = ({ label = 'No data yet' }) => (
  <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', py: 4, color: 'text.disabled' }}>
    <Typography variant="body2">{label}</Typography>
  </Stack>
);

function EngagementBar({ score }) {
  const theme = useTheme();
  const n = Math.max(0, Math.min(Number(score) || 0, 100));
  const color = n >= 66 ? theme.palette.success.main : n >= 33 ? theme.palette.warning.main : theme.palette.error.main;
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 120 }}>
      <Box sx={{ flex: 1 }}>
        <LinearProgress
          variant="determinate"
          value={n}
          sx={{ height: 6, borderRadius: 3, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { bgcolor: color } }}
        />
      </Box>
      <Chip label={Math.round(n)} size="small" sx={{ height: 20, fontWeight: 700, bgcolor: `${color}1a`, color }} />
    </Stack>
  );
}

/* ============================================================ SEND DIALOG */

function SendDialog({ open, onClose, contact, channel, currentUser, onSent }) {
  const theme = useTheme();
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [schedule, setSchedule] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [busy, setBusy] = useState(false);

  const ctx = useMemo(
    () => {
      const d = Number(contact?.days_since_touch);
      return {
        company_name: contact?.company_name,
        contact: contact?.contact_person || contact?.contact_name || '',
        industry: contact?.industry,
        city: contact?.city,
        me: currentUser ? namePrefix(currentUser) : '',
        stage: contact ? stageLabel(contact) : '',
        customer_type: contact?.account_type === 'client' ? 'valued customer' : 'prospective partner',
        days_since: Number.isFinite(d) ? d : null,
        last_contact: Number.isFinite(d) ? (d === 0 ? 'earlier today' : `${d} day${d === 1 ? '' : 's'} ago`) : 'a while back',
      };
    },
    [contact, currentUser],
  );

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const list = await kitService.listTemplates(channel);
      if (alive) setTemplates(list);
    })();
    setTemplateId('');
    setSubject('');
    setBody('');
    setSchedule(false);
    setScheduledFor('');
    return () => {
      alive = false;
    };
  }, [open, channel]);

  const applyTemplate = (id) => {
    setTemplateId(id);
    const t = templates.find((x) => String(x.id) === String(id));
    if (t) {
      setSubject(fillVariables(t.subject || '', ctx));
      setBody(fillVariables(t.body || '', ctx));
    }
  };

  // "Generate with AI" — context-aware templated draft (picks tone from the
  // relationship signal: opportunity vs dormant vs relationship). No LLM.
  const generate = () => {
    const t = templates.find((x) => String(x.id) === String(templateId));
    const d = Number(contact?.days_since_touch);
    const stageKey = String(contact?.prospect_stage || contact?.client_stage || '').toLowerCase();
    const isEmail = channel === 'email';

    let baseSubject = t?.subject || (isEmail ? 'Keeping in touch — {company}' : '');
    let baseBody = t?.body;
    if (!baseBody) {
      if (/quotation|sample|negotiation|meeting/.test(stageKey)) {
        // Opportunity in motion — move it forward, helpfully.
        baseSubject = isEmail ? 'On our {industry} discussion — {company}' : '';
        baseBody = `Hi {contact}, circling back on where we'd reached with {company} on the {industry} requirement. Happy to refine specs or pricing so it fits cleanly — what would help move it forward from here?`;
      } else if (Number.isFinite(d) && d >= 30) {
        // Dormant — warm reconnect, no pressure.
        baseSubject = isEmail ? 'Reconnecting with {company}' : '';
        baseBody = `Hi {contact}, it's been about {last_contact} since we last connected — no agenda, just didn't want the line with {company} to go quiet. If anything has come up on the {industry} side, I'm glad to help. How are things at your end?`;
      } else {
        // Healthy relationship — light, value-first touch.
        baseSubject = isEmail ? 'A quick hello from Reyansh' : '';
        baseBody = `Hi {contact}, hope things are running well at {company}. Just keeping in touch as a {customer_type} of ours — if any wire, cord or harness need surfaces for your {industry} work, I'm here to help. No agenda today.`;
      }
    }
    setSubject(fillVariables(baseSubject, ctx));
    setBody(fillVariables(baseBody, ctx));
  };

  const isWhatsapp = channel === 'whatsapp';
  const recipient = isWhatsapp ? contact?.phone : contact?.email;

  const handleSend = async () => {
    if (!contact) return;
    setBusy(true);
    try {
      const scheduledIso = schedule && scheduledFor ? new Date(scheduledFor).toISOString() : null;
      await kitService.logMessage({
        accountId: contact.account_id,
        channel,
        subject: subject || null,
        body,
        recipient: recipient || null,
        scheduledFor: scheduledIso,
      });
      // Only open the external app for an immediate send.
      if (!scheduledIso) {
        if (isWhatsapp) {
          const digits = digitsOnly(contact?.phone);
          const url = `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
          window.open(url, '_blank', 'noopener');
        } else {
          const url = `mailto:${recipient || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
          window.open(url, '_blank', 'noopener');
        }
      }
      onSent?.(scheduledIso ? 'scheduled' : 'sent');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const Icon = isWhatsapp ? WhatsApp : EmailOutlined;
  const accent = isWhatsapp ? '#25D366' : theme.palette.primary.main;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box sx={{ p: 0.75, borderRadius: 2, bgcolor: `${accent}1a`, color: accent, display: 'flex' }}>
            <Icon />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
              {isWhatsapp ? 'Send WhatsApp' : 'Send Email'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {contact?.company_name} {recipient ? `· ${recipient}` : '· no contact on file'}
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <FormControl fullWidth size="small">
            <InputLabel>Template</InputLabel>
            <Select label="Template" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
              <MenuItem value="">
                <em>Start from scratch</em>
              </MenuItem>
              {templates.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                  {t.category ? ` · ${t.category}` : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button onClick={generate} startIcon={<AutoAwesomeRounded />} variant="outlined" size="small" sx={{ alignSelf: 'flex-start', borderRadius: 2 }}>
            Generate with AI
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
            Context-aware: fills {'{company}'}, {'{contact}'}, {'{industry}'}, {'{city}'}, {'{stage}'}, {'{customer_type}'}, {'{last_contact}'}, {'{me}'} from CRM, and picks tone from the relationship (opportunity / dormant / relationship).
          </Typography>

          {!isWhatsapp && (
            <TextField label="Subject" size="small" fullWidth value={subject} onChange={(e) => setSubject(e.target.value)} />
          )}
          <TextField label="Message" size="small" fullWidth multiline minRows={5} value={body} onChange={(e) => setBody(e.target.value)} />

          <FormControlLabel
            control={<Switch checked={schedule} onChange={(e) => setSchedule(e.target.checked)} />}
            label="Schedule for later"
          />
          {schedule && (
            <TextField
              label="Send at"
              type="datetime-local"
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button
          onClick={handleSend}
          variant="contained"
          disabled={busy || !body || (schedule && !scheduledFor)}
          startIcon={schedule ? <ScheduleSendOutlined /> : <SendRounded />}
          sx={{ borderRadius: 2 }}
        >
          {schedule ? 'Schedule' : isWhatsapp ? 'Open WhatsApp & Log' : 'Open Email & Log'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ====================================================== FOLLOW-UP DIALOG */

function FollowupDialog({ open, onClose, contact, currentUser, onDone }) {
  const [subject, setSubject] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSubject(contact ? `Follow up with ${contact.company_name}` : '');
      setDate('');
    }
  }, [open, contact]);

  const save = async () => {
    if (!contact) return;
    setBusy(true);
    try {
      await kitService.createFollowup(contact.account_id, {
        subject,
        date: date || null,
        owner: contact.owner_email || currentUser || null,
      });
      onDone?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 800 }}>Create Follow-up</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField label="Subject" size="small" fullWidth value={subject} onChange={(e) => setSubject(e.target.value)} />
          <TextField
            label="Follow-up date"
            type="date"
            size="small"
            fullWidth
            InputLabelProps={{ shrink: true }}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button onClick={save} variant="contained" disabled={busy || !subject} sx={{ borderRadius: 2 }}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ========================================================= ASSIGN DIALOG */

function AssignDialog({ open, onClose, contact, users, onDone }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setEmail(contact?.owner_email || '');
  }, [open, contact]);

  const save = async () => {
    if (!contact || !email) return;
    setBusy(true);
    try {
      await kitService.assignOwner(contact.account_id, email);
      onDone?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 800 }}>Assign Salesperson</DialogTitle>
      <DialogContent dividers>
        <FormControl fullWidth size="small" sx={{ mt: 0.5 }}>
          <InputLabel>Salesperson</InputLabel>
          <Select label="Salesperson" value={email} onChange={(e) => setEmail(e.target.value)}>
            {users.length === 0 && <MenuItem value="">No assignable users</MenuItem>}
            {users.map((u) => (
              <MenuItem key={u.email} value={u.email}>
                {u.full_name || namePrefix(u.email)}
                {u.department ? ` · ${u.department}` : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button onClick={save} variant="contained" disabled={busy || !email} sx={{ borderRadius: 2 }}>
          Assign
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ======================================================== TEMPLATE DIALOG */

function TemplateDialog({ open, onClose, template, onDone }) {
  const [form, setForm] = useState({ name: '', channel: 'whatsapp', category: '', subject: '', body: '', is_active: true });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(
        template || { name: '', channel: 'whatsapp', category: '', subject: '', body: '', is_active: true },
      );
    }
  }, [open, template]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    try {
      await kitService.saveTemplate(form);
      onDone?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>{template?.id ? 'Edit Template' : 'New Template'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Name" size="small" fullWidth value={form.name} onChange={set('name')} />
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Channel</InputLabel>
              <Select label="Channel" value={form.channel} onChange={set('channel')}>
                {CHANNELS.map((c) => (
                  <MenuItem key={c.key} value={c.key}>
                    {c.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <TextField label="Category" size="small" fullWidth value={form.category || ''} onChange={set('category')} placeholder="e.g. Intro, Follow-up, Festival" />
          {form.channel === 'email' && (
            <TextField label="Subject" size="small" fullWidth value={form.subject || ''} onChange={set('subject')} />
          )}
          <TextField
            label="Body"
            size="small"
            fullWidth
            multiline
            minRows={5}
            value={form.body || ''}
            onChange={set('body')}
            helperText="Variables: {company} {contact} {industry} {city} {stage} {customer_type} {last_contact} {me}"
          />
          <FormControlLabel
            control={<Switch checked={form.is_active !== false} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />}
            label="Active"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button onClick={save} variant="contained" disabled={busy || !form.name} sx={{ borderRadius: 2 }}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ================================================================ DASHBOARD */

function DashboardTab({ stats, contacts, loading, theme, onAction }) {
  if (loading) {
    return (
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(2,1fr)', lg: 'repeat(4,1fr)' } }}>
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} variant="rounded" height={96} />
        ))}
      </Box>
    );
  }

  const d = stats || {};
  const kpis = [
    { label: 'Total Reachable Contacts', value: d.total_contacts ?? 0, sub: 'On the CRM master', icon: GroupsOutlined, accent: theme.palette.primary.main },
    { label: 'WhatsApp Enabled', value: d.whatsapp_enabled ?? 0, sub: 'Opted in', icon: WhatsApp, accent: '#25D366' },
    { label: 'Email Enabled', value: d.email_enabled ?? 0, sub: 'Reachable by email', icon: EmailOutlined, accent: theme.palette.primary.light },
    { label: 'Without Communication', value: d.no_communication ?? 0, sub: 'Never contacted', icon: SpeakerNotesOffOutlined, accent: theme.palette.text.secondary },
    { label: 'Messages This Month', value: d.messages_this_month ?? 0, sub: 'Sent via KIT', icon: ForumOutlined, accent: theme.palette.primary.dark },
    { label: 'Open Follow-ups', value: d.open_followups ?? 0, sub: 'Planned next steps', icon: EventRepeatOutlined, accent: theme.palette.warning.main },
    { label: 'Needs Attention', value: d.needs_attention ?? 0, sub: 'Going quiet', icon: WarningAmberRounded, accent: theme.palette.warning.dark },
    { label: 'At-Risk', value: d.at_risk ?? 0, sub: 'Disengaging', icon: EventBusyOutlined, accent: theme.palette.error.main },
  ];

  // Engagement distribution buckets.
  const buckets = [
    { name: 'Cold (0-32)', value: 0, fill: theme.palette.error.main },
    { name: 'Warm (33-65)', value: 0, fill: theme.palette.warning.main },
    { name: 'Engaged (66-100)', value: 0, fill: theme.palette.success.main },
  ];
  contacts.forEach((c) => {
    const s = Number(c.engagement_score) || 0;
    if (s >= 66) buckets[2].value += 1;
    else if (s >= 33) buckets[1].value += 1;
    else buckets[0].value += 1;
  });

  // Cadence engine: who to contact today + which message type + why.
  const PRIORITY_COLOR = { 3: theme.palette.error.main, 2: theme.palette.warning.main, 1: theme.palette.info.main };
  const attention = rankForOutreach(contacts).slice(0, 8);

  const axis = { fontSize: 12, fill: theme.palette.text.secondary };
  const grid = theme.palette.divider;

  return (
    <Box>
      <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(2,1fr)', md: 'repeat(4,1fr)' } }}>
        {kpis.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
        <StatCard
          label="Avg Engagement"
          value={`${Math.round(Number(d.avg_engagement) || 0)}`}
          sub="0–100 across base"
          icon={InsightsOutlined}
          accent={theme.palette.success.main}
        />
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
        <Panel title="Engagement Distribution" subtitle="Reachable contacts by engagement score" height={280}>
          {contacts.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={buckets} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={{ stroke: grid }} />
                <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <RTooltip cursor={{ fill: `${theme.palette.primary.main}10` }} contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={56}>
                  {buckets.map((e) => (
                    <Cell key={e.name} fill={e.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty label="No reachable contacts yet" />
          )}
        </Panel>

        <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Suggested outreach today</Typography>
            <Typography variant="caption" color="text.secondary">Who to reach, what to send, and why</Typography>
          </Box>
          <Divider />
          {attention.length ? (
            <Stack divider={<Divider />} sx={{ maxHeight: 320, overflow: 'auto' }}>
              {attention.map(({ contact: c, rec }) => (
                <Stack key={c.account_id} direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ px: 2, py: 1.25 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{c.company_name}</Typography>
                      <Chip
                        label={rec.label}
                        size="small"
                        sx={{ height: 18, fontSize: 10, fontWeight: 700, flexShrink: 0,
                          bgcolor: `${PRIORITY_COLOR[rec.priority]}1a`, color: PRIORITY_COLOR[rec.priority] }}
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {rec.reason}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                    {c.whatsapp_enabled && (
                      <Tooltip title="WhatsApp">
                        <IconButton size="small" sx={{ color: '#25D366' }} onClick={() => onAction('whatsapp', c)}>
                          <WhatsApp fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {c.email_enabled && (
                      <Tooltip title="Email">
                        <IconButton size="small" color="primary" onClick={() => onAction('email', c)}>
                          <EmailOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Create follow-up">
                      <IconButton size="small" onClick={() => onAction('followup', c)}>
                        <EventRepeatOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>
              ))}
            </Stack>
          ) : (
            <Empty label="Everyone's engaged — nice." />
          )}
        </Paper>
      </Box>
    </Box>
  );
}

/* ================================================================= CONTACTS */

const QUICK_CHIPS = [
  { key: 'needs_followup', label: 'Needs follow-up' },
  { key: 'at_risk', label: 'At risk' },
  { key: 'no_communication', label: 'No communication' },
  { key: 'whatsapp_enabled', label: 'WhatsApp-enabled' },
];

function ContactsTab({ contacts, loading, users, theme, onAction }) {
  const [search, setSearch] = useState('');
  const [accountType, setAccountType] = useState('all');
  const [industry, setIndustry] = useState('all');
  const [city, setCity] = useState('all');
  const [category, setCategory] = useState('all');
  const [owner, setOwner] = useState('all');
  const [quick, setQuick] = useState({});
  const [menu, setMenu] = useState({ anchor: null, contact: null });

  const uniq = useCallback(
    (key) => Array.from(new Set(contacts.map((c) => c[key]).filter(Boolean))).sort(),
    [contacts],
  );
  const industries = useMemo(() => uniq('industry'), [uniq]);
  const cities = useMemo(() => uniq('city'), [uniq]);
  const categories = useMemo(() => uniq('customer_category'), [uniq]);
  const owners = useMemo(() => uniq('owner_email'), [uniq]);

  const filtered = useMemo(() => {
    return contacts.filter((c) => {
      if (accountType !== 'all' && c.account_type !== accountType) return false;
      if (industry !== 'all' && c.industry !== industry) return false;
      if (city !== 'all' && c.city !== city) return false;
      if (category !== 'all' && c.customer_category !== category) return false;
      if (owner !== 'all' && c.owner_email !== owner) return false;
      if (quick.needs_followup && !c.needs_followup) return false;
      if (quick.at_risk && !c.at_risk) return false;
      if (quick.no_communication && Number(c.interactions) > 0) return false;
      if (quick.whatsapp_enabled && !c.whatsapp_enabled) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${c.company_name || ''} ${c.industry || ''} ${c.city || ''} ${c.owner_email || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [contacts, accountType, industry, city, category, owner, quick, search]);

  const toggleQuick = (k) => setQuick((q) => ({ ...q, [k]: !q[k] }));
  const openMenu = (e, contact) => setMenu({ anchor: e.currentTarget, contact });
  const closeMenu = () => setMenu({ anchor: null, contact: null });
  const act = (type) => {
    const c = menu.contact;
    closeMenu();
    onAction(type, c);
  };

  const selectSx = { minWidth: 140 };

  return (
    <Box>
      {/* Segmentation filter bar */}
      <Paper variant="outlined" sx={{ borderRadius: 2.5, p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap" alignItems="center">
          <TextField
            size="small"
            placeholder="Search company, industry, city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 240, flex: 1 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRounded fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <FormControl size="small" sx={selectSx}>
            <InputLabel>Type</InputLabel>
            <Select label="Type" value={accountType} onChange={(e) => setAccountType(e.target.value)}>
              <MenuItem value="all">All types</MenuItem>
              <MenuItem value="prospect">Prospect</MenuItem>
              <MenuItem value="client">Client</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={selectSx}>
            <InputLabel>Industry</InputLabel>
            <Select label="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)}>
              <MenuItem value="all">All industries</MenuItem>
              {industries.map((v) => (
                <MenuItem key={v} value={v}>{v}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={selectSx}>
            <InputLabel>City</InputLabel>
            <Select label="City" value={city} onChange={(e) => setCity(e.target.value)}>
              <MenuItem value="all">All cities</MenuItem>
              {cities.map((v) => (
                <MenuItem key={v} value={v}>{v}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={selectSx}>
            <InputLabel>Category</InputLabel>
            <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <MenuItem value="all">All categories</MenuItem>
              {categories.map((v) => (
                <MenuItem key={v} value={v}>{titleize(v)}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={selectSx}>
            <InputLabel>Salesperson</InputLabel>
            <Select label="Salesperson" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <MenuItem value="all">All owners</MenuItem>
              {owners.map((v) => (
                <MenuItem key={v} value={v}>{ownerLabel(v, users)}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} useFlexGap flexWrap="wrap">
          {QUICK_CHIPS.map((c) => (
            <Chip
              key={c.key}
              label={c.label}
              size="small"
              variant={quick[c.key] ? 'filled' : 'outlined'}
              color={quick[c.key] ? 'primary' : 'default'}
              onClick={() => toggleQuick(c.key)}
            />
          ))}
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
            {filtered.length} of {contacts.length} contacts
          </Typography>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
        {/* header row */}
        <Box
          sx={{
            display: { xs: 'none', md: 'grid' },
            gridTemplateColumns: '2fr 1.3fr 1.2fr 0.9fr 1.4fr 1fr 0.6fr',
            gap: 1,
            px: 2,
            py: 1,
            bgcolor: 'action.hover',
          }}
        >
          {['Company', 'Stage', 'Salesperson', 'Last touch', 'Engagement', 'Channels', ''].map((h) => (
            <Typography key={h} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {h}
            </Typography>
          ))}
        </Box>
        <Divider />
        {loading ? (
          <Box sx={{ p: 2 }}>
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} height={44} />
            ))}
          </Box>
        ) : filtered.length === 0 ? (
          <Empty label="No contacts match these filters" />
        ) : (
          <Stack divider={<Divider />} sx={{ maxHeight: 560, overflow: 'auto' }}>
            {filtered.map((c) => {
              const days = Number(c.days_since_touch);
              return (
                <Box
                  key={c.account_id}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr auto', md: '2fr 1.3fr 1.2fr 0.9fr 1.4fr 1fr 0.6fr' },
                    gap: 1,
                    alignItems: 'center',
                    px: 2,
                    py: 1.25,
                  }}
                >
                  <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
                    <Avatar sx={{ width: 30, height: 30, fontSize: 13, fontWeight: 700, bgcolor: c.account_type === 'client' ? theme.palette.primary.dark : theme.palette.primary.main }}>
                      {String(c.company_name || '?').charAt(0).toUpperCase()}
                    </Avatar>
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                          {c.company_name}
                        </Typography>
                        {c.at_risk && <Chip label="At risk" size="small" sx={{ height: 18, fontSize: 10, fontWeight: 700, bgcolor: `${theme.palette.error.main}1a`, color: theme.palette.error.main }} />}
                        {!c.at_risk && c.needs_followup && <Chip label="Follow up" size="small" sx={{ height: 18, fontSize: 10, fontWeight: 700, bgcolor: `${theme.palette.warning.main}1a`, color: theme.palette.warning.main }} />}
                      </Stack>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {c.industry || '—'}{c.city ? ` · ${c.city}` : ''}
                      </Typography>
                    </Box>
                  </Stack>

                  <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                    <Chip
                      label={stageLabel(c)}
                      size="small"
                      variant="outlined"
                      sx={{ fontWeight: 600 }}
                    />
                  </Box>
                  <Typography variant="body2" noWrap sx={{ display: { xs: 'none', md: 'block' }, color: c.owner_email ? 'text.primary' : 'text.disabled' }}>
                    {ownerLabel(c.owner_email, users)}
                  </Typography>
                  <Typography variant="body2" sx={{ display: { xs: 'none', md: 'block' }, color: 'text.secondary' }}>
                    {Number.isFinite(days) ? `${days}d` : '—'}
                  </Typography>
                  <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                    <EngagementBar score={c.engagement_score} />
                  </Box>
                  <Stack direction="row" spacing={0.5} sx={{ display: { xs: 'none', md: 'flex' } }}>
                    {c.whatsapp_enabled && <WhatsApp fontSize="small" sx={{ color: '#25D366' }} />}
                    {c.email_enabled && <EmailOutlined fontSize="small" color="primary" />}
                    {!c.whatsapp_enabled && !c.email_enabled && <Typography variant="caption" color="text.disabled">—</Typography>}
                  </Stack>

                  <Box sx={{ justifySelf: 'end' }}>
                    <IconButton size="small" onClick={(e) => openMenu(e, c)}>
                      <MoreVertRounded fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              );
            })}
          </Stack>
        )}
      </Paper>

      <Menu anchorEl={menu.anchor} open={Boolean(menu.anchor)} onClose={closeMenu}>
        <MenuItem onClick={() => act('whatsapp')} disabled={!menu.contact?.whatsapp_enabled}>
          <ListItemIcon><WhatsApp fontSize="small" sx={{ color: '#25D366' }} /></ListItemIcon>
          <ListItemText>Send WhatsApp</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => act('email')} disabled={!menu.contact?.email_enabled}>
          <ListItemIcon><EmailOutlined fontSize="small" /></ListItemIcon>
          <ListItemText>Send Email</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => act('schedule')}>
          <ListItemIcon><ScheduleSendOutlined fontSize="small" /></ListItemIcon>
          <ListItemText>Schedule</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => act('followup')}>
          <ListItemIcon><EventRepeatOutlined fontSize="small" /></ListItemIcon>
          <ListItemText>Create Follow-up</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => act('assign')}>
          <ListItemIcon><PersonAddAltOutlined fontSize="small" /></ListItemIcon>
          <ListItemText>Assign</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}

/* ================================================================ TEMPLATES */

function TemplatesTab({ theme }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState({ open: false, template: null });

  const load = useCallback(async () => {
    setLoading(true);
    const list = await kitService.listTemplates();
    setTemplates(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const out = {};
    templates.forEach((t) => {
      const key = t.channel || 'other';
      (out[key] = out[key] || []).push(t);
    });
    return out;
  }, [templates]);

  const toggleActive = async (t) => {
    await kitService.saveTemplate({ ...t, is_active: !(t.is_active !== false) });
    load();
  };
  const remove = async (id) => {
    await kitService.deleteTemplate(id);
    load();
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Message Templates</Typography>
          <Typography variant="caption" color="text.secondary">Reusable messages with {'{variables}'} filled from CRM context</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddRounded />} sx={{ borderRadius: 2 }} onClick={() => setDialog({ open: true, template: null })}>
          New Template
        </Button>
      </Stack>

      {loading ? (
        <Skeleton variant="rounded" height={200} />
      ) : templates.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 2.5 }}>
          <Empty label="No templates yet — create your first one." />
        </Paper>
      ) : (
        Object.entries(grouped).map(([channel, list]) => (
          <Box key={channel} sx={{ mb: 3 }}>
            <Typography variant="overline" sx={{ fontWeight: 700, color: 'text.secondary' }}>
              {CHANNEL_LABELS[channel] || titleize(channel)} · {list.length}
            </Typography>
            <Box sx={{ display: 'grid', gap: 2, mt: 0.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,1fr)', lg: 'repeat(3,1fr)' } }}>
              {list.map((t) => (
                <Card key={t.id} variant="outlined" sx={{ borderRadius: 2.5, opacity: t.is_active === false ? 0.6 : 1 }}>
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>{t.name}</Typography>
                        {t.category && <Chip label={t.category} size="small" sx={{ mt: 0.5, height: 20, bgcolor: `${theme.palette.primary.main}14`, color: theme.palette.primary.main }} />}
                      </Box>
                      <Switch size="small" checked={t.is_active !== false} onChange={() => toggleActive(t)} />
                    </Stack>
                    {t.subject && (
                      <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mt: 1 }}>{t.subject}</Typography>
                    )}
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {t.body}
                    </Typography>
                    <Stack direction="row" justifyContent="flex-end" spacing={0.5} sx={{ mt: 1 }}>
                      <IconButton size="small" onClick={() => setDialog({ open: true, template: t })}>
                        <EditOutlined fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="error" onClick={() => remove(t.id)}>
                        <DeleteOutlineRounded fontSize="small" />
                      </IconButton>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Box>
          </Box>
        ))
      )}

      <TemplateDialog open={dialog.open} template={dialog.template} onClose={() => setDialog({ open: false, template: null })} onDone={load} />
    </Box>
  );
}

/* ================================================================ WORKFLOWS */

const WORKFLOW_BLUEPRINTS = [
  { name: 'New Prospect Welcome', description: 'New prospect → wait 3 days → Intro email', trigger_type: 'new_prospect', icon: BoltRounded, trigger_config: { wait_days: 3 }, steps: [{ channel: 'email', template: 'Intro' }] },
  { name: 'Quotation Follow-up', description: 'Quotation Sent → wait 5 days → WhatsApp follow-up', trigger_type: 'quotation_sent', icon: WhatsApp, trigger_config: { wait_days: 5 }, steps: [{ channel: 'whatsapp', template: 'Quote follow-up' }] },
  { name: 'Re-engage Quiet Contacts', description: 'No interaction for 30 days → check-in message', trigger_type: 'no_interaction_30d', icon: SpeakerNotesOffOutlined, trigger_config: { days: 30 }, steps: [{ channel: 'whatsapp', template: 'Check-in' }] },
  { name: 'Dormant Client Alert', description: 'No orders for 90 days → notify account manager', trigger_type: 'no_orders_90d', icon: WarningAmberRounded, trigger_config: { days: 90 }, steps: [{ channel: 'portal', template: 'Manager alert' }] },
  { name: 'Birthday / Festival Greeting', description: 'Birthday or festival → automated greeting', trigger_type: 'date_event', icon: CakeOutlined, trigger_config: { events: ['birthday', 'festival'] }, steps: [{ channel: 'whatsapp', template: 'Greeting' }] },
];

function WorkflowsTab({ theme }) {
  const [saved, setSaved] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await kitService.listWorkflows();
    setSaved(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const findSaved = (bp) => saved.find((w) => w.name === bp.name);

  const toggle = async (bp) => {
    const existing = findSaved(bp);
    if (existing) {
      await kitService.saveWorkflow({ ...existing, is_active: !existing.is_active });
    } else {
      await kitService.saveWorkflow({ ...bp, icon: undefined, is_active: true });
    }
    load();
  };

  return (
    <Box>
      <Paper variant="outlined" sx={{ borderRadius: 2.5, p: 2, mb: 2, bgcolor: `${theme.palette.primary.main}08`, borderColor: `${theme.palette.primary.main}33` }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <BoltRounded sx={{ color: theme.palette.primary.main }} />
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Automation foundation</Typography>
            <Typography variant="caption" color="text.secondary">
              Create and toggle automations now. The automation engine that runs these on schedule ships in a future release — nothing is executed automatically yet.
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {loading ? (
        <Skeleton variant="rounded" height={200} />
      ) : (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,1fr)', lg: 'repeat(3,1fr)' } }}>
          {WORKFLOW_BLUEPRINTS.map((bp) => {
            const existing = findSaved(bp);
            const active = existing ? existing.is_active : false;
            const Icon = bp.icon;
            return (
              <Card key={bp.name} variant="outlined" sx={{ borderRadius: 2.5, borderColor: active ? theme.palette.primary.main : 'divider' }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box sx={{ p: 1, borderRadius: 2, bgcolor: `${theme.palette.primary.main}1a`, color: theme.palette.primary.main, display: 'flex' }}>
                      <Icon />
                    </Box>
                    <Switch checked={active} onChange={() => toggle(bp)} />
                  </Stack>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1.5 }}>{bp.name}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{bp.description}</Typography>
                  <Chip
                    label={existing ? (active ? 'Created · enabled' : 'Created · paused') : 'Not created'}
                    size="small"
                    sx={{ mt: 1.5, fontWeight: 600, bgcolor: existing ? (active ? `${theme.palette.success.main}1a` : `${theme.palette.warning.main}1a`) : 'action.hover', color: existing ? (active ? theme.palette.success.main : theme.palette.warning.main) : 'text.secondary' }}
                  />
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

/* ============================================================== ROOT MODULE */

export default function KitModule() {
  const theme = useTheme();
  const [tab, setTab] = useState(0);
  const [stats, setStats] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [send, setSend] = useState({ open: false, contact: null, channel: 'whatsapp' });
  const [followup, setFollowup] = useState({ open: false, contact: null });
  const [assign, setAssign] = useState({ open: false, contact: null });

  const reloadStats = useCallback(async () => {
    const [d, c] = await Promise.all([kitService.dashboard(), kitService.listContacts()]);
    setStats(d);
    setContacts(c);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [d, c, u, me] = await Promise.all([
        kitService.dashboard(),
        kitService.listContacts(),
        listAssignableUsers(),
        getCurrentUserEmail(),
      ]);
      if (!alive) return;
      setStats(d);
      setContacts(c);
      setUsers(Array.isArray(u) ? u : []);
      setCurrentUser(me);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Unified action handler from any tab/list row.
  const handleAction = useCallback((type, contact) => {
    if (!contact) return;
    if (type === 'whatsapp') setSend({ open: true, contact, channel: 'whatsapp' });
    else if (type === 'email') setSend({ open: true, contact, channel: 'email' });
    else if (type === 'schedule') setSend({ open: true, contact, channel: contact.whatsapp_enabled ? 'whatsapp' : 'email' });
    else if (type === 'followup') setFollowup({ open: true, contact });
    else if (type === 'assign') setAssign({ open: true, contact });
  }, []);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
      {/* Header */}
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
        <Box sx={{ p: 1, borderRadius: 2, bgcolor: `${theme.palette.primary.main}1a`, color: theme.palette.primary.main, display: 'flex' }}>
          <CampaignOutlined />
        </Box>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.15 }}>KIT — Keep In Touch</Typography>
          <Typography variant="body2" color="text.secondary">
            Marketing & engagement on the CRM master. Every message mirrors into the CRM timeline.
          </Typography>
        </Box>
      </Stack>

      <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mt: 2, mb: 3, borderBottom: 1, borderColor: 'divider' }} variant="scrollable" scrollButtons="auto">
        <Tab label="Dashboard" />
        <Tab label="Contacts" />
        <Tab label="Templates" />
        <Tab label="Workflows" />
      </Tabs>

      {tab === 0 && <DashboardTab stats={stats} contacts={contacts} loading={loading} theme={theme} onAction={handleAction} />}
      {tab === 1 && <ContactsTab contacts={contacts} loading={loading} users={users} theme={theme} onAction={handleAction} />}
      {tab === 2 && <TemplatesTab theme={theme} />}
      {tab === 3 && <WorkflowsTab theme={theme} />}

      <SendDialog
        open={send.open}
        contact={send.contact}
        channel={send.channel}
        currentUser={currentUser}
        onClose={() => setSend((s) => ({ ...s, open: false }))}
        onSent={reloadStats}
      />
      <FollowupDialog
        open={followup.open}
        contact={followup.contact}
        currentUser={currentUser}
        onClose={() => setFollowup({ open: false, contact: null })}
        onDone={reloadStats}
      />
      <AssignDialog
        open={assign.open}
        contact={assign.contact}
        users={users}
        onClose={() => setAssign({ open: false, contact: null })}
        onDone={reloadStats}
      />
    </Box>
  );
}
