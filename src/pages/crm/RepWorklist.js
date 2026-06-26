import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CompanyLink from '../../components/crm/CompanyLink';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  RefreshRounded,
  TaskAltRounded,
  PlaylistAddCheckRounded,
  ReceiptLong,
  Replay,
  Schedule,
  Event,
  PhoneMissed,
  CallRounded,
  WhatsApp as WhatsAppIcon,
  EmailRounded,
  OpenInNewRounded,
  AutorenewRounded,
  EventAvailableRounded,
  GroupsOutlined,
} from '@mui/icons-material';
import { StatCard, Panel, inrCompact } from '../../components/common/kit';
import { usePermissions } from '../../context/PermissionContext';
import {
  repWorklist,
  getCurrentUserEmail,
  listAssignableUsers,
} from '../../services/crmPipelineService';

// ---------------------------------------------------------------------------
// Static config (segment + reason metadata). Colors resolve against the live
// theme palette at render time — no hardcoded hex.
// ---------------------------------------------------------------------------
const SEGMENTS = [
  { key: 'champion', label: 'Champion' },
  { key: 'loyal', label: 'Loyal' },
  { key: 'potential', label: 'Potential' },
  { key: 'at_risk', label: 'At Risk' },
  { key: 'hibernating', label: 'Hibernating' },
  { key: 'new', label: 'New' },
];

const REASON_META = {
  payment_overdue: { icon: ReceiptLong, tone: 'error' },
  reorder_overdue: { icon: Replay, tone: 'error' },
  reorder_due: { icon: Replay, tone: 'warning' },
  reorder_due_soon: { icon: Schedule, tone: 'info' },
  followup_due: { icon: Event, tone: 'primary' },
  no_touch: { icon: PhoneMissed, tone: 'muted' },
};

// Resolve a segment key → a concrete theme color.
function segmentColor(theme, key) {
  switch (key) {
    case 'champion':
      return theme.palette.success.main;
    case 'loyal':
      return theme.palette.primary.main;
    case 'potential':
      return theme.palette.secondary.main;
    case 'at_risk':
      return theme.palette.error.main;
    case 'hibernating':
      return theme.palette.warning.main;
    case 'new':
    default:
      return theme.palette.text.secondary;
  }
}

// Resolve a reason tone → a concrete theme color.
function toneColor(theme, tone) {
  switch (tone) {
    case 'error':
      return theme.palette.error.main;
    case 'warning':
      return theme.palette.warning.main;
    case 'info':
      return theme.palette.info.main;
    case 'primary':
      return theme.palette.primary.main;
    case 'muted':
    default:
      return theme.palette.text.secondary;
  }
}

// Priority badge color + label by score band.
function priorityMeta(theme, score) {
  const s = Number(score) || 0;
  if (s >= 70) return { color: theme.palette.error.main, label: 'Act now' };
  if (s >= 40) return { color: theme.palette.warning.main, label: 'Soon' };
  return { color: theme.palette.text.secondary, label: 'Watch' };
}

// Display name from an email — resolved name map first, else the local-part.
function ownerDisplay(email, nameMap) {
  if (!email) return 'Unassigned';
  const resolved = nameMap && nameMap[String(email).toLowerCase()];
  if (resolved) return resolved;
  const prefix = String(email).split('@')[0] || email;
  return prefix.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const onlyDigits = (s) => String(s || '').replace(/[^\d]/g, '');

// ---------------------------------------------------------------------------
// Account worklist card
// ---------------------------------------------------------------------------
function WorklistCard({ row, nameMap, onOpen }) {
  const theme = useTheme();
  const score = Math.round(Number(row.priority_score) || 0);
  const prio = priorityMeta(theme, score);
  const segColor = segmentColor(theme, row.segment);
  const segLabel = (SEGMENTS.find((s) => s.key === row.segment) || {}).label || row.segment;

  const phone = onlyDigits(row.phone);
  const waName = row.contact_person || row.company_name || 'there';
  const waText = encodeURIComponent(
    `Hi ${waName}, this is from Reyansh International — wanted to check in on your requirements.`,
  );

  const metaChips = [row.city, row.industry, row.product_category].filter(Boolean);

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2.5,
        p: { xs: 1.5, sm: 2 },
        borderLeft: `4px solid ${prio.color}`,
      }}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ xs: 'stretch', md: 'flex-start' }}
      >
        {/* LEFT — priority badge + identity */}
        <Stack direction="row" spacing={1.5} sx={{ minWidth: 0, flex: { md: '0 0 30%' } }}>
          <Tooltip title={`Priority ${score} · ${prio.label}`}>
            <Box
              sx={{
                flexShrink: 0,
                width: 52,
                height: 52,
                borderRadius: '50%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: alpha(prio.color, 0.14),
                color: prio.color,
                border: `1px solid ${alpha(prio.color, 0.4)}`,
              }}
            >
              <Typography sx={{ fontWeight: 800, fontSize: 18, lineHeight: 1 }}>{score}</Typography>
              <Typography sx={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                {prio.label}
              </Typography>
            </Box>
          </Tooltip>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.2 }} noWrap>
              <CompanyLink code={row.customer_code} name={row.company_name || row.customer_code || 'Account'} />
            </Typography>
            {row.customer_code && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {row.customer_code}
              </Typography>
            )}
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              {metaChips.map((m) => (
                <Chip key={m} label={m} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
              ))}
            </Stack>
          </Box>
        </Stack>

        {/* MIDDLE — the reasons (the "why") */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack spacing={0.75}>
            {(Array.isArray(row.reasons) ? row.reasons : []).map((r, i) => {
              const meta = REASON_META[r.code] || { icon: Event, tone: 'muted' };
              const Icon = meta.icon;
              const c = toneColor(theme, meta.tone);
              return (
                <Stack key={`${r.code}-${i}`} direction="row" spacing={1} alignItems="flex-start">
                  <Box
                    sx={{
                      mt: '1px',
                      width: 22,
                      height: 22,
                      borderRadius: 1,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: alpha(c, 0.12),
                      color: c,
                    }}
                  >
                    <Icon sx={{ fontSize: 15 }} />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: c, lineHeight: 1.3 }}>
                      {r.label}
                    </Typography>
                    {r.detail && (
                      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>
                        {r.detail}
                      </Typography>
                    )}
                  </Box>
                </Stack>
              );
            })}
            {(!Array.isArray(row.reasons) || row.reasons.length === 0) && (
              <Typography variant="caption" color="text.secondary">
                No specific trigger — review on cadence.
              </Typography>
            )}
          </Stack>
        </Box>

        {/* RIGHT — quick actions + facts */}
        <Stack spacing={1} sx={{ flex: { md: '0 0 24%' }, alignItems: { xs: 'flex-start', md: 'flex-end' } }}>
          <Stack direction="row" spacing={0.5}>
            {phone && (
              <Tooltip title={`Call ${row.phone}`}>
                <IconButton
                  size="small"
                  component="a"
                  href={`tel:${row.phone}`}
                  sx={{ color: theme.palette.primary.main, bgcolor: alpha(theme.palette.primary.main, 0.1) }}
                >
                  <CallRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {phone && (
              <Tooltip title="WhatsApp">
                <IconButton
                  size="small"
                  component="a"
                  href={`https://wa.me/${phone}?text=${waText}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ color: theme.palette.success.main, bgcolor: alpha(theme.palette.success.main, 0.1) }}
                >
                  <WhatsAppIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {row.email && (
              <Tooltip title={`Email ${row.email}`}>
                <IconButton
                  size="small"
                  component="a"
                  href={`mailto:${row.email}`}
                  sx={{ color: theme.palette.info.main, bgcolor: alpha(theme.palette.info.main, 0.1) }}
                >
                  <EmailRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Open in CRM">
              <IconButton
                size="small"
                onClick={onOpen}
                sx={{ color: theme.palette.text.secondary, bgcolor: alpha(theme.palette.text.secondary, 0.1) }}
              >
                <OpenInNewRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>

          <Chip
            label={segLabel}
            size="small"
            sx={{
              height: 22,
              fontSize: 11,
              fontWeight: 700,
              bgcolor: alpha(segColor, 0.14),
              color: segColor,
            }}
          />

          <Stack spacing={0.25} sx={{ alignItems: { xs: 'flex-start', md: 'flex-end' } }}>
            <Typography variant="body2" sx={{ fontWeight: 800 }}>
              {inrCompact(row.monetary)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {row.order_count ? `${row.order_count} orders` : 'No orders'}
              {row.recency_days != null ? ` · ${row.recency_days}d ago` : ''}
            </Typography>
            {Number(row.overdue_balance) > 0 && (
              <Typography variant="caption" sx={{ color: theme.palette.error.main, fontWeight: 700 }}>
                {inrCompact(row.overdue_balance)} overdue
              </Typography>
            )}
            {row.contact_person && (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 180 }}>
                {row.contact_person}
              </Typography>
            )}
          </Stack>
        </Stack>
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function RepWorklist() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { roleCode, hasFullAccess } = usePermissions();

  const [rows, setRows] = useState([]);
  const [nameMap, setNameMap] = useState({});
  const [myEmail, setMyEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [segFilter, setSegFilter] = useState(null);
  const [ownerFilter, setOwnerFilter] = useState('all');

  // CEO / super-admin / full-access users see every account.
  const seesAll =
    hasFullAccess ||
    ['CEO', 'SUPER_ADMIN', 'SUPERADMIN'].includes(String(roleCode || '').toUpperCase());

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const email = await getCurrentUserEmail();
        if (!alive) return;
        setMyEmail(email || null);

        const [list, users] = await Promise.all([
          repWorklist(seesAll ? null : email),
          listAssignableUsers(),
        ]);
        if (!alive) return;
        setRows(Array.isArray(list) ? list : []);
        const map = {};
        (Array.isArray(users) ? users : []).forEach((u) => {
          if (u && u.email) map[String(u.email).toLowerCase()] = u.full_name || null;
        });
        setNameMap(map);
      } catch (err) {
        if (alive) setError(err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [seesAll, refreshKey]);

  // Distinct owners present in the result (managers' owner filter dropdown).
  const owners = useMemo(() => {
    const set = new Map();
    rows.forEach((r) => {
      const e = r.owner_email;
      if (e && !set.has(String(e).toLowerCase())) {
        set.set(String(e).toLowerCase(), e);
      }
    });
    return Array.from(set.values()).sort((a, b) =>
      ownerDisplay(a, nameMap).localeCompare(ownerDisplay(b, nameMap)),
    );
  }, [rows, nameMap]);

  // Apply owner + segment filters (client-side).
  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (seesAll && ownerFilter !== 'all') {
        if (String(r.owner_email || '').toLowerCase() !== String(ownerFilter).toLowerCase()) {
          return false;
        }
      }
      if (segFilter && r.segment !== segFilter) return false;
      return true;
    });
  }, [rows, seesAll, ownerFilter, segFilter]);

  // Summary KPIs derived from the (owner-scoped, pre-segment-filter) set.
  const scoped = useMemo(() => {
    if (!seesAll || ownerFilter === 'all') return rows;
    return rows.filter(
      (r) => String(r.owner_email || '').toLowerCase() === String(ownerFilter).toLowerCase(),
    );
  }, [rows, seesAll, ownerFilter]);

  const summary = useMemo(() => {
    let paymentCount = 0;
    let paymentSum = 0;
    let reorderCount = 0;
    let followupCount = 0;
    scoped.forEach((r) => {
      const codes = new Set((Array.isArray(r.reasons) ? r.reasons : []).map((x) => x.code));
      if (codes.has('payment_overdue') || Number(r.overdue_balance) > 0) {
        paymentCount += 1;
        paymentSum += Number(r.overdue_balance) || 0;
      }
      if (codes.has('reorder_overdue') || codes.has('reorder_due') || codes.has('reorder_due_soon')) {
        reorderCount += 1;
      }
      if (codes.has('followup_due')) followupCount += 1;
    });
    return { total: scoped.length, paymentCount, paymentSum, reorderCount, followupCount };
  }, [scoped]);

  // Per-segment counts for the strip (from the owner-scoped set).
  const segCounts = useMemo(() => {
    const counts = {};
    SEGMENTS.forEach((s) => {
      counts[s.key] = 0;
    });
    scoped.forEach((r) => {
      if (counts[r.segment] != null) counts[r.segment] += 1;
    });
    return counts;
  }, [scoped]);

  const refresh = () => setRefreshKey((k) => k + 1);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1200, mx: 'auto' }}>
      {/* Header */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <PlaylistAddCheckRounded sx={{ color: theme.palette.primary.main }} />
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              Daily Worklist
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Prioritised accounts that need a touch today
            {seesAll ? ' · all reps' : ' · your accounts'}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1.5} alignItems="center">
          {seesAll && (
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="wl-owner-label">Owner</InputLabel>
              <Select
                labelId="wl-owner-label"
                label="Owner"
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
              >
                <MenuItem value="all">All owners</MenuItem>
                {owners.map((e) => (
                  <MenuItem key={e} value={e}>
                    {ownerDisplay(e, nameMap)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <Button
            variant="outlined"
            size="small"
            startIcon={<RefreshRounded />}
            onClick={refresh}
            disabled={loading}
          >
            Refresh
          </Button>
        </Stack>
      </Stack>

      {/* Summary row */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          mb: 3,
          gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4,1fr)' },
        }}
      >
        <StatCard
          label="To action"
          value={summary.total}
          sub="Accounts in your worklist"
          icon={GroupsOutlined}
          accent={theme.palette.primary.main}
          loading={loading}
        />
        <StatCard
          label="Payment overdue"
          value={summary.paymentCount}
          sub={summary.paymentSum > 0 ? inrCompact(summary.paymentSum) : 'No overdue balance'}
          icon={ReceiptLong}
          accent={theme.palette.error.main}
          loading={loading}
        />
        <StatCard
          label="Reorder due"
          value={summary.reorderCount}
          sub="Due soon / due / overdue"
          icon={AutorenewRounded}
          accent={theme.palette.warning.main}
          loading={loading}
        />
        <StatCard
          label="Follow-ups due"
          value={summary.followupCount}
          sub="Scheduled touches"
          icon={EventAvailableRounded}
          accent={theme.palette.info.main}
          loading={loading}
        />
      </Box>

      {/* Segment strip */}
      {!loading && scoped.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
          {SEGMENTS.map((s) => {
            const c = segmentColor(theme, s.key);
            const active = segFilter === s.key;
            const count = segCounts[s.key] || 0;
            return (
              <Chip
                key={s.key}
                label={`${s.label} · ${count}`}
                size="small"
                clickable
                onClick={() => setSegFilter(active ? null : s.key)}
                variant={active ? 'filled' : 'outlined'}
                sx={{
                  fontWeight: 700,
                  borderColor: alpha(c, 0.5),
                  color: active ? theme.palette.getContrastText(c) : c,
                  bgcolor: active ? c : alpha(c, 0.08),
                  '&:hover': { bgcolor: active ? c : alpha(c, 0.16) },
                }}
              />
            );
          })}
          {segFilter && (
            <Chip label="Clear filter" size="small" variant="outlined" onClick={() => setSegFilter(null)} />
          )}
        </Stack>
      )}

      {/* Body */}
      {error ? (
        <Panel title="Worklist unavailable" height="auto">
          <Typography variant="body2" color="error">
            Could not load your worklist. {error.message ? `(${error.message})` : ''}
          </Typography>
          <Button variant="outlined" size="small" startIcon={<RefreshRounded />} onClick={refresh} sx={{ mt: 1.5 }}>
            Retry
          </Button>
        </Panel>
      ) : loading ? (
        <Stack spacing={2}>
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} variant="rounded" height={120} sx={{ borderRadius: 2.5 }} />
          ))}
        </Stack>
      ) : visibleRows.length === 0 ? (
        <Paper
          variant="outlined"
          sx={{
            borderRadius: 2.5,
            py: 8,
            px: 3,
            textAlign: 'center',
            color: 'text.secondary',
          }}
        >
          <TaskAltRounded sx={{ fontSize: 56, color: theme.palette.success.main, mb: 1 }} />
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary' }}>
            You&apos;re all caught up
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {segFilter
              ? 'No accounts in this segment need action right now.'
              : 'No accounts need action right now.'}
          </Typography>
          {segFilter && (
            <Button variant="outlined" size="small" onClick={() => setSegFilter(null)} sx={{ mt: 2 }}>
              Show all segments
            </Button>
          )}
        </Paper>
      ) : (
        <Stack spacing={2}>
          {visibleRows.map((row) => (
            <WorklistCard
              key={row.id || row.customer_code}
              row={row}
              nameMap={nameMap}
              onOpen={() => navigate('/crm-pipeline?view=clients')}
            />
          ))}
        </Stack>
      )}

      {/* subtle loading indicator while refreshing over existing content */}
      {loading && rows.length > 0 && (
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ mt: 2, color: 'text.secondary' }}>
          <CircularProgress size={16} />
          <Typography variant="caption">Refreshing…</Typography>
        </Stack>
      )}
    </Box>
  );
}
