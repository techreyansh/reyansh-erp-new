// Production Calendar (Cable Production Planning — Phase 2).
// Week / Month views of the saved Machine Schedules, grouped by day, coloured by
// stage, filterable by machine. Built on cablePlanner.calendarBuckets (pure).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Paper, Stack, Typography, Button, Chip, CircularProgress, ToggleButton,
  ToggleButtonGroup, MenuItem, TextField, Tooltip, useTheme, alpha,
} from "@mui/material";
import {
  RefreshRounded, ChevronLeftRounded, ChevronRightRounded, TodayRounded,
} from "@mui/icons-material";
import { calendarBuckets, STAGE_LABEL } from "../../services/cablePlanner";
import { loadEngineMachines, loadSavedSchedule } from "../../services/cableProductionService";

const STAGE_COLOR = { bunching: "#6366f1", core: "#0ea5e9", laying: "#f59e0b", sheathing: "#10b981", cutting: "#a855f7" };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const startOfWeek = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; };
const startOfMonth = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(1); return x; };
const sameYMD = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export default function CableProductionCalendar() {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [machines, setMachines] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [view, setView] = useState("month");
  const [machineFilter, setMachineFilter] = useState("all");
  const [anchor, setAnchor] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, s] = await Promise.all([loadEngineMachines(), loadSavedSchedule()]);
      setMachines(m || []);
      setSchedule(s || []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => (machineFilter === "all" ? schedule : schedule.filter((j) => j.machineId === machineFilter)),
    [schedule, machineFilter],
  );

  const { gridStart, days, label } = useMemo(() => {
    if (view === "week") {
      const gs = startOfWeek(anchor);
      const end = new Date(gs); end.setDate(gs.getDate() + 6);
      return { gridStart: gs, days: 7, label: `${gs.getDate()} ${MONTHS[gs.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}` };
    }
    const som = startOfMonth(anchor);
    const gs = startOfWeek(som);                       // pad to the week the 1st falls in
    const next = new Date(som); next.setMonth(som.getMonth() + 1);
    const weeks = Math.ceil((((next - gs) / 86400000)) / 7);
    return { gridStart: gs, days: weeks * 7, label: `${MONTHS[som.getMonth()]} ${som.getFullYear()}` };
  }, [view, anchor]);

  const buckets = useMemo(() => calendarBuckets(filtered, machines, gridStart, days), [filtered, machines, gridStart, days]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const curMonth = startOfMonth(anchor).getMonth();

  const step = (dir) => {
    const d = new Date(anchor);
    if (view === "week") d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setAnchor(d);
  };
  const goToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); setAnchor(d); };

  const DayCell = ({ b }) => {
    const cellDate = new Date(`${b.date}T00:00:00`);
    const isToday = sameYMD(cellDate, today);
    const dim = view === "month" && cellDate.getMonth() !== curMonth;
    const shown = b.jobs.slice(0, 3);
    const more = b.jobs.length - shown.length;
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 0.75, minHeight: view === "month" ? 92 : 140, opacity: dim ? 0.45 : 1,
          borderColor: isToday ? "primary.main" : "divider",
          borderWidth: isToday ? 2 : 1, display: "flex", flexDirection: "column",
          bgcolor: b.working ? "transparent" : alpha(theme.palette.text.primary, 0.03),
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="caption" sx={{ fontWeight: isToday ? 800 : 600, color: isToday ? "primary.main" : "text.secondary" }}>
            {cellDate.getDate()}
          </Typography>
          {b.jobCount > 0 && (
            <Tooltip title={`${b.totalHrs}h scheduled`}>
              <Chip size="small" label={b.jobCount} sx={{ height: 18, "& .MuiChip-label": { px: 0.75, fontSize: 11 } }} />
            </Tooltip>
          )}
        </Stack>
        <Stack spacing={0.25} sx={{ mt: 0.5, overflow: "hidden" }}>
          {shown.map((j) => (
            <Tooltip key={j.id} title={`${j.productName || j.cableId} · ${STAGE_LABEL[j.stage] || j.stage}${j.coreColor ? ` (${j.coreColor})` : ""} · ${j.machineId}`}>
              <Box sx={{
                px: 0.5, py: 0.125, borderRadius: 0.5, fontSize: 10.5, lineHeight: 1.5, color: "#fff",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                bgcolor: STAGE_COLOR[j.stage] || theme.palette.grey[500],
              }}>
                {(STAGE_LABEL[j.stage] || j.stage)} · {j.orderNo || j.cableId || j.machineId}
              </Box>
            </Tooltip>
          ))}
          {more > 0 && <Typography variant="caption" color="text.secondary">+{more} more</Typography>}
        </Stack>
      </Paper>
    );
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Production Calendar</Typography>
          <Typography variant="body2" color="text.secondary">Saved schedule across the line, by day</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" gap={1}>
          <TextField select size="small" label="Machine" value={machineFilter} onChange={(e) => setMachineFilter(e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="all">All machines</MenuItem>
            {machines.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
          </TextField>
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
            <ToggleButton value="week">Week</ToggleButton>
            <ToggleButton value="month">Month</ToggleButton>
          </ToggleButtonGroup>
          <Button startIcon={<RefreshRounded />} onClick={load} variant="outlined" size="small">Refresh</Button>
        </Stack>
      </Stack>

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Button size="small" startIcon={<ChevronLeftRounded />} onClick={() => step(-1)}>Prev</Button>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontWeight: 700 }}>{label}</Typography>
          <Button size="small" startIcon={<TodayRounded />} onClick={goToday} variant="text">Today</Button>
        </Stack>
        <Button size="small" endIcon={<ChevronRightRounded />} onClick={() => step(1)}>Next</Button>
      </Stack>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress /></Box>
      ) : (
        <Box>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0.5, mb: 0.5 }}>
            {DOW.map((d) => (
              <Typography key={d} variant="caption" sx={{ textAlign: "center", fontWeight: 700, color: "text.secondary" }}>{d}</Typography>
            ))}
          </Box>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0.5 }}>
            {buckets.map((b) => <DayCell key={b.date} b={b} />)}
          </Box>
          <Stack direction="row" spacing={2} sx={{ mt: 2 }} flexWrap="wrap">
            {Object.entries(STAGE_COLOR).map(([stage, color]) => (
              <Stack key={stage} direction="row" spacing={0.5} alignItems="center">
                <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: color }} />
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: "capitalize" }}>{STAGE_LABEL[stage] || stage}</Typography>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
}
