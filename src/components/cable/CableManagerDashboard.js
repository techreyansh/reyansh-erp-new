// Production Manager Dashboard (Cable Production Planning — Phase 4).
// Loading / progress / at-risk / overdue across all work orders, from the
// relational ppc_wo execution layer. Built on cablePlanner.workOrderDashboard.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Paper, Stack, Typography, Button, Chip, CircularProgress, LinearProgress,
  Grid, Alert, Divider, useTheme,
} from "@mui/material";
import {
  RefreshRounded, WarningAmberRounded, TrendingUpRounded, PlaylistPlayRounded,
  CheckCircleRounded, ScheduleRounded,
} from "@mui/icons-material";
import { workOrderDashboard } from "../../services/cablePlanner";
import ppcService from "../../services/ppcService";

const pct = (v) => `${Math.round(v)}%`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—");

function Kpi({ label, value, sub, color, icon }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        {icon}
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{label}</Typography>
      </Stack>
      <Typography variant="h5" sx={{ fontWeight: 800, color: color || "text.primary" }}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

export default function CableManagerDashboard() {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [wos, setWos] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setWos(await ppcService.listWorkOrders() || []); }
    catch { setWos([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const d = useMemo(() => workOrderDashboard(wos), [wos]);

  if (loading) return <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Production Manager Dashboard</Typography>
          <Typography variant="body2" color="text.secondary">{d.total} work orders · {d.active} active</Typography>
        </Box>
        <Button startIcon={<RefreshRounded />} onClick={load} variant="outlined" size="small">Refresh</Button>
      </Stack>

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid item xs={6} sm={4} md={2}><Kpi label="Open" value={d.counts.open + d.counts.planned} icon={<ScheduleRounded fontSize="small" color="disabled" />} /></Grid>
        <Grid item xs={6} sm={4} md={2}><Kpi label="Running" value={d.counts.running} color={theme.palette.warning.main} icon={<PlaylistPlayRounded fontSize="small" color="warning" />} /></Grid>
        <Grid item xs={6} sm={4} md={2}><Kpi label="Completed" value={d.counts.completed} color={theme.palette.success.main} icon={<CheckCircleRounded fontSize="small" color="success" />} /></Grid>
        <Grid item xs={6} sm={4} md={2}><Kpi label="Overall progress" value={pct(d.overallProgress)} sub={`${d.producedQty}/${d.plannedQty} m`} icon={<TrendingUpRounded fontSize="small" color="primary" />} /></Grid>
        <Grid item xs={6} sm={4} md={2}><Kpi label="Scrap rate" value={`${d.scrapRate}%`} color={d.scrapRate > 5 ? theme.palette.error.main : undefined} icon={<WarningAmberRounded fontSize="small" color={d.scrapRate > 5 ? "error" : "disabled"} />} /></Grid>
        <Grid item xs={6} sm={4} md={2}><Kpi label="At risk" value={d.atRisk.length} color={d.atRisk.length ? theme.palette.error.main : undefined} sub={`${d.overdue.length} overdue`} icon={<WarningAmberRounded fontSize="small" color={d.atRisk.length ? "error" : "disabled"} />} /></Grid>
      </Grid>

      {d.total === 0 && (
        <Alert severity="info">No work orders yet. Release a plan in the Production Plans tab to create one.</Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={7}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>At-risk work orders</Typography>
            {d.atRisk.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Nothing at risk — all active orders on track. ✓</Typography>
            ) : (
              <Stack spacing={1} divider={<Divider flexItem />}>
                {d.atRisk.slice(0, 12).map(({ wo, daysToDue, progress, overdue }) => (
                  <Stack key={wo.id} direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                        {wo.wo_number || wo.id?.slice(0, 8)} · {wo.item?.name || wo.customer_name || "—"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {wo.customer_name ? `${wo.customer_name} · ` : ""}due {fmtDate(wo.due_date)}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box sx={{ width: 70 }}>
                        <LinearProgress variant="determinate" value={Math.round(progress * 100)} sx={{ height: 6, borderRadius: 3 }} />
                      </Box>
                      <Chip size="small" color="error" variant={overdue ? "filled" : "outlined"}
                        label={overdue ? `${Math.abs(daysToDue)}d over` : `${daysToDue}d left`} />
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} md={5}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Overdue</Typography>
            {d.overdue.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No overdue orders. ✓</Typography>
            ) : (
              <Stack spacing={1} divider={<Divider flexItem />}>
                {d.overdue.slice(0, 12).map(({ wo, daysOverdue, progress }) => (
                  <Stack key={wo.id} direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                    <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                      {wo.wo_number || wo.id?.slice(0, 8)} · {wo.customer_name || wo.item?.name || "—"}
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="caption" color="text.secondary">{pct(progress * 100)}</Typography>
                      <Chip size="small" color="error" label={`${daysOverdue}d`} />
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
