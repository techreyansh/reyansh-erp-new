import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Skeleton,
  Slider,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  ChevronLeftRounded,
  ChevronRightRounded,
  LockOutlined,
  LockRounded,
  LockOpenRounded,
  TrendingUpRounded,
  TrendingDownRounded,
  TrendingFlatRounded,
  AddRounded,
  CheckCircleRounded,
  TaskAltRounded,
  SaveRounded,
} from '@mui/icons-material';
import {
  getCurrentWeekStart,
  addWeeks,
  weekSummary,
  personScore,
  saveReview,
  lockWeek,
  listCommitments,
  addCommitment,
  setCommitmentStatus,
} from '../../services/perfService';
import { usePermissions } from '../../context/PermissionContext';
import { useAuth } from '../../context/AuthContext';

// ---------------------------------------------------------------------------
// Band model — the five performance bands and their visual identity.
// outstanding & rising_star → GREEN, consistent → AMBER, needs_attention → RED,
// no_data → GREY.
// ---------------------------------------------------------------------------
const BANDS = {
  outstanding: { label: 'Outstanding Achiever', tone: 'green', paletteKey: 'success' },
  rising_star: { label: 'Rising Star', tone: 'green', paletteKey: 'success' },
  consistent: { label: 'Consistent Contributor', tone: 'amber', paletteKey: 'warning' },
  needs_attention: { label: 'Needs Attention', tone: 'red', paletteKey: 'error' },
  no_data: { label: 'No Data', tone: 'grey', paletteKey: 'grey' },
};

const LEGEND = [
  { tone: 'green', label: 'Outstanding / Rising Star' },
  { tone: 'amber', label: 'Consistent' },
  { tone: 'red', label: 'Needs Attention' },
  { tone: 'grey', label: 'No Data' },
];

const AGENDA = [
  "Review last week's commitments",
  'Review completed',
  'Review delayed',
  'Discuss blockers',
  'Assign new commitments',
  'Lock score',
];

// Category config: key → label + weight + which raw-count fields to surface.
const CATEGORIES = [
  { key: 'work_completed', label: 'Work Completed', weight: 40, counts: ['done', 'due'] },
  { key: 'on_time', label: 'On Time', weight: 25, counts: ['on_time'] },
  { key: 'checklist', label: 'Checklist', weight: 15, counts: ['ok', 'due'] },
  { key: 'workflow', label: 'Workflow', weight: 10, counts: ['ok', 'due'] },
  { key: 'meeting', label: 'Meeting', weight: 5, counts: [] },
  { key: 'manager', label: 'Manager', weight: 5, counts: [] },
];

const COMMIT_STATUS_META = {
  committed: { label: 'Committed', paletteKey: 'info' },
  delivered: { label: 'Delivered', paletteKey: 'success' },
  missed: { label: 'Missed', paletteKey: 'error' },
  carried_over: { label: 'Carried over', paletteKey: 'warning' },
};

function bandMeta(band) {
  return BANDS[band] || BANDS.no_data;
}

/** Resolve a band's accent color from the theme. */
function bandColor(theme, band) {
  const meta = bandMeta(band);
  if (meta.paletteKey === 'grey') return theme.palette.text.disabled;
  return theme.palette[meta.paletteKey]?.main || theme.palette.text.disabled;
}

function weekLabel(weekStart) {
  const [y, m, d] = String(weekStart).split('-').map(Number);
  if (!y) return String(weekStart || '');
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function shortDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y) return String(iso);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/** A small ▲/▼/— trend marker comparing score to prev_score. */
function TrendMarker({ score, prev, withLabel = false }) {
  const theme = useTheme();
  const hasBoth = score != null && prev != null;
  const delta = hasBoth ? Number(score) - Number(prev) : 0;
  let Icon = TrendingFlatRounded;
  let color = theme.palette.text.secondary;
  if (delta > 0) {
    Icon = TrendingUpRounded;
    color = theme.palette.success.main;
  } else if (delta < 0) {
    Icon = TrendingDownRounded;
    color = theme.palette.error.main;
  }
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color }}>
      <Icon sx={{ fontSize: '1.1rem' }} />
      {withLabel && (
        <Typography variant="caption" sx={{ fontWeight: 700, color }}>
          {hasBoth ? `${delta > 0 ? '+' : ''}${delta} vs last week` : 'No prior week'}
        </Typography>
      )}
    </Stack>
  );
}

function BandChip({ band, size = 'small' }) {
  const theme = useTheme();
  const meta = bandMeta(band);
  const color = bandColor(theme, band);
  return (
    <Chip
      label={meta.label}
      size={size}
      sx={{
        fontWeight: 700,
        letterSpacing: '0.02em',
        bgcolor: alpha(color, 0.14),
        color,
        border: `1px solid ${alpha(color, 0.4)}`,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// LEFT ROSTER — one card per employee.
// ---------------------------------------------------------------------------
function RosterCard({ person, selected, onSelect }) {
  const theme = useTheme();
  const accent = bandColor(theme, person.band);
  const score = person.score;
  return (
    <Paper
      variant="outlined"
      onClick={() => onSelect(person)}
      sx={{
        borderRadius: 2,
        p: 1.5,
        cursor: 'pointer',
        borderColor: selected ? accent : 'divider',
        bgcolor: selected ? alpha(accent, 0.06) : 'background.paper',
        transition: 'border-color 0.18s ease, background-color 0.18s ease',
        '&:hover': { borderColor: alpha(accent, 0.5) },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Box sx={{ width: 4, alignSelf: 'stretch', borderRadius: 2, bgcolor: accent, flexShrink: 0 }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
            {person.full_name || person.email}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {person.department || person.designation || '—'}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
          <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end">
            <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1, color: accent }}>
              {score == null ? '—' : score}
            </Typography>
            <TrendMarker score={score} prev={person.prev_score} />
          </Stack>
        </Box>
      </Stack>
      <Box sx={{ mt: 1 }}>
        <LinearProgress
          variant="determinate"
          value={score == null ? 0 : Math.max(0, Math.min(100, Number(score)))}
          sx={{
            height: 6,
            borderRadius: 3,
            bgcolor: alpha(accent, 0.14),
            '& .MuiLinearProgress-bar': { borderRadius: 3, bgcolor: accent },
          }}
        />
      </Box>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// CATEGORY BREAKDOWN — one labelled progress row per category.
// ---------------------------------------------------------------------------
function CategoryRow({ cfg, data }) {
  const theme = useTheme();
  const pct = data && data.pct != null ? Math.max(0, Math.min(100, Number(data.pct))) : null;
  const hasData = pct != null;
  const accent = !hasData
    ? theme.palette.text.disabled
    : pct >= 80
    ? theme.palette.success.main
    : pct >= 60
    ? theme.palette.warning.main
    : theme.palette.error.main;

  // Build a "done/due" style sub-label from whichever count fields exist.
  let sub = '';
  if (data) {
    if (cfg.key === 'work_completed' && (data.done != null || data.due != null)) {
      sub = `${data.done ?? 0}/${data.due ?? 0} done`;
    } else if (cfg.key === 'on_time' && data.on_time != null) {
      sub = `${data.on_time} on time`;
    } else if ((cfg.key === 'checklist' || cfg.key === 'workflow') && (data.ok != null || data.due != null)) {
      sub = `${data.ok ?? 0}/${data.due ?? 0} ok`;
    }
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 1.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.75 }}>
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary' }}
        >
          {cfg.label}
        </Typography>
        <Chip
          label={`weight ${cfg.weight}%`}
          size="small"
          variant="outlined"
          sx={{ height: 20, fontSize: '0.68rem', fontWeight: 600 }}
        />
      </Stack>
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <LinearProgress
            variant="determinate"
            value={hasData ? pct : 0}
            sx={{
              height: 8,
              borderRadius: 4,
              bgcolor: alpha(accent, 0.14),
              '& .MuiLinearProgress-bar': { borderRadius: 4, bgcolor: accent },
            }}
          />
        </Box>
        <Typography
          variant="h6"
          sx={{ fontWeight: 800, minWidth: 52, textAlign: 'right', color: hasData ? 'text.primary' : 'text.disabled' }}
        >
          {hasData ? `${pct}%` : 'no data'}
        </Typography>
      </Stack>
      {sub && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {sub}
        </Typography>
      )}
    </Paper>
  );
}

function ScorecardSkeleton() {
  return (
    <Stack spacing={2}>
      <Skeleton variant="rounded" height={120} />
      <Skeleton variant="rounded" height={220} />
      <Skeleton variant="rounded" height={180} />
      <Skeleton variant="rounded" height={160} />
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// MANAGER EVALUATION panel.
// ---------------------------------------------------------------------------
function ManagerEvalPanel({ score, locked, canEdit, onSave, saving }) {
  const [meeting, setMeeting] = useState(0);
  const [evalScore, setEvalScore] = useState(0);
  const [remarks, setRemarks] = useState('');

  // Re-seed local form whenever a different score object loads.
  useEffect(() => {
    const cats = score?.categories || {};
    setMeeting(Number(cats.meeting?.pct) || 0);
    setEvalScore(Number(cats.manager?.pct) || 0);
    setRemarks(score?.manager_remarks || '');
  }, [score]);

  const disabled = locked || !canEdit;

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 2, sm: 2.5 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Manager Evaluation
        </Typography>
        {locked && (
          <Chip icon={<LockRounded sx={{ fontSize: '1rem' }} />} label="Locked" size="small" color="success" variant="outlined" sx={{ fontWeight: 700 }} />
        )}
      </Stack>

      {!canEdit && !locked && (
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          Read-only — only a manager or the CEO can edit evaluations.
        </Alert>
      )}

      <Stack spacing={2.5}>
        <Box>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>Meeting Participation</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>{meeting}</Typography>
          </Stack>
          <Slider
            value={meeting}
            onChange={(_e, v) => setMeeting(Array.isArray(v) ? v[0] : v)}
            min={0}
            max={100}
            disabled={disabled}
            valueLabelDisplay="auto"
            size="small"
          />
        </Box>

        <Box>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>Manager Evaluation</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>{evalScore}</Typography>
          </Stack>
          <Slider
            value={evalScore}
            onChange={(_e, v) => setEvalScore(Array.isArray(v) ? v[0] : v)}
            min={0}
            max={100}
            disabled={disabled}
            valueLabelDisplay="auto"
            size="small"
          />
        </Box>

        <TextField
          label="Manager Remarks"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          multiline
          minRows={2}
          maxRows={6}
          fullWidth
          disabled={disabled}
          placeholder="Notes on this week's performance, blockers, expectations for next week…"
        />

        <Stack direction="row" justifyContent="flex-end">
          <Button
            variant="contained"
            startIcon={<SaveRounded />}
            disabled={disabled || saving}
            onClick={() => onSave({ meetingParticipation: meeting, managerEval: evalScore, managerRemarks: remarks })}
            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 1.5 }}
          >
            {saving ? 'Saving…' : 'Save evaluation'}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// COMMITMENTS panel.
// ---------------------------------------------------------------------------
function CommitmentsPanel({ commitments, loading, canEdit, locked, onAdd, onDeliver, adding }) {
  const theme = useTheme();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');

  const submit = () => {
    if (!title.trim()) return;
    onAdd({ title: title.trim(), dueDate: due || null });
    setTitle('');
    setDue('');
  };

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 2, sm: 2.5 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Commitments</Typography>
        <Chip label={loading ? '…' : commitments.length} size="small" sx={{ fontWeight: 700 }} />
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        Next week's review measures committed-vs-delivered for this list.
      </Typography>

      {loading ? (
        <Stack spacing={1}>
          {[1, 2].map((n) => <Skeleton key={n} variant="rounded" height={48} />)}
        </Stack>
      ) : commitments.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No commitments captured for this week yet.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {commitments.map((c) => {
            const meta = COMMIT_STATUS_META[c.status] || COMMIT_STATUS_META.committed;
            const color = theme.palette[meta.paletteKey]?.main || theme.palette.text.secondary;
            const delivered = c.status === 'delivered';
            return (
              <Box
                key={c.id}
                sx={{
                  borderLeft: `3px solid ${color}`,
                  bgcolor: alpha(color, 0.05),
                  borderRadius: 1,
                  px: 1.25,
                  py: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{c.title}</Typography>
                  <Typography variant="caption" color="text.secondary">due {shortDate(c.due_date)}</Typography>
                </Box>
                <Chip label={meta.label} size="small" sx={{ bgcolor: alpha(color, 0.16), color, fontWeight: 700 }} />
                {canEdit && !locked && !delivered && (
                  <Tooltip title="Mark delivered">
                    <IconButton size="small" color="success" onClick={() => onDeliver(c.id)}>
                      <CheckCircleRounded fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            );
          })}
        </Stack>
      )}

      {canEdit && !locked && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            <TextField
              label="New commitment"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              size="small"
              fullWidth
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            />
            <TextField
              label="Due"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              size="small"
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 150 }}
            />
            <Button
              variant="outlined"
              startIcon={<AddRounded />}
              onClick={submit}
              disabled={!title.trim() || adding}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 1.5, whiteSpace: 'nowrap' }}
            >
              Add
            </Button>
          </Stack>
        </>
      )}
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// MEETING AGENDA — compact visual checklist (guide only).
// ---------------------------------------------------------------------------
function AgendaGuide() {
  const theme = useTheme();
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 2, sm: 2.5 } }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>Meeting Agenda</Typography>
      <Stack spacing={1}>
        {AGENDA.map((step, i) => (
          <Stack key={step} direction="row" spacing={1.25} alignItems="center">
            <Box
              sx={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.72rem',
                fontWeight: 700,
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                color: theme.palette.primary.main,
                flexShrink: 0,
              }}
            >
              {i + 1}
            </Box>
            <Typography variant="body2" color="text.secondary">{step}</Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// RIGHT — selected employee scorecard.
// ---------------------------------------------------------------------------
function EmployeeReview({ person, score, loading, canEdit, commitments, commitmentsLoading, onSaveReview, saving, onAddCommitment, onDeliver, addingCommitment }) {
  const theme = useTheme();
  if (loading) return <ScorecardSkeleton />;
  if (!score) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: 2.5, p: 4, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Couldn't load this person's scorecard for the selected week.
        </Typography>
      </Paper>
    );
  }

  const accent = bandColor(theme, score.band);
  const cats = score.categories || {};
  const prev = person?.prev_score;
  const locked = Boolean(score.locked);

  return (
    <Stack spacing={2}>
      {/* a) Score header */}
      <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 2, sm: 2.5 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} alignItems={{ sm: 'center' }}>
          <Box
            sx={{
              width: 96,
              height: 96,
              borderRadius: '50%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: alpha(accent, 0.12),
              border: `2px solid ${alpha(accent, 0.5)}`,
              flexShrink: 0,
            }}
          >
            <Typography variant="h3" sx={{ fontWeight: 800, lineHeight: 1, color: accent }}>
              {score.score == null ? '—' : score.score}
            </Typography>
            <Typography variant="caption" color="text.secondary">/ 100</Typography>
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              {person?.full_name || score.email}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {person?.department || person?.designation || ''}
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
              <BandChip band={score.band} size="medium" />
              <TrendMarker score={score.score} prev={prev} withLabel />
              {locked && (
                <Chip icon={<LockRounded sx={{ fontSize: '1rem' }} />} label="Locked" size="small" color="success" variant="outlined" sx={{ fontWeight: 700 }} />
              )}
            </Stack>
          </Box>
        </Stack>
      </Paper>

      {/* b) Category breakdown */}
      <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 2, sm: 2.5 } }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>Category Breakdown</Typography>
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          {CATEGORIES.map((cfg) => (
            <CategoryRow key={cfg.key} cfg={cfg} data={cats[cfg.key]} />
          ))}
        </Box>
      </Paper>

      {/* c) Manager evaluation */}
      <ManagerEvalPanel score={score} locked={locked} canEdit={canEdit} onSave={onSaveReview} saving={saving} />

      {/* d) Commitments */}
      <CommitmentsPanel
        commitments={commitments}
        loading={commitmentsLoading}
        canEdit={canEdit}
        locked={locked}
        onAdd={onAddCommitment}
        onDeliver={onDeliver}
        adding={addingCommitment}
      />

      {/* e) Agenda guide */}
      <AgendaGuide />
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// PAGE
// ---------------------------------------------------------------------------
export default function PerformanceReview() {
  const theme = useTheme();
  const { roleCode, hasFullAccess } = usePermissions();
  const { user } = useAuth();
  const currentEmail = user?.email ? String(user.email).trim().toLowerCase() : null;
  const didAutoSelect = useRef(false);

  // CEO / super-admin gate for manager edits + lock.
  const canManage = hasFullAccess || ['CEO', 'SUPER_ADMIN', 'SUPERADMIN'].includes(String(roleCode || '').toUpperCase());

  const [weekStart, setWeekStart] = useState(getCurrentWeekStart());
  const [roster, setRoster] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [score, setScore] = useState(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [commitments, setCommitments] = useState([]);
  const [commitmentsLoading, setCommitmentsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingCommitment, setAddingCommitment] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const notify = useCallback((message, severity = 'success') => {
    setSnackbar({ open: true, message, severity });
  }, []);

  const selectedPerson = useMemo(
    () => roster.find((r) => r.email === selectedEmail) || null,
    [roster, selectedEmail],
  );

  // Load roster on week change.
  useEffect(() => {
    let active = true;
    setRosterLoading(true);
    weekSummary(weekStart).then((rows) => {
      if (!active) return;
      setRoster(rows);
      setSelectedEmail((prev) => {
        if (prev && rows.some((r) => r.email === prev)) return prev;
        if (!didAutoSelect.current && currentEmail) {
          const mine = rows.find((r) => r.email && String(r.email).trim().toLowerCase() === currentEmail);
          if (mine) {
            didAutoSelect.current = true;
            return mine.email;
          }
        }
        return null;
      });
      setRosterLoading(false);
    });
    return () => { active = false; };
  }, [weekStart, currentEmail]);

  const loadScore = useCallback((email, week) => {
    if (!email) { setScore(null); return; }
    setScoreLoading(true);
    personScore(email, week).then((data) => {
      setScore(data);
      setScoreLoading(false);
    });
  }, []);

  // Load score + commitments when selection / week changes.
  useEffect(() => {
    if (!selectedEmail) { setScore(null); setCommitments([]); return; }
    let active = true;
    setScoreLoading(true);
    setCommitmentsLoading(true);
    personScore(selectedEmail, weekStart).then((data) => {
      if (active) { setScore(data); setScoreLoading(false); }
    });
    listCommitments(selectedEmail, weekStart).then((rows) => {
      if (active) { setCommitments(rows); setCommitmentsLoading(false); }
    });
    return () => { active = false; };
  }, [selectedEmail, weekStart]);

  const stats = useMemo(() => {
    const scored = roster.filter((r) => r.score != null);
    const sum = scored.reduce((a, r) => a + (Number(r.score) || 0), 0);
    const tone = (r) => bandMeta(r.band).tone;
    return {
      avg: scored.length ? Math.round(sum / scored.length) : 0,
      green: roster.filter((r) => tone(r) === 'green').length,
      amber: roster.filter((r) => tone(r) === 'amber').length,
      red: roster.filter((r) => tone(r) === 'red').length,
    };
  }, [roster]);

  const goWeek = useCallback((n) => setWeekStart((w) => addWeeks(w, n)), []);

  const handleSaveReview = useCallback(async (form) => {
    if (!selectedEmail) return;
    setSaving(true);
    const res = await saveReview({ email: selectedEmail, weekStart, ...form });
    setSaving(false);
    if (res.ok) {
      notify('Evaluation saved');
      loadScore(selectedEmail, weekStart);
      // Refresh the roster so the score/band on the left reflects the new eval.
      weekSummary(weekStart).then(setRoster);
    } else {
      notify('Could not save evaluation. Please try again.', 'error');
    }
  }, [selectedEmail, weekStart, notify, loadScore]);

  const handleAddCommitment = useCallback(async ({ title, dueDate }) => {
    if (!selectedEmail) return;
    setAddingCommitment(true);
    const res = await addCommitment({ email: selectedEmail, weekStart, title, dueDate });
    setAddingCommitment(false);
    if (res.ok) {
      notify('Commitment added');
      listCommitments(selectedEmail, weekStart).then(setCommitments);
    } else {
      notify('Could not add commitment.', 'error');
    }
  }, [selectedEmail, weekStart, notify]);

  const handleDeliver = useCallback(async (id) => {
    const res = await setCommitmentStatus(id, 'delivered');
    if (res.ok) {
      notify('Marked delivered');
      listCommitments(selectedEmail, weekStart).then(setCommitments);
    } else {
      notify('Could not update commitment.', 'error');
    }
  }, [selectedEmail, weekStart, notify]);

  const handleLockWeek = useCallback(async () => {
    setLockBusy(true);
    const res = await lockWeek(weekStart, true);
    setLockBusy(false);
    if (res.ok) {
      notify('Week locked for the whole team');
      if (selectedEmail) loadScore(selectedEmail, weekStart);
    } else {
      notify('Could not lock week. Please try again.', 'error');
    }
  }, [weekStart, selectedEmail, notify, loadScore]);

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto', width: '100%' }}>
      {/* HEADER */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
            Performance Review
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Weekly performance accountability
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Paper variant="outlined" sx={{ borderRadius: 2, px: 1, py: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Tooltip title="Previous week">
              <IconButton size="small" onClick={() => goWeek(-1)} aria-label="Previous week">
                <ChevronLeftRounded />
              </IconButton>
            </Tooltip>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, minWidth: 150, textAlign: 'center' }}>
              Week of {weekLabel(weekStart)}
            </Typography>
            <Tooltip title="Next week">
              <IconButton size="small" onClick={() => goWeek(1)} aria-label="Next week">
                <ChevronRightRounded />
              </IconButton>
            </Tooltip>
          </Paper>
          {canManage && (
            <Button
              variant="contained"
              startIcon={<LockOutlined />}
              onClick={handleLockWeek}
              disabled={lockBusy}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 1.5 }}
            >
              {lockBusy ? 'Locking…' : 'Lock week'}
            </Button>
          )}
        </Stack>
      </Stack>

      {/* Band legend */}
      <Paper variant="outlined" sx={{ borderRadius: 2, px: 2, py: 1, mb: 2 }}>
        <Stack direction="row" spacing={2.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}>
            Bands
          </Typography>
          {LEGEND.map((l) => {
            const color =
              l.tone === 'green' ? theme.palette.success.main :
              l.tone === 'amber' ? theme.palette.warning.main :
              l.tone === 'red' ? theme.palette.error.main :
              theme.palette.text.disabled;
            return (
              <Stack key={l.tone} direction="row" spacing={0.75} alignItems="center">
                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: color }} />
                <Typography variant="caption" color="text.secondary">{l.label}</Typography>
              </Stack>
            );
          })}
        </Stack>
      </Paper>

      {/* Two-pane layout */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 360px) minmax(0, 1fr)' }, alignItems: 'start' }}>
        {/* LEFT — roster */}
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <Paper variant="outlined" sx={{ borderRadius: 2.5, p: 1.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary' }}>
              Team this week
            </Typography>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mt: 0.75 }}>
              <Box>
                <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1 }}>
                  {rosterLoading ? '—' : stats.avg}
                </Typography>
                <Typography variant="caption" color="text.secondary">avg score</Typography>
              </Box>
              <Divider orientation="vertical" flexItem />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={`${stats.green} green`} size="small" color="success" variant="outlined" sx={{ fontWeight: 600 }} />
                <Chip label={`${stats.amber} amber`} size="small" color="warning" variant="outlined" sx={{ fontWeight: 600 }} />
                <Chip label={`${stats.red} red`} size="small" color="error" variant="outlined" sx={{ fontWeight: 600 }} />
              </Stack>
            </Stack>
          </Paper>

          <Stack spacing={1}>
            {rosterLoading ? (
              [1, 2, 3, 4, 5].map((n) => <Skeleton key={n} variant="rounded" height={84} />)
            ) : roster.length === 0 ? (
              <Alert severity="info" variant="outlined">No team data for week of {weekLabel(weekStart)}.</Alert>
            ) : (
              roster.map((p) => (
                <RosterCard
                  key={p.email}
                  person={p}
                  selected={p.email === selectedEmail}
                  onSelect={(person) => setSelectedEmail(person.email)}
                />
              ))
            )}
          </Stack>
        </Stack>

        {/* RIGHT — selected review */}
        <Box sx={{ minWidth: 0 }}>
          {!selectedEmail && !scoreLoading ? (
            <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 4, sm: 8 }, textAlign: 'center' }}>
              <TaskAltRounded sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                Select a team member
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Pick someone from the roster to review their weekly performance.
              </Typography>
            </Paper>
          ) : (
            <EmployeeReview
              person={selectedPerson}
              score={score}
              loading={scoreLoading}
              canEdit={canManage}
              commitments={commitments}
              commitmentsLoading={commitmentsLoading}
              onSaveReview={handleSaveReview}
              saving={saving}
              onAddCommitment={handleAddCommitment}
              onDeliver={handleDeliver}
              addingCommitment={addingCommitment}
            />
          )}
        </Box>
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity || 'success'} variant="filled" onClose={() => setSnackbar((s) => ({ ...s, open: false }))} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
