import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Snackbar,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  ChevronLeftRounded,
  ChevronRightRounded,
  LockOutlined,
  CheckCircleOutline,
  HighlightOff,
  AutorenewRounded,
} from '@mui/icons-material';
import {
  getCurrentWeekStart,
  addWeeks,
  getRoster,
  getPersonScore,
} from '../../services/misService';

// EOS Level-10 agenda — purely visual section markers for the meeting ribbon.
const AGENDA = ['Segue', 'Scorecard', 'Goals', 'Headlines', 'To-Dos', 'IDS', 'Conclude'];
const ACTIVE_AGENDA = 'Scorecard';

/** Band ('GREEN'|'AMBER'|'RED') → MUI palette key. */
function bandColorKey(band) {
  if (band === 'GREEN') return 'success';
  if (band === 'AMBER') return 'warning';
  if (band === 'RED') return 'error';
  return 'primary';
}

/** Format an ISO week-start into a human label: 'Week of 15 Jun 2026'. */
function weekLabel(weekStart) {
  const [y, m, d] = String(weekStart).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return `Week of ${dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
}

/** Format an ISO date 'YYYY-MM-DD' compactly: '15 Jun'. Returns '—' when empty. */
function shortDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y) return String(iso);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function AgendaRibbon() {
  const theme = useTheme();
  return (
    <Paper
      variant="outlined"
      sx={{ borderRadius: 2.5, px: { xs: 1.5, sm: 2 }, py: 1.25, overflowX: 'auto' }}
    >
      <Stack
        direction="row"
        spacing={0}
        alignItems="center"
        sx={{ minWidth: 'max-content' }}
        divider={
          <Box sx={{ width: 18, height: 1, bgcolor: 'divider', mx: 1, flexShrink: 0 }} />
        }
      >
        {AGENDA.map((step, i) => {
          const active = step === ACTIVE_AGENDA;
          return (
            <Stack key={step} direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
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
                  bgcolor: active ? 'primary.main' : alpha(theme.palette.text.primary, 0.08),
                  color: active ? 'primary.contrastText' : 'text.secondary',
                }}
              >
                {i + 1}
              </Box>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: active ? 700 : 500,
                  color: active ? 'primary.main' : 'text.secondary',
                  letterSpacing: '0.02em',
                  whiteSpace: 'nowrap',
                }}
              >
                {step}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Paper>
  );
}

function BandChip({ band, size = 'small' }) {
  const colorKey = bandColorKey(band);
  return (
    <Chip
      label={band || '—'}
      size={size}
      color={colorKey}
      variant="filled"
      sx={{ fontWeight: 700, letterSpacing: '0.04em' }}
    />
  );
}

function RosterRow({ person, selected, onSelect }) {
  const theme = useTheme();
  const colorKey = bandColorKey(person.band);
  const accent = theme.palette[colorKey]?.main || theme.palette.primary.main;
  return (
    <Paper
      variant="outlined"
      onClick={() => onSelect(person)}
      sx={{
        borderRadius: 2,
        p: 1.5,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        borderColor: selected ? accent : 'divider',
        bgcolor: selected ? alpha(accent, 0.06) : 'background.paper',
        transition: 'border-color 0.18s ease, background-color 0.18s ease',
        '&:hover': { borderColor: alpha(accent, 0.5) },
      }}
    >
      <Box
        sx={{
          width: 4,
          alignSelf: 'stretch',
          borderRadius: 2,
          bgcolor: accent,
          flexShrink: 0,
        }}
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
          {person.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
          {person.employee_code || person.email}
        </Typography>
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
        <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1, color: accent }}>
          {person.final_score ?? '—'}
        </Typography>
        <Box sx={{ mt: 0.5 }}>
          <BandChip band={person.band} />
        </Box>
      </Box>
    </Paper>
  );
}

function PillarBar({ label, score, weight, sub }) {
  const theme = useTheme();
  const hasScore = score !== null && score !== undefined;
  const value = hasScore ? Math.max(0, Math.min(100, Number(score))) : 0;
  // Color the bar by score band.
  const colorKey = !hasScore ? 'primary' : value >= 80 ? 'success' : value >= 60 ? 'warning' : 'error';
  const accent = theme.palette[colorKey]?.main || theme.palette.primary.main;
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 1.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.75 }}>
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary' }}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary">{`weight ${weight}%`}</Typography>
      </Stack>
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <LinearProgress
            variant="determinate"
            value={value}
            sx={{
              height: 8,
              borderRadius: 4,
              bgcolor: alpha(accent, 0.14),
              '& .MuiLinearProgress-bar': { borderRadius: 4, bgcolor: accent },
            }}
          />
        </Box>
        <Typography variant="h6" sx={{ fontWeight: 800, minWidth: 44, textAlign: 'right', color: hasScore ? 'text.primary' : 'text.disabled' }}>
          {hasScore ? value : '—'}
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

function WorkList({ title, icon, items, colorKey, count }) {
  const theme = useTheme();
  const accent = theme.palette[colorKey]?.main || theme.palette.primary.main;
  const list = Array.isArray(items) ? items : [];
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 1.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Box sx={{ color: accent, display: 'flex' }}>{icon}</Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }}>{title}</Typography>
        <Chip label={count ?? list.length} size="small" sx={{ bgcolor: alpha(accent, 0.14), color: accent, fontWeight: 700 }} />
      </Stack>
      <Divider sx={{ mb: 1 }} />
      {list.length === 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ py: 1 }}>None this week.</Typography>
      ) : (
        <Stack spacing={1} sx={{ overflowY: 'auto' }}>
          {list.map((it) => (
            <Box
              key={it.id}
              sx={{ borderLeft: `3px solid ${accent}`, bgcolor: alpha(accent, 0.05), borderRadius: 1, px: 1, py: 0.75 }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{it.title}</Typography>
              {it.original_due_date && it.original_due_date !== it.due_date ? (
                <Typography variant="caption" color="text.secondary">
                  {`${shortDate(it.original_due_date)} → ${shortDate(it.due_date)}`}
                </Typography>
              ) : (
                <Typography variant="caption" color="text.secondary">{`due ${shortDate(it.due_date)}`}</Typography>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

function ScorecardSkeleton() {
  return (
    <Stack spacing={2}>
      <Skeleton variant="rounded" height={120} />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' } }}>
        {[1, 2, 3].map((n) => <Skeleton key={n} variant="rounded" height={90} />)}
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' } }}>
        {[1, 2, 3].map((n) => <Skeleton key={n} variant="rounded" height={160} />)}
      </Box>
    </Stack>
  );
}

function PersonScorecard({ score, loading, locked, onLock }) {
  const theme = useTheme();
  if (loading) return <ScorecardSkeleton />;
  if (!score) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: 2.5, p: 4, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Couldn’t load this person’s scorecard for the selected week.
        </Typography>
      </Paper>
    );
  }

  const colorKey = bandColorKey(score.band);
  const accent = theme.palette[colorKey]?.main || theme.palette.primary.main;
  const counts = score.counts || {};
  const pillars = score.pillars || {};
  const tasks = pillars.tasks || {};
  const checklist = pillars.checklist || {};
  const reschedule = pillars.reschedule || {};

  return (
    <Stack spacing={2}>
      {/* Headline score + say/do + lock */}
      <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 2, sm: 2.5 } }}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'auto 1fr auto' }, alignItems: 'center' }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Box
              sx={{
                width: 84,
                height: 84,
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
              <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1, color: accent }}>
                {score.final_score ?? '—'}
              </Typography>
              <Typography variant="caption" color="text.secondary">/ 100</Typography>
            </Box>
            <Box>
              <BandChip band={score.band} size="medium" />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                {weekLabel(score.week_start)}
              </Typography>
            </Box>
          </Stack>

          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary' }}>
              Say / Do
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: 'text.primary', lineHeight: 1.1 }}>
              {`${score.say_do ?? 0}%`}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {`${counts.done ?? 0} done · ${counts.late ?? 0} late · ${counts.not_done ?? 0} missed`}
            </Typography>
          </Box>

          <Box sx={{ justifySelf: { xs: 'start', sm: 'end' } }}>
            <Button
              variant={locked ? 'outlined' : 'contained'}
              color={locked ? 'success' : 'primary'}
              startIcon={<LockOutlined />}
              onClick={onLock}
              disabled={locked}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 1.5 }}
            >
              {locked ? 'Week locked' : 'Review & Lock week'}
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* Pillars */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' } }}>
        <PillarBar label="Tasks" score={tasks.score} weight={tasks.weight ?? 50} />
        <PillarBar label="Checklist" score={checklist.score} weight={checklist.weight ?? 30} />
        <PillarBar
          label="Reschedule"
          score={reschedule.score}
          weight={reschedule.weight ?? 20}
          sub={`slips: ${reschedule.slips ?? 0}, penalty: -${reschedule.penalty ?? 0}`}
        />
      </Box>

      {/* Work lists */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' } }}>
        <WorkList title="Work Done" icon={<CheckCircleOutline fontSize="small" />} items={score.work_done} colorKey="success" count={counts.done} />
        <WorkList title="Work Not Done" icon={<HighlightOff fontSize="small" />} items={score.work_not_done} colorKey="error" count={counts.not_done} />
        <WorkList title="Rescheduled" icon={<AutorenewRounded fontSize="small" />} items={score.rescheduled} colorKey="warning" count={counts.rescheduled} />
      </Box>
    </Stack>
  );
}

export default function MISExecutiveMeeting() {
  const [weekStart, setWeekStart] = useState(getCurrentWeekStart());
  const [roster, setRoster] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [score, setScore] = useState(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [lockedWeeks, setLockedWeeks] = useState({}); // { 'YYYY-MM-DD|email': true }
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });

  // Load roster whenever the week changes.
  useEffect(() => {
    let active = true;
    setRosterLoading(true);
    getRoster(weekStart).then((rows) => {
      if (!active) return;
      setRoster(rows);
      // Keep selection if the person is still in the roster, else clear.
      setSelectedEmail((prev) => (prev && rows.some((r) => r.email === prev) ? prev : null));
      setRosterLoading(false);
    });
    return () => { active = false; };
  }, [weekStart]);

  // Load the selected person's scorecard.
  useEffect(() => {
    if (!selectedEmail) { setScore(null); return; }
    let active = true;
    setScoreLoading(true);
    getPersonScore(selectedEmail, weekStart).then((data) => {
      if (!active) return;
      setScore(data);
      setScoreLoading(false);
    });
    return () => { active = false; };
  }, [selectedEmail, weekStart]);

  const stats = useMemo(() => {
    if (!roster.length) return { avg: 0, green: 0, amber: 0, red: 0 };
    const sum = roster.reduce((a, r) => a + (Number(r.final_score) || 0), 0);
    return {
      avg: Math.round(sum / roster.length),
      green: roster.filter((r) => r.band === 'GREEN').length,
      amber: roster.filter((r) => r.band === 'AMBER').length,
      red: roster.filter((r) => r.band === 'RED').length,
    };
  }, [roster]);

  const goWeek = useCallback((n) => setWeekStart((w) => addWeeks(w, n)), []);

  const lockKey = selectedEmail ? `${weekStart}|${selectedEmail}` : null;
  const isLocked = lockKey ? Boolean(lockedWeeks[lockKey]) : false;

  // STUB: real lock RPC pending — this only toggles local lock state + confirms.
  const handleLock = () => {
    if (!lockKey) return;
    setLockedWeeks((prev) => ({ ...prev, [lockKey]: true }));
    setSnackbar({ open: true, message: 'Week locked' });
  };

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto', width: '100%' }}>
      {/* Page header + week selector */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
            EM Executive Meeting
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Weekly accountability — MIS
          </Typography>
        </Box>
        <Paper variant="outlined" sx={{ borderRadius: 2, px: 1, py: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title="Previous week">
            <IconButton size="small" onClick={() => goWeek(-1)} aria-label="Previous week">
              <ChevronLeftRounded />
            </IconButton>
          </Tooltip>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, minWidth: 168, textAlign: 'center' }}>
            {weekLabel(weekStart)}
          </Typography>
          <Tooltip title="Next week">
            <IconButton size="small" onClick={() => goWeek(1)} aria-label="Next week">
              <ChevronRightRounded />
            </IconButton>
          </Tooltip>
        </Paper>
      </Stack>

      <Box sx={{ mb: 2 }}>
        <AgendaRibbon />
      </Box>

      {/* Main two-column layout */}
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
              <Stack direction="row" spacing={1}>
                <Chip label={`${stats.green} green`} size="small" color="success" variant="outlined" sx={{ fontWeight: 600 }} />
                <Chip label={`${stats.amber} amber`} size="small" color="warning" variant="outlined" sx={{ fontWeight: 600 }} />
                <Chip label={`${stats.red} red`} size="small" color="error" variant="outlined" sx={{ fontWeight: 600 }} />
              </Stack>
            </Stack>
          </Paper>

          <Stack spacing={1}>
            {rosterLoading ? (
              [1, 2, 3, 4, 5].map((n) => <Skeleton key={n} variant="rounded" height={72} />)
            ) : roster.length === 0 ? (
              <Alert severity="info" variant="outlined">No roster for {weekLabel(weekStart)}.</Alert>
            ) : (
              roster.map((p) => (
                <RosterRow
                  key={p.employee_id || p.email}
                  person={p}
                  selected={p.email === selectedEmail}
                  onSelect={(person) => setSelectedEmail(person.email)}
                />
              ))
            )}
          </Stack>
        </Stack>

        {/* RIGHT — selected scorecard */}
        <Box sx={{ minWidth: 0 }}>
          {!selectedEmail && !scoreLoading ? (
            <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 4, sm: 8 }, textAlign: 'center' }}>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                Select a team member
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Pick someone from the roster to review their weekly scorecard.
              </Typography>
            </Paper>
          ) : (
            <PersonScorecard score={score} loading={scoreLoading} locked={isLocked} onLock={handleLock} />
          )}
        </Box>
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setSnackbar((s) => ({ ...s, open: false }))} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
