// Capacity Board (Cable Production Planning — Phase 2).
// Reads the SAVED Machine Schedules + the Machine Master, and shows each
// machine's today load (booked vs shift capacity), util%, next changeover, and
// total booked across the horizon. Flags bottlenecks (util > 100%).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Paper, Stack, Typography, Button, Chip, LinearProgress, CircularProgress,
  Tooltip, Alert, useTheme, alpha,
} from "@mui/material";
import {
  RefreshRounded, WarningAmberRounded, PrecisionManufacturingRounded, BoltRounded,
} from "@mui/icons-material";
import { capacityBoard } from "../../services/cablePlanner";
import { loadEngineMachines, loadSavedSchedule } from "../../services/cableProductionService";

const utilColor = (pct, theme) =>
  pct > 100 ? theme.palette.error.main
  : pct > 75 ? theme.palette.warning.main
  : pct > 25 ? theme.palette.success.main
  : pct > 0 ? theme.palette.success.light
  : theme.palette.divider;
const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—");

export default function CableCapacityBoard() {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [machines, setMachines] = useState([]);
  const [schedule, setSchedule] = useState([]);

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

  const board = useMemo(() => capacityBoard(machines, schedule), [machines, schedule]);
  const totals = useMemo(() => ({
    booked: board.reduce((s, b) => s + b.bookedToday, 0),
    capacity: board.reduce((s, b) => s + b.capacityToday, 0),
    bottlenecks: board.filter((b) => b.bottleneck).length,
    jobs: board.reduce((s, b) => s + b.jobsTotal, 0),
  }), [board]);
  const overallUtil = totals.capacity ? Math.round((totals.booked / totals.capacity) * 100) : 0;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Machine Capacity</Typography>
          <Typography variant="body2" color="text.secondary">
            Today's load from the saved schedule · {totals.jobs} scheduled jobs · line util {overallUtil}%
          </Typography>
        </Box>
        <Button startIcon={<RefreshRounded />} onClick={load} variant="outlined" size="small">Refresh</Button>
      </Stack>

      {totals.bottlenecks > 0 && (
        <Alert severity="warning" icon={<WarningAmberRounded />} sx={{ mb: 2 }}>
          {totals.bottlenecks} machine{totals.bottlenecks > 1 ? "s are" : " is"} over capacity today — rebalance the schedule or extend the shift.
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress /></Box>
      ) : board.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <PrecisionManufacturingRounded sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
          <Typography color="text.secondary">No machines configured. Add machines in the Machine Master tab.</Typography>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          {board.map((b) => (
            <Paper key={b.machine.id} variant="outlined" sx={{ p: 2, borderColor: b.bottleneck ? "error.main" : "divider" }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 220 }}>
                  <PrecisionManufacturingRounded color="action" />
                  <Box>
                    <Typography sx={{ fontWeight: 700 }}>{b.machine.name}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: "capitalize" }}>
                      {b.machine.stage} · {b.machine.id}
                    </Typography>
                  </Box>
                </Stack>

                <Box sx={{ flex: 1, minWidth: 200, maxWidth: 420 }}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="caption" color="text.secondary">
                      {b.bookedToday}h booked / {b.capacityToday}h today
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: utilColor(b.utilToday, theme) }}>
                      {b.utilToday}%
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, b.utilToday)}
                    sx={{
                      height: 8, borderRadius: 4, mt: 0.5,
                      backgroundColor: alpha(theme.palette.text.primary, 0.08),
                      "& .MuiLinearProgress-bar": { backgroundColor: utilColor(b.utilToday, theme) },
                    }}
                  />
                </Box>

                <Stack direction="row" spacing={1} alignItems="center">
                  {b.nextChangeover && (
                    <Tooltip title={`Next changeover ${fmtDT(b.nextChangeover.at)} (${b.nextChangeover.label})`}>
                      <Chip size="small" icon={<BoltRounded />} label={`CO ${fmtDT(b.nextChangeover.at)}`} variant="outlined" />
                    </Tooltip>
                  )}
                  <Chip size="small" label={`${b.jobsTotal} jobs`} />
                  <Chip size="small" label={`${b.bookedTotal}h total`} variant="outlined" />
                  {b.bottleneck && <Chip size="small" color="error" icon={<WarningAmberRounded />} label="Bottleneck" />}
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </Box>
  );
}
