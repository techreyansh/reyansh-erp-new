// Drum Planning (Cable Production Planning — Phase 3).
// "How many drums for this length?" — a calculator over any Cable Master spec,
// plus a per-plan drum breakdown. Drum capacities come from the Machine Master.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Paper, Stack, Typography, Button, Chip, CircularProgress, MenuItem,
  TextField, Table, TableHead, TableRow, TableCell, TableBody, Alert, Tooltip,
  useTheme,
} from "@mui/material";
import { RefreshRounded, ViewInArRounded, WarningAmberRounded } from "@mui/icons-material";
import { orderDrumPlan } from "../../services/cablePlanner";
import { loadEngineMachines, listPlans, productionMetres } from "../../services/cableProductionService";
import { listCables, toEngineCable } from "../../services/cableMasterService";

const m = (v) => `${(Number(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} m`;

// One row's drum summary for a stage.
function StageDrums({ s }) {
  if (s.capacityM == null) {
    return <Chip size="small" variant="outlined" color="warning" label={`${s.label}: set capacity`} />;
  }
  const label = s.perCore
    ? `${s.label}: ${s.totalDrums} drums (${s.drumsPerCore}/core ×${s.cores})`
    : `${s.label}: ${s.totalDrums} drums`;
  return (
    <Tooltip title={`${s.machine || s.stage} · cap ${m(s.capacityM)}/drum${s.fits === false ? " · needs multiple drums" : ""}`}>
      <Chip size="small" color={s.fits === false ? "default" : "success"} variant={s.fits === false ? "outlined" : "filled"} label={label} />
    </Tooltip>
  );
}

export default function CableDrumPlanning() {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [machines, setMachines] = useState([]);
  const [cables, setCables] = useState([]);
  const [plans, setPlans] = useState([]);
  const [calcCableId, setCalcCableId] = useState("");
  const [calcLen, setCalcLen] = useState(2000);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mc, cb, pl] = await Promise.all([loadEngineMachines(), listCables(), listPlans()]);
      setMachines(mc || []);
      setCables(cb || []);
      setPlans(pl || []);
      if (!calcCableId && (cb || []).length) setCalcCableId(cb[0].id);
    } finally {
      setLoading(false);
    }
  }, [calcCableId]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const cablesById = useMemo(() => Object.fromEntries(cables.map((c) => [c.id, c])), [cables]);
  const byCode = useMemo(() => Object.fromEntries(cables.map((c) => [String(c.cable_code).toLowerCase(), c])), [cables]);

  const capsConfigured = useMemo(
    () => machines.some((mac) => mac.drumCapacityM || mac.coreCapacityM || mac.layingDrumCapacityM),
    [machines],
  );

  const calc = useMemo(() => {
    const row = cablesById[calcCableId];
    if (!row || !(Number(calcLen) > 0)) return null;
    return orderDrumPlan(toEngineCable(row), { cableId: calcCableId, qtyM: Number(calcLen) }, machines);
  }, [cablesById, calcCableId, calcLen, machines]);

  const planRows = useMemo(() => plans
    .filter((p) => !["completed", "cancelled"].includes(p.status))
    .map((p) => {
      const row = cablesById[p.cable_id] || byCode[String(p.cable_code).toLowerCase()];
      if (!row) return null;
      const metres = productionMetres(p, row);
      const dp = orderDrumPlan(toEngineCable(row), { cableId: row.id, qtyM: metres }, machines);
      const finished = dp.find((s) => s.stage === "sheathing") || dp[dp.length - 1];
      return { plan: p, cable: row, metres, stages: dp, finishedDrums: finished?.totalDrums ?? null };
    })
    .filter(Boolean), [plans, cablesById, byCode, machines]);

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Drum Planning</Typography>
          <Typography variant="body2" color="text.secondary">Multi-drum split per stage from Machine Master drum capacities</Typography>
        </Box>
        <Button startIcon={<RefreshRounded />} onClick={load} variant="outlined" size="small">Refresh</Button>
      </Stack>

      {!loading && !capsConfigured && (
        <Alert severity="info" icon={<WarningAmberRounded />} sx={{ mb: 2 }}>
          No drum capacities set on the Machine Master — drum counts can't be computed. Add drum / core / laying-drum capacity (m) per machine in the <b>Machine Master</b> tab.
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress /></Box>
      ) : (
        <Stack spacing={2}>
          {/* Calculator */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <ViewInArRounded color="action" />
              <Typography sx={{ fontWeight: 700 }}>Drum calculator</Typography>
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
              <TextField select size="small" label="Cable" value={calcCableId} onChange={(e) => setCalcCableId(e.target.value)} sx={{ minWidth: 220 }}>
                {cables.length === 0 && <MenuItem value="">No cables — add in Cable Master</MenuItem>}
                {cables.map((c) => <MenuItem key={c.id} value={c.id}>{c.cable_code} — {c.cable_name}</MenuItem>)}
              </TextField>
              <TextField
                size="small" type="number" label="Finished length (m)" value={calcLen}
                onChange={(e) => setCalcLen(e.target.value)} sx={{ width: 180 }}
              />
              {calc && (
                <Stack direction="row" spacing={1} flexWrap="wrap" gap={1}>
                  {calc.map((s) => <StageDrums key={s.stage} s={s} />)}
                </Stack>
              )}
            </Stack>
          </Paper>

          {/* Per-plan drum breakdown */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Active plans</Typography>
            {planRows.length === 0 ? (
              <Typography color="text.secondary" variant="body2">No active production plans. Create one in the Production Plans tab.</Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Plan / Cable</TableCell>
                    <TableCell>Customer</TableCell>
                    <TableCell align="right">Length</TableCell>
                    <TableCell align="right">Finished drums</TableCell>
                    <TableCell>Per-stage drums</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {planRows.map(({ plan, cable, metres, stages, finishedDrums }) => (
                    <TableRow key={plan.id} hover>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{cable.cable_code}</Typography>
                        <Typography variant="caption" color="text.secondary">{cable.cable_name}</Typography>
                      </TableCell>
                      <TableCell>{plan.customer_name || "—"}</TableCell>
                      <TableCell align="right">{m(metres)}</TableCell>
                      <TableCell align="right">
                        {finishedDrums == null
                          ? <Chip size="small" variant="outlined" color="warning" label="set caps" />
                          : <Chip size="small" color="primary" label={finishedDrums} />}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" gap={0.5}>
                          {stages.map((s) => <StageDrums key={s.stage} s={s} />)}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paper>
        </Stack>
      )}
    </Box>
  );
}
