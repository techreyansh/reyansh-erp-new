import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Skeleton,
  Slider,
  Snackbar,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
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
  GroupsRounded,
  WarningAmberRounded,
  AccountTreeRounded,
  PlayArrowRounded,
  PersonOutlineRounded,
  DoneAllRounded,
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
  departmentDashboard,
  listWorkflows,
  listInstances,
  createInstance,
  listSteps,
  updateStep,
  completeStep,
  setInstanceStatus,
  listOwners,
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

/**
 * Resolve an accent color from a raw 0–100 score using the same thresholds the
 * department dashboard uses: >=75 green, 60–74 amber, <60 red, null grey.
 */
function scoreColor(theme, score) {
  if (score == null) return theme.palette.text.disabled;
  const n = Number(score);
  if (n >= 75) return theme.palette.success.main;
  if (n >= 60) return theme.palette.warning.main;
  return theme.palette.error.main;
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
// DEPARTMENTS VIEW — summary KPIs + a grid of department cards.
// ---------------------------------------------------------------------------

/** A compact summary KPI tile for the departments header strip. */
function DeptStat({ label, value, icon, tone }) {
  const theme = useTheme();
  const color =
    tone === 'success' ? theme.palette.success.main :
    tone === 'error' ? theme.palette.error.main :
    theme.palette.primary.main;
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 1.5, sm: 2 }, flex: 1, minWidth: 160 }}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(color, 0.12),
            color,
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1 }}>
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {label}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

/** One department card: name, members, big team score, bar, attention chip, top performers. */
function DepartmentCard({ dept }) {
  const theme = useTheme();
  const score = dept.team_score;
  const accent = scoreColor(theme, score);
  const needs = Number(dept.needs_attention) || 0;
  const top = Array.isArray(dept.top_performers) ? dept.top_performers : [];

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 2, sm: 2.5 }, height: '100%' }}>
      <Stack spacing={1.5} sx={{ height: '100%' }}>
        {/* Header — name + members */}
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }} noWrap>
              {dept.department || 'Unassigned'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {Number(dept.members) || 0} {Number(dept.members) === 1 ? 'member' : 'members'}
            </Typography>
          </Box>
          <Chip
            label={needs > 0 ? `${needs} need attention` : 'All on track'}
            size="small"
            color={needs > 0 ? 'error' : 'success'}
            variant={needs > 0 ? 'filled' : 'outlined'}
            sx={{ fontWeight: 700, flexShrink: 0 }}
          />
        </Stack>

        {/* Big team score + bar */}
        <Box>
          <Stack direction="row" alignItems="baseline" spacing={1}>
            <Typography variant="h3" sx={{ fontWeight: 800, lineHeight: 1, color: accent }}>
              {score == null ? '—' : Math.round(Number(score))}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              team score / 100
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={score == null ? 0 : Math.max(0, Math.min(100, Number(score)))}
            sx={{
              mt: 1,
              height: 8,
              borderRadius: 4,
              bgcolor: alpha(accent, 0.14),
              '& .MuiLinearProgress-bar': { borderRadius: 4, bgcolor: accent },
            }}
          />
        </Box>

        <Divider />

        {/* Top performers mini-list */}
        <Box sx={{ flex: 1 }}>
          <Typography
            variant="caption"
            sx={{ fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary', display: 'block', mb: 0.75 }}
          >
            Top performers
          </Typography>
          {top.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No scored members yet.
            </Typography>
          ) : (
            <Stack spacing={0.75}>
              {top.map((p, i) => {
                const pColor = scoreColor(theme, p.score);
                return (
                  <Stack key={`${p.full_name}-${i}`} direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0 }} noWrap>
                      {p.full_name}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 800, color: pColor, flexShrink: 0 }}>
                      {p.score == null ? '—' : Math.round(Number(p.score))}
                    </Typography>
                  </Stack>
                );
              })}
            </Stack>
          )}
        </Box>
      </Stack>
    </Paper>
  );
}

function DepartmentsView({ departments, loading, weekStart }) {
  // Sort by team_score desc, nulls last.
  const sorted = useMemo(() => {
    const rows = Array.isArray(departments) ? [...departments] : [];
    rows.sort((a, b) => {
      const sa = a.team_score == null ? null : Number(a.team_score);
      const sb = b.team_score == null ? null : Number(b.team_score);
      if (sa == null && sb == null) return 0;
      if (sa == null) return 1;
      if (sb == null) return -1;
      return sb - sa;
    });
    return rows;
  }, [departments]);

  const kpis = useMemo(() => {
    const rows = Array.isArray(departments) ? departments : [];
    const scored = rows.filter((d) => d.team_score != null);
    const sum = scored.reduce((a, d) => a + (Number(d.team_score) || 0), 0);
    const needs = rows.reduce((a, d) => a + (Number(d.needs_attention) || 0), 0);
    return {
      total: rows.length,
      avg: scored.length ? Math.round(sum / scored.length) : null,
      needs,
    };
  }, [departments]);

  if (loading) {
    return (
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {[1, 2, 3].map((n) => <Skeleton key={n} variant="rounded" height={76} sx={{ flex: 1 }} />)}
        </Stack>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' } }}>
          {[1, 2, 3, 4, 5, 6].map((n) => <Skeleton key={n} variant="rounded" height={240} />)}
        </Box>
      </Stack>
    );
  }

  if (sorted.length === 0) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 4, sm: 8 }, textAlign: 'center' }}>
        <GroupsRounded sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          No department data for this week
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Nothing to roll up for week of {weekLabel(weekStart)}.
        </Typography>
      </Paper>
    );
  }

  return (
    <Stack spacing={2}>
      {/* Summary KPIs */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <DeptStat label="Departments" value={kpis.total} icon={<GroupsRounded />} />
        <DeptStat label="Company avg score" value={kpis.avg == null ? '—' : kpis.avg} icon={<TrendingUpRounded />} tone="success" />
        <DeptStat label="Need attention" value={kpis.needs} icon={<WarningAmberRounded />} tone={kpis.needs > 0 ? 'error' : 'success'} />
      </Stack>

      {/* Department cards grid */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, alignItems: 'stretch' }}>
        {sorted.map((dept, i) => (
          <DepartmentCard key={dept.department || `dept-${i}`} dept={dept} />
        ))}
      </Box>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// WORKFLOWS VIEW — process accountability.
// LEFT: open instances (progress + overdue) + templates to start from.
// RIGHT: the step chain for a selected instance — owner / due / status / done.
// ---------------------------------------------------------------------------

/** Today as 'YYYY-MM-DD' (local) — for overdue comparisons. */
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** A step is overdue when it has a due_date before today and isn't done. */
function isStepOverdue(step) {
  if (!step || step.status === 'done' || !step.due_date) return false;
  return String(step.due_date) < todayISO();
}

const STEP_STATUS_META = {
  pending: { label: 'Pending', paletteKey: 'grey' },
  done: { label: 'Done', paletteKey: 'success' },
  blocked: { label: 'Blocked', paletteKey: 'error' },
};

/** Compute {done, total, pct, overdue} from a step array. */
function stepProgress(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const total = list.length;
  const done = list.filter((s) => s.status === 'done').length;
  const overdue = list.filter(isStepOverdue).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { done, total, pct, overdue };
}

function ownerLabel(owners, email) {
  if (!email) return null;
  const found = owners.find((o) => o.email && o.email.toLowerCase() === String(email).toLowerCase());
  return found?.full_name || String(email).split('@')[0];
}

/** LEFT — one open-process card with progress bar + overdue flag. */
function InstanceCard({ instance, workflowName, progress, selected, onSelect }) {
  const theme = useTheme();
  const accent = progress.overdue > 0
    ? theme.palette.error.main
    : progress.pct === 100
    ? theme.palette.success.main
    : theme.palette.primary.main;
  return (
    <Paper
      variant="outlined"
      onClick={() => onSelect(instance)}
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
            {instance.title || instance.reference || 'Untitled process'}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {workflowName || 'Workflow'}
            {instance.reference ? ` · ${instance.reference}` : ''}
          </Typography>
        </Box>
        {progress.overdue > 0 && (
          <Chip
            icon={<WarningAmberRounded sx={{ fontSize: '0.9rem' }} />}
            label={progress.overdue}
            size="small"
            color="error"
            sx={{ fontWeight: 700, flexShrink: 0 }}
          />
        )}
      </Stack>
      <Box sx={{ mt: 1 }}>
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {progress.done}/{progress.total} steps done
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 700, color: accent }}>
            {progress.pct}%
          </Typography>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={progress.pct}
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

/** RIGHT — one step row: seq, name, owner picker, due, status, mark-done. */
function StepRow({ step, owners, canEdit, onAssignOwner, onSetDue, onComplete, busy }) {
  const theme = useTheme();
  const overdue = isStepOverdue(step);
  const meta = STEP_STATUS_META[step.status] || STEP_STATUS_META.pending;
  const statusColor = meta.paletteKey === 'grey'
    ? theme.palette.text.disabled
    : theme.palette[meta.paletteKey]?.main || theme.palette.text.secondary;
  const done = step.status === 'done';
  const accent = overdue ? theme.palette.error.main : done ? theme.palette.success.main : theme.palette.text.disabled;

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2,
        p: 1.5,
        borderLeft: `4px solid ${accent}`,
        bgcolor: overdue ? alpha(theme.palette.error.main, 0.04) : 'background.paper',
      }}
    >
      <Stack direction="row" alignItems="flex-start" spacing={1.5}>
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.78rem',
            fontWeight: 800,
            bgcolor: alpha(statusColor, 0.14),
            color: statusColor,
            flexShrink: 0,
            mt: 0.25,
          }}
        >
          {done ? <CheckCircleRounded sx={{ fontSize: '1.1rem' }} /> : step.seq}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {step.name}
            </Typography>
            <Chip
              label={meta.label}
              size="small"
              sx={{ bgcolor: alpha(statusColor, 0.16), color: statusColor, fontWeight: 700, height: 20 }}
            />
            {overdue && (
              <Chip
                icon={<WarningAmberRounded sx={{ fontSize: '0.85rem' }} />}
                label="Overdue"
                size="small"
                color="error"
                sx={{ fontWeight: 700, height: 20 }}
              />
            )}
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            <TextField
              select
              size="small"
              label="Owner"
              value={step.owner_email || ''}
              onChange={(e) => onAssignOwner(step.id, e.target.value || null)}
              disabled={!canEdit || busy}
              sx={{ minWidth: 180, flex: 1 }}
              InputProps={{ startAdornment: <PersonOutlineRounded sx={{ fontSize: '1.1rem', mr: 0.5, color: 'text.disabled' }} /> }}
            >
              <MenuItem value="">
                <em>Unassigned</em>
              </MenuItem>
              {owners.map((o) => (
                <MenuItem key={o.email} value={o.email}>
                  {o.full_name || o.email}
                </MenuItem>
              ))}
              {/* Preserve a previously-set owner not in the current roster. */}
              {step.owner_email && !owners.some((o) => o.email && o.email.toLowerCase() === String(step.owner_email).toLowerCase()) && (
                <MenuItem value={step.owner_email}>{step.owner_email}</MenuItem>
              )}
            </TextField>
            <TextField
              type="date"
              size="small"
              label="Due"
              value={step.due_date || ''}
              onChange={(e) => onSetDue(step.id, e.target.value || null)}
              disabled={!canEdit || busy}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 150 }}
              error={overdue}
            />
            <Button
              variant={done ? 'outlined' : 'contained'}
              color={done ? 'inherit' : 'success'}
              size="small"
              startIcon={done ? undefined : <CheckCircleRounded />}
              onClick={() => onComplete(step.id, !done)}
              disabled={!canEdit || busy}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 1.5, whiteSpace: 'nowrap' }}
            >
              {done ? 'Re-open' : 'Mark done'}
            </Button>
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            {step.owner_email ? `Owner: ${ownerLabel(owners, step.owner_email)}` : 'No owner assigned'}
            {step.completed_at ? ` · completed ${shortDate(String(step.completed_at).slice(0, 10))}` : ''}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

/** RIGHT pane — the full instance step chain + completion control. */
function InstanceDetail({ instance, workflowName, steps, loading, owners, canEdit, busyStepId, onAssignOwner, onSetDue, onComplete, onCompleteProcess, completingProcess }) {
  const progress = stepProgress(steps);
  const allDone = progress.total > 0 && progress.done === progress.total;
  const completed = instance?.status === 'completed';

  if (loading) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rounded" height={80} />
        {[1, 2, 3].map((n) => <Skeleton key={n} variant="rounded" height={110} />)}
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      {/* Instance header */}
      <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 2, sm: 2.5 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }} noWrap>
              {instance.title || instance.reference || 'Untitled process'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {workflowName || 'Workflow'}
              {instance.reference ? ` · ${instance.reference}` : ''}
            </Typography>
          </Box>
          <Chip
            label={completed ? 'Completed' : 'Open'}
            size="small"
            color={completed ? 'success' : 'info'}
            variant={completed ? 'filled' : 'outlined'}
            sx={{ fontWeight: 700, flexShrink: 0 }}
          />
        </Stack>
        <Box sx={{ mt: 1.5 }}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {progress.done}/{progress.total} steps done
              {progress.overdue > 0 ? ` · ${progress.overdue} overdue` : ''}
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>{progress.pct}%</Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={progress.pct}
            sx={{ height: 8, borderRadius: 4, '& .MuiLinearProgress-bar': { borderRadius: 4 } }}
            color={progress.overdue > 0 ? 'error' : allDone ? 'success' : 'primary'}
          />
        </Box>
      </Paper>

      {/* Step chain */}
      {steps.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 2.5, p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            This process has no steps.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1.25}>
          {steps.map((step) => (
            <StepRow
              key={step.id}
              step={step}
              owners={owners}
              canEdit={canEdit && !completed}
              busy={busyStepId === step.id}
              onAssignOwner={onAssignOwner}
              onSetDue={onSetDue}
              onComplete={onComplete}
            />
          ))}
        </Stack>
      )}

      {/* Completion control */}
      {!completed && allDone && canEdit && (
        <Button
          variant="contained"
          color="success"
          startIcon={<DoneAllRounded />}
          onClick={onCompleteProcess}
          disabled={completingProcess}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 1.5, alignSelf: 'flex-start' }}
        >
          {completingProcess ? 'Completing…' : 'Mark process completed'}
        </Button>
      )}
    </Stack>
  );
}

/** Dialog to start a new process from a template. */
function NewProcessDialog({ open, onClose, workflows, presetWorkflowId, onCreate, creating }) {
  const [workflowId, setWorkflowId] = useState('');
  const [reference, setReference] = useState('');
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (open) {
      setWorkflowId(presetWorkflowId || '');
      setReference('');
      setTitle('');
    }
  }, [open, presetWorkflowId]);

  const submit = () => {
    if (!workflowId) return;
    onCreate({ workflowId, reference: reference.trim() || null, title: title.trim() || null });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>Start a new process</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="Workflow template"
            value={workflowId}
            onChange={(e) => setWorkflowId(e.target.value)}
            fullWidth
          >
            {workflows.length === 0 ? (
              <MenuItem value="" disabled>No templates available</MenuItem>
            ) : (
              workflows.map((w) => (
                <MenuItem key={w.id} value={w.id}>
                  {w.name} ({Array.isArray(w.steps) ? w.steps.length : 0} steps)
                </MenuItem>
              ))
            )}
          </TextField>
          <TextField
            label="Reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. order #, complaint ref"
            fullWidth
          />
          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="A short name for this process"
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 600 }}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={!workflowId || creating}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 1.5 }}
        >
          {creating ? 'Starting…' : 'Start process'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function WorkflowsView({ canManage, notify }) {
  const [workflows, setWorkflows] = useState([]);
  const [instances, setInstances] = useState([]);
  const [instancesLoading, setInstancesLoading] = useState(true);
  const [owners, setOwners] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [steps, setSteps] = useState([]);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsByInstance, setStepsByInstance] = useState({}); // id → steps[] for left-pane progress
  const [busyStepId, setBusyStepId] = useState(null);
  const [completingProcess, setCompletingProcess] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [presetWorkflowId, setPresetWorkflowId] = useState('');
  const [creating, setCreating] = useState(false);

  const workflowName = useCallback(
    (workflowId) => workflows.find((w) => w.id === workflowId)?.name || 'Workflow',
    [workflows],
  );

  // Load templates + owners once.
  useEffect(() => {
    let active = true;
    listWorkflows().then((rows) => { if (active) setWorkflows(rows); });
    listOwners().then((rows) => { if (active) setOwners(rows); });
    return () => { active = false; };
  }, []);

  // Load open instances, then fetch each one's steps for left-pane progress.
  const reloadInstances = useCallback(() => {
    setInstancesLoading(true);
    return listInstances('open').then(async (rows) => {
      setInstances(rows);
      const map = {};
      await Promise.all(
        rows.map(async (inst) => {
          map[inst.id] = await listSteps(inst.id);
        }),
      );
      setStepsByInstance(map);
      setInstancesLoading(false);
      return rows;
    });
  }, []);

  useEffect(() => {
    reloadInstances();
  }, [reloadInstances]);

  // Load the selected instance's steps into the working copy.
  const loadSteps = useCallback((instanceId) => {
    if (!instanceId) { setSteps([]); return; }
    setStepsLoading(true);
    listSteps(instanceId).then((rows) => {
      setSteps(rows);
      setStepsByInstance((m) => ({ ...m, [instanceId]: rows }));
      setStepsLoading(false);
    });
  }, []);

  useEffect(() => {
    if (selectedId) loadSteps(selectedId);
    else setSteps([]);
  }, [selectedId, loadSteps]);

  const selectedInstance = useMemo(
    () => instances.find((i) => i.id === selectedId) || null,
    [instances, selectedId],
  );

  const handleAssignOwner = useCallback(async (stepId, ownerEmail) => {
    setBusyStepId(stepId);
    const res = await updateStep(stepId, { owner_email: ownerEmail });
    setBusyStepId(null);
    if (res.ok) loadSteps(selectedId);
    else notify('Could not assign owner.', 'error');
  }, [selectedId, loadSteps, notify]);

  const handleSetDue = useCallback(async (stepId, dueDate) => {
    setBusyStepId(stepId);
    const res = await updateStep(stepId, { due_date: dueDate });
    setBusyStepId(null);
    if (res.ok) loadSteps(selectedId);
    else notify('Could not set due date.', 'error');
  }, [selectedId, loadSteps, notify]);

  const handleComplete = useCallback(async (stepId, done) => {
    setBusyStepId(stepId);
    const res = await completeStep(stepId, done);
    setBusyStepId(null);
    if (res.ok) {
      notify(done ? 'Step marked done' : 'Step re-opened');
      loadSteps(selectedId);
    } else {
      notify('Could not update step.', 'error');
    }
  }, [selectedId, loadSteps, notify]);

  const handleCompleteProcess = useCallback(async () => {
    if (!selectedId) return;
    setCompletingProcess(true);
    const res = await setInstanceStatus(selectedId, 'completed');
    setCompletingProcess(false);
    if (res.ok) {
      notify('Process completed');
      setSelectedId(null);
      reloadInstances();
    } else {
      notify('Could not complete process.', 'error');
    }
  }, [selectedId, notify, reloadInstances]);

  const handleCreate = useCallback(async ({ workflowId, reference, title }) => {
    setCreating(true);
    const res = await createInstance({ workflowId, reference, title });
    setCreating(false);
    if (res.ok && res.row) {
      notify('Process started');
      setDialogOpen(false);
      await reloadInstances();
      setSelectedId(res.row.id);
    } else {
      notify(res.error || 'Could not start process.', 'error');
    }
  }, [notify, reloadInstances]);

  const openDialog = useCallback((workflowId) => {
    setPresetWorkflowId(workflowId || '');
    setDialogOpen(true);
  }, []);

  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 380px) minmax(0, 1fr)' }, alignItems: 'start' }}>
      {/* LEFT — instances + templates */}
      <Stack spacing={2} sx={{ minWidth: 0 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Active processes</Typography>
          {canManage && (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddRounded />}
              onClick={() => openDialog('')}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 1.5 }}
            >
              New process
            </Button>
          )}
        </Stack>

        <Stack spacing={1}>
          {instancesLoading ? (
            [1, 2, 3].map((n) => <Skeleton key={n} variant="rounded" height={92} />)
          ) : instances.length === 0 ? (
            <Paper variant="outlined" sx={{ borderRadius: 2.5, p: 3, textAlign: 'center' }}>
              <AccountTreeRounded sx={{ fontSize: 36, color: 'text.disabled', mb: 1 }} />
              <Typography variant="body2" color="text.secondary">
                No active processes — start one from a template.
              </Typography>
            </Paper>
          ) : (
            instances.map((inst) => (
              <InstanceCard
                key={inst.id}
                instance={inst}
                workflowName={workflowName(inst.workflow_id)}
                progress={stepProgress(stepsByInstance[inst.id])}
                selected={inst.id === selectedId}
                onSelect={(i) => setSelectedId(i.id)}
              />
            ))
          )}
        </Stack>

        {/* Templates affordance */}
        <Paper variant="outlined" sx={{ borderRadius: 2.5, p: 1.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary' }}>
            Templates
          </Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {workflows.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No workflow templates.</Typography>
            ) : (
              workflows.map((w) => (
                <Stack key={w.id} direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{w.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {Array.isArray(w.steps) ? w.steps.length : 0} steps
                    </Typography>
                  </Box>
                  {canManage && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<PlayArrowRounded />}
                      onClick={() => openDialog(w.id)}
                      sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 1.5, flexShrink: 0 }}
                    >
                      Start
                    </Button>
                  )}
                </Stack>
              ))
            )}
          </Stack>
        </Paper>
      </Stack>

      {/* RIGHT — selected instance step chain */}
      <Box sx={{ minWidth: 0 }}>
        {!selectedInstance ? (
          <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 4, sm: 8 }, textAlign: 'center' }}>
            <AccountTreeRounded sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
              Select a process
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Pick an active process to see its accountability chain — who owns each step and when it's due.
            </Typography>
          </Paper>
        ) : (
          <InstanceDetail
            instance={selectedInstance}
            workflowName={workflowName(selectedInstance.workflow_id)}
            steps={steps}
            loading={stepsLoading}
            owners={owners}
            canEdit={canManage}
            busyStepId={busyStepId}
            onAssignOwner={handleAssignOwner}
            onSetDue={handleSetDue}
            onComplete={handleComplete}
            onCompleteProcess={handleCompleteProcess}
            completingProcess={completingProcess}
          />
        )}
      </Box>

      <NewProcessDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        workflows={workflows}
        presetWorkflowId={presetWorkflowId}
        onCreate={handleCreate}
        creating={creating}
      />
    </Box>
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

  const [view, setView] = useState('weekly'); // 'weekly' | 'departments' | 'workflows'
  const [weekStart, setWeekStart] = useState(getCurrentWeekStart());
  const [departments, setDepartments] = useState([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(false);
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

  // Load department dashboard when on the Departments view (or week changes).
  useEffect(() => {
    if (view !== 'departments') return undefined;
    let active = true;
    setDepartmentsLoading(true);
    departmentDashboard(weekStart).then((data) => {
      if (!active) return;
      setDepartments(Array.isArray(data) ? data : []);
      setDepartmentsLoading(false);
    });
    return () => { active = false; };
  }, [view, weekStart]);

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
          <ToggleButtonGroup
            value={view}
            exclusive
            size="small"
            onChange={(_e, v) => { if (v) setView(v); }}
            aria-label="Performance view"
            sx={{ '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 700, px: 1.5 } }}
          >
            <ToggleButton value="weekly" aria-label="Weekly Review">
              Weekly Review
            </ToggleButton>
            <ToggleButton value="departments" aria-label="Departments">
              Departments
            </ToggleButton>
            <ToggleButton value="workflows" aria-label="Workflows">
              Workflows
            </ToggleButton>
          </ToggleButtonGroup>
          {view !== 'workflows' && (
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
          )}
          {view === 'weekly' && canManage && (
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

      {view === 'workflows' ? (
        <WorkflowsView canManage={canManage} notify={notify} />
      ) : view === 'departments' ? (
        <DepartmentsView departments={departments} loading={departmentsLoading} weekStart={weekStart} />
      ) : (
        <>
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
        </>
      )}

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
