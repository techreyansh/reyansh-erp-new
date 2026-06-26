import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Skeleton,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import {
  AssignmentTurnedInOutlined,
  CheckCircleOutline,
  ChecklistOutlined,
  EmojiEventsOutlined,
  EventRepeatOutlined,
  FiberManualRecord,
  PlayCircleOutline,
  TaskAltOutlined,
} from "@mui/icons-material";
import { supabase } from "../../lib/supabaseClient";
import { getCurrentWeekStart, personScore as getPersonPerfScore } from "../../services/perfService";
import {
  isTaskOverdue,
  listMyTasks,
  rescheduleMyTask,
  updateMyTaskStatus,
} from "../../services/taskService";
import taskComplianceService from "../../services/taskComplianceService";
import { Panel } from "../common/kit";

// ---------------------------------------------------------------------------
// Date helpers (local, no timezone shift)
// ---------------------------------------------------------------------------
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function toDateInput(dateValue) {
  if (!dateValue) return "";
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

/** "3 days ago" / "Today" / "in 2 days". */
function relativeDay(dateValue) {
  if (!dateValue) return "No due date";
  const today = startOfDay(new Date());
  const target = startOfDay(dateValue);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  if (diff < 0) return `${Math.abs(diff)} days ago`;
  return `in ${diff} days`;
}

function isSameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

const isDone = (t) => String(t?.task_status || "").toLowerCase() === "completed";

const PRIORITY_COLORS = {
  high: "error",
  medium: "warning",
  low: "info",
};

// Performance Review band model — mirrors PerformanceReview.js.
// outstanding & rising_star → GREEN, consistent → AMBER, needs_attention → RED,
// no_data → GREY.
const PERF_BANDS = {
  outstanding: { label: "Outstanding Achiever", paletteKey: "success" },
  rising_star: { label: "Rising Star", paletteKey: "success" },
  consistent: { label: "Consistent Contributor", paletteKey: "warning" },
  needs_attention: { label: "Needs Attention", paletteKey: "error" },
  no_data: { label: "No data yet", paletteKey: "grey" },
};

function perfBandMeta(band) {
  return PERF_BANDS[band] || PERF_BANDS.no_data;
}

// Performance categories — 100% auto-calculated from ERP work. Manager + Meeting
// scoring removed (the score no longer depends on subjective manual entry).
const PERF_CATEGORIES = [
  { key: "work_completed", label: "Work Completed" },
  { key: "on_time", label: "On Time" },
  { key: "checklist", label: "Checklist" },
  { key: "workflow", label: "Workflow" },
  { key: "production", label: "Production" },
];

// ---------------------------------------------------------------------------
// Task categorization: overdue / today / upcoming (next 7d)
// ---------------------------------------------------------------------------
function categorizeTasks(tasks) {
  const today = new Date();
  const overdue = [];
  const dueToday = [];
  const upcoming = [];
  for (const t of tasks || []) {
    if (isDone(t)) continue;
    if (isTaskOverdue(t)) {
      overdue.push(t);
      continue;
    }
    if (t.due_date && isSameDay(new Date(t.due_date), today)) {
      dueToday.push(t);
      continue;
    }
    if (t.due_date) {
      const diff = Math.round((startOfDay(t.due_date) - startOfDay(today)) / 86400000);
      if (diff > 0 && diff <= 7) upcoming.push(t);
    }
  }
  const byDue = (a, b) => new Date(a.due_date || 0) - new Date(b.due_date || 0);
  return {
    overdue: overdue.sort(byDue),
    today: dueToday.sort(byDue),
    upcoming: upcoming.sort(byDue),
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function PillarBar({ label, value }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          {v}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={v}
        sx={{ height: 6, borderRadius: 3 }}
      />
    </Box>
  );
}

function ScoreCard({ score, loading, theme, onOpen }) {
  if (loading) {
    return (
      <Card variant="outlined" sx={{ borderRadius: 2.5, height: "100%" }}>
        <CardContent>
          <Skeleton variant="text" width={120} />
          <Skeleton variant="text" width={80} height={56} />
          <Skeleton variant="rounded" height={48} sx={{ mt: 1 }} />
        </CardContent>
      </Card>
    );
  }

  const band = score?.band || "no_data";
  const meta = perfBandMeta(band);
  const hasData = band !== "no_data" && score?.score != null;
  const bandColor =
    meta.paletteKey === "grey"
      ? theme.palette.text.disabled
      : theme.palette[meta.paletteKey]?.main || theme.palette.text.disabled;
  const categories = score?.categories || {};

  return (
    <Card
      variant="outlined"
      onClick={onOpen}
      sx={{
        borderRadius: 2.5,
        height: "100%",
        cursor: onOpen ? "pointer" : "default",
        transition: "border-color 0.2s ease, box-shadow 0.2s ease",
        "&:hover": onOpen
          ? { borderColor: alpha(bandColor, 0.5), boxShadow: `0 8px 20px -12px ${alpha(bandColor, 0.6)}` }
          : undefined,
      }}
    >
      <CardContent sx={{ py: 2, "&:last-child": { pb: 2 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            My Performance Score
          </Typography>
          <Box sx={{ p: 0.75, borderRadius: 2, bgcolor: alpha(bandColor, 0.12), color: bandColor, display: "flex" }}>
            <EmojiEventsOutlined fontSize="small" />
          </Box>
        </Stack>

        <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mt: 0.5 }}>
          <Typography variant="h3" sx={{ fontWeight: 800, lineHeight: 1, letterSpacing: "-0.03em", color: bandColor }}>
            {hasData ? Math.round(Number(score.score)) : "—"}
          </Typography>
          {hasData && <Typography variant="body2" color="text.secondary">/ 100</Typography>}
          <Chip
            label={meta.label}
            size="small"
            sx={{
              height: 20,
              fontWeight: 700,
              fontSize: "0.65rem",
              bgcolor: alpha(bandColor, 0.14),
              color: bandColor,
              border: `1px solid ${alpha(bandColor, 0.4)}`,
            }}
          />
        </Stack>

        {hasData ? (
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            {PERF_CATEGORIES.map((c) => (
              <PillarBar key={c.key} label={c.label} value={categories?.[c.key]?.pct} />
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            No data yet for this week.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryCard({ label, icon: Icon, accent, loading, segments, onOpen }) {
  return (
    <Card
      variant="outlined"
      onClick={onOpen}
      sx={{
        borderRadius: 2.5,
        height: "100%",
        cursor: onOpen ? "pointer" : "default",
        transition: "border-color 0.2s ease, box-shadow 0.2s ease",
        "&:hover": onOpen
          ? { borderColor: alpha(accent, 0.5), boxShadow: `0 8px 20px -12px ${alpha(accent, 0.6)}` }
          : undefined,
      }}
    >
      <CardContent sx={{ py: 2, "&:last-child": { pb: 2 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            {label}
          </Typography>
          <Box sx={{ p: 0.75, borderRadius: 2, bgcolor: alpha(accent, 0.12), color: accent, display: "flex" }}>
            <Icon fontSize="small" />
          </Box>
        </Stack>
        {loading ? (
          <Skeleton variant="rounded" height={56} sx={{ mt: 1 }} />
        ) : (
          <Stack direction="row" spacing={2} sx={{ mt: 1.5 }} divider={<Divider orientation="vertical" flexItem />}>
            {segments.map((s) => (
              <Box key={s.label} sx={{ minWidth: 0 }}>
                <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1, color: s.value > 0 ? s.color : "text.primary" }}>
                  {s.value}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                  {s.label}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function TaskRow({ task, accent, busy, onDone, onStart, onReschedule, theme }) {
  const priority = String(task.priority || "").toLowerCase();
  const priorityColor = PRIORITY_COLORS[priority];
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 1,
        px: 1.25,
        py: 0.9,
        borderRadius: 1.5,
        transition: "background-color 0.15s ease",
        "&:hover": { bgcolor: alpha(accent, 0.08) },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0 }} noWrap>
          {task.title}
        </Typography>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25, flexWrap: "wrap" }}>
          <Typography variant="caption" sx={{ color: accent, fontWeight: 700 }}>
            {relativeDay(task.due_date)}
          </Typography>
          {priority && (
            <Chip
              label={priority}
              size="small"
              color={priorityColor || "default"}
              variant="outlined"
              sx={{ height: 18, fontSize: "0.62rem", fontWeight: 700, textTransform: "capitalize" }}
            />
          )}
          {task.difficulty != null && (
            <Chip
              label={`D${task.difficulty}`}
              size="small"
              sx={{ height: 18, fontSize: "0.62rem", fontWeight: 700, color: "text.secondary", bgcolor: "action.hover" }}
            />
          )}
        </Stack>
      </Box>

      <Stack direction="row" spacing={0.25} alignItems="center" sx={{ flexShrink: 0 }}>
        {busy ? (
          <CircularProgress size={18} sx={{ mx: 1, color: accent }} />
        ) : (
          <>
            <Tooltip title="Mark done">
              <IconButton
                size="small"
                aria-label="Mark task done"
                onClick={() => onDone(task)}
                sx={{ color: "success.main", "&:hover": { bgcolor: alpha(theme.palette.success.main, 0.12) } }}
              >
                <CheckCircleOutline fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Start (in progress)">
              <IconButton
                size="small"
                aria-label="Start task"
                onClick={() => onStart(task)}
                sx={{ color: "info.main", "&:hover": { bgcolor: alpha(theme.palette.info.main, 0.12) } }}
              >
                <PlayCircleOutline fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Reschedule">
              <IconButton
                size="small"
                aria-label="Reschedule task"
                onClick={() => onReschedule(task)}
                sx={{ color: "warning.main", "&:hover": { bgcolor: alpha(theme.palette.warning.main, 0.12) } }}
              >
                <EventRepeatOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Stack>
    </Box>
  );
}

function TaskGroup({ emoji, title, items, accent, busyId, onDone, onStart, onReschedule, theme }) {
  if (!items.length) return null;
  return (
    <Box>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5, px: 1.25 }}>
        <Box component="span" sx={{ fontSize: "0.9rem", lineHeight: 1 }}>{emoji}</Box>
        <Typography variant="caption" sx={{ fontWeight: 700, color: accent, letterSpacing: "0.02em" }}>
          {title}
        </Typography>
        <Chip label={items.length} size="small" sx={{ height: 18, minWidth: 18, fontSize: "0.62rem", fontWeight: 700, color: accent, bgcolor: alpha(accent, 0.12) }} />
      </Stack>
      <Stack spacing={0.25}>
        {items.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            accent={accent}
            busy={busyId === t.id}
            onDone={onDone}
            onStart={onStart}
            onReschedule={onReschedule}
            theme={theme}
          />
        ))}
      </Stack>
    </Box>
  );
}

function ChecklistRow({ instance, accent, busy, onDone, theme }) {
  const name = instance.task_templates?.task_name || "Checklist task";
  const freq = instance.task_templates?.task_type;
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 1,
        px: 1.25,
        py: 0.9,
        borderRadius: 1.5,
        transition: "background-color 0.15s ease",
        "&:hover": { bgcolor: alpha(accent, 0.08) },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{name}</Typography>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25, flexWrap: "wrap" }}>
          <Typography variant="caption" sx={{ color: accent, fontWeight: 700 }}>
            {relativeDay(instance.due_date)}
          </Typography>
          {freq && (
            <Chip label={freq} size="small" sx={{ height: 18, fontSize: "0.62rem", fontWeight: 700, textTransform: "capitalize", color: "text.secondary", bgcolor: "action.hover" }} />
          )}
          {instance.status === "submitted" && (
            <Chip label="submitted" size="small" color="info" variant="outlined" sx={{ height: 18, fontSize: "0.62rem", fontWeight: 700 }} />
          )}
        </Stack>
      </Box>
      <Stack direction="row" alignItems="center" sx={{ flexShrink: 0 }}>
        {busy ? (
          <CircularProgress size={18} sx={{ mx: 1, color: accent }} />
        ) : instance.status === "pending" ? (
          <Tooltip title="Mark done">
            <IconButton
              size="small"
              aria-label="Mark checklist done"
              onClick={() => onDone(instance)}
              sx={{ color: "success.main", "&:hover": { bgcolor: alpha(theme.palette.success.main, 0.12) } }}
            >
              <TaskAltOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : (
          <Chip label="Awaiting approval" size="small" sx={{ height: 20, fontSize: "0.6rem", fontWeight: 600, color: "text.secondary", bgcolor: "action.hover" }} />
        )}
      </Stack>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
function MyDayDashboard({ email }) {
  const theme = useTheme();
  const navigate = useNavigate();

  const [score, setScore] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [checklists, setChecklists] = useState({ today: [], overdue: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);

  const [busyId, setBusyId] = useState(null);
  const [snack, setSnack] = useState(null); // { severity, message }
  const [reschedule, setReschedule] = useState(null); // { task, value, reason }

  const debounceRef = useRef(null);
  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    if (!email) {
      setLoading(false);
      return;
    }
    try {
      const [scoreRes, taskRes, checklistRes] = await Promise.all([
        getPersonPerfScore(email, getCurrentWeekStart()),
        listMyTasks(email),
        taskComplianceService.getMyChecklistsToday(email),
      ]);
      if (!mountedRef.current) return;
      setScore(scoreRes);
      setTasks(Array.isArray(taskRes) ? taskRes : []);
      setChecklists(checklistRes || { today: [], overdue: [], total: 0 });
    } catch (e) {
      // Degrade silently — individual services already log; widget stays usable.
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [email]);

  // Debounced refetch — used by realtime + poll so a burst of events
  // collapses into a single round-trip.
  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchAll();
    }, 600);
  }, [fetchAll]);

  // Initial load.
  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    fetchAll();
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchAll]);

  // Realtime subscriptions + 60s fallback poll.
  useEffect(() => {
    if (!email) return undefined;

    const handler = () => scheduleRefetch();
    const channel = supabase
      .channel(`my-day-${email}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, handler)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_instances" }, handler)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_pipeline" }, handler)
      .subscribe((status) => {
        if (mountedRef.current) setLive(status === "SUBSCRIBED");
      });

    const poll = setInterval(() => {
      fetchAll();
    }, 60000);

    return () => {
      clearInterval(poll);
      setLive(false);
      supabase.removeChannel(channel);
    };
  }, [email, scheduleRefetch, fetchAll]);

  // Run a task action, then refetch + toast.
  const runTaskAction = useCallback(
    async (task, fn, successMessage) => {
      setBusyId(task.id);
      try {
        await fn();
        await fetchAll();
        setSnack({ severity: "success", message: successMessage });
      } catch (e) {
        setSnack({ severity: "error", message: e?.message || "Action failed. Please try again." });
      } finally {
        if (mountedRef.current) setBusyId(null);
      }
    },
    [fetchAll],
  );

  const handleDone = useCallback(
    (task) => runTaskAction(task, () => updateMyTaskStatus(task.id, "completed", email), "Task completed."),
    [runTaskAction, email],
  );
  const handleStart = useCallback(
    (task) => runTaskAction(task, () => updateMyTaskStatus(task.id, "in_progress", email), "Task started."),
    [runTaskAction, email],
  );
  const openReschedule = useCallback((task) => {
    setReschedule({ task, value: toDateInput(task.due_date), reason: "" });
  }, []);
  const confirmReschedule = useCallback(async () => {
    if (!reschedule?.value || !reschedule?.reason?.trim()) return;
    const { task, value, reason } = reschedule;
    setReschedule(null);
    await runTaskAction(task, () => rescheduleMyTask(task, value, reason), "Task rescheduled.");
  }, [reschedule, runTaskAction]);

  // Checklist "Mark done" → submit_task_instance via the existing service.
  const handleChecklistDone = useCallback(
    async (instance) => {
      setBusyId(`cl-${instance.id}`);
      try {
        await taskComplianceService.submitTask(instance.id, { submissionNotes: "Marked done from My Day" });
        await fetchAll();
        setSnack({ severity: "success", message: "Checklist submitted." });
      } catch (e) {
        setSnack({ severity: "error", message: e?.message || "Could not submit checklist." });
      } finally {
        if (mountedRef.current) setBusyId(null);
      }
    },
    [fetchAll],
  );

  const grouped = useMemo(() => categorizeTasks(tasks), [tasks]);
  const taskCounts = {
    overdue: grouped.overdue.length,
    today: grouped.today.length,
    upcoming: grouped.upcoming.length,
  };
  const totalTasks = taskCounts.overdue + taskCounts.today + taskCounts.upcoming;
  const totalChecklists = checklists.today.length + checklists.overdue.length;

  const accents = {
    overdue: theme.palette.error.main,
    today: theme.palette.warning.main,
    upcoming: theme.palette.info.main,
  };

  return (
    <Box>
      {/* Header with Live indicator */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: "-0.02em" }}>
          My Day
        </Typography>
        <Tooltip title={live ? "Live — updates in real time" : "Reconnecting…"}>
          <Chip
            size="small"
            icon={<FiberManualRecord sx={{ fontSize: "0.7rem !important", color: live ? `${theme.palette.success.main} !important` : `${theme.palette.text.disabled} !important` }} />}
            label={live ? "Live" : "Offline"}
            sx={{
              height: 24,
              fontWeight: 700,
              fontSize: "0.7rem",
              color: live ? "success.main" : "text.secondary",
              bgcolor: alpha(live ? theme.palette.success.main : theme.palette.text.disabled, 0.12),
            }}
          />
        </Tooltip>
      </Stack>

      {/* Top row: 3 summary cards */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(3, minmax(0, 1fr))" },
          gap: 2,
          mb: 2,
        }}
      >
        <ScoreCard score={score} loading={loading} theme={theme} onOpen={() => navigate("/performance")} />
        <SummaryCard
          label="My Tasks"
          icon={AssignmentTurnedInOutlined}
          accent={theme.palette.primary.main}
          loading={loading}
          onOpen={() => navigate("/my-tasks")}
          segments={[
            { label: "Overdue", value: taskCounts.overdue, color: accents.overdue },
            { label: "Today", value: taskCounts.today, color: accents.today },
            { label: "Upcoming", value: taskCounts.upcoming, color: accents.upcoming },
          ]}
        />
        <SummaryCard
          label="My Checklists"
          icon={ChecklistOutlined}
          accent={theme.palette.secondary?.main || theme.palette.primary.main}
          loading={loading}
          onOpen={() => navigate("/task-checklist")}
          segments={[
            { label: "Due today", value: checklists.today.length, color: accents.today },
            { label: "Overdue", value: checklists.overdue.length, color: accents.overdue },
          ]}
        />
      </Box>

      {/* Lists row */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1.4fr) minmax(0, 1fr)" },
          gap: 2,
        }}
      >
        {/* My Tasks */}
        <Panel
          title="My Tasks"
          subtitle="Overdue, today & the next 7 days"
          height="auto"
          action={
            <Typography
              variant="caption"
              onClick={() => navigate("/my-tasks")}
              sx={{ color: "primary.main", fontWeight: 700, cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
            >
              View all
            </Typography>
          }
        >
          {loading ? (
            <Stack spacing={1} sx={{ px: 1.25 }}>
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={40} />)}
            </Stack>
          ) : totalTasks === 0 ? (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 4, px: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
                Nothing due — you're clear. 🎉
              </Typography>
            </Box>
          ) : (
            <Stack spacing={1.5}>
              <TaskGroup emoji="🔴" title="Overdue" items={grouped.overdue} accent={accents.overdue} busyId={busyId} onDone={handleDone} onStart={handleStart} onReschedule={openReschedule} theme={theme} />
              <TaskGroup emoji="🟡" title="Today" items={grouped.today} accent={accents.today} busyId={busyId} onDone={handleDone} onStart={handleStart} onReschedule={openReschedule} theme={theme} />
              <TaskGroup emoji="🔵" title="Upcoming (next 7 days)" items={grouped.upcoming} accent={accents.upcoming} busyId={busyId} onDone={handleDone} onStart={handleStart} onReschedule={openReschedule} theme={theme} />
            </Stack>
          )}
        </Panel>

        {/* My Checklists Today */}
        <Panel
          title="My Checklists Today"
          subtitle="Due & overdue compliance tasks"
          height="auto"
          action={
            <Typography
              variant="caption"
              onClick={() => navigate("/task-checklist")}
              sx={{ color: "primary.main", fontWeight: 700, cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
            >
              Open
            </Typography>
          }
        >
          {loading ? (
            <Stack spacing={1} sx={{ px: 1.25 }}>
              {[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={40} />)}
            </Stack>
          ) : totalChecklists === 0 ? (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 4, px: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
                No checklists due — you're clear. ✅
              </Typography>
            </Box>
          ) : (
            <Stack spacing={1.5}>
              {checklists.overdue.length > 0 && (
                <Box>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5, px: 1.25 }}>
                    <Box component="span" sx={{ fontSize: "0.9rem", lineHeight: 1 }}>🔴</Box>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: accents.overdue }}>Overdue</Typography>
                    <Chip label={checklists.overdue.length} size="small" sx={{ height: 18, minWidth: 18, fontSize: "0.62rem", fontWeight: 700, color: accents.overdue, bgcolor: alpha(accents.overdue, 0.12) }} />
                  </Stack>
                  <Stack spacing={0.25}>
                    {checklists.overdue.map((c) => (
                      <ChecklistRow key={c.id} instance={c} accent={accents.overdue} busy={busyId === `cl-${c.id}`} onDone={handleChecklistDone} theme={theme} />
                    ))}
                  </Stack>
                </Box>
              )}
              {checklists.today.length > 0 && (
                <Box>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5, px: 1.25 }}>
                    <Box component="span" sx={{ fontSize: "0.9rem", lineHeight: 1 }}>🟡</Box>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: accents.today }}>Due today</Typography>
                    <Chip label={checklists.today.length} size="small" sx={{ height: 18, minWidth: 18, fontSize: "0.62rem", fontWeight: 700, color: accents.today, bgcolor: alpha(accents.today, 0.12) }} />
                  </Stack>
                  <Stack spacing={0.25}>
                    {checklists.today.map((c) => (
                      <ChecklistRow key={c.id} instance={c} accent={accents.today} busy={busyId === `cl-${c.id}`} onDone={handleChecklistDone} theme={theme} />
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          )}
        </Panel>
      </Box>

      {/* Reschedule dialog */}
      <Dialog open={!!reschedule} onClose={() => setReschedule(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Reschedule task</DialogTitle>
        <DialogContent>
          {reschedule && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {reschedule.task.title}
            </Typography>
          )}
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              type="date"
              label="New due date"
              value={reschedule?.value || ""}
              onChange={(e) => setReschedule((r) => (r ? { ...r, value: e.target.value } : r))}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
              autoFocus
            />
            <TextField
              label="Reason (required)"
              value={reschedule?.reason || ""}
              onChange={(e) => setReschedule((r) => (r ? { ...r, reason: e.target.value } : r))}
              fullWidth
              size="small"
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setReschedule(null)} color="inherit">Cancel</Button>
          <Button
            onClick={confirmReschedule}
            variant="contained"
            disabled={!reschedule?.value || !reschedule?.reason?.trim()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Outcome toast */}
      <Snackbar
        open={!!snack}
        autoHideDuration={3000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {snack ? (
          <Alert onClose={() => setSnack(null)} severity={snack.severity} variant="filled" sx={{ width: "100%" }}>
            {snack.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}

export default MyDayDashboard;
