/**
 * Cable Production — MRP Dashboard (Phase 1b).
 *
 * Aggregates raw-material requirements across all active (non-completed) cable
 * production plans, joins on-hand stock, and surfaces shortfalls. Read-only.
 *
 * MUI + theme tokens only.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Stack,
  Typography,
  Paper,
  Card,
  CardContent,
  Grid,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Chip,
  IconButton,
  Tooltip,
  Alert,
  LinearProgress,
  useTheme,
  alpha,
} from "@mui/material";
import {
  RefreshRounded,
  CheckCircleRounded,
  CancelRounded,
} from "@mui/icons-material";

import { mrpDashboard } from "../../services/cableProductionService";

function KpiCard({ label, value, unit, color }) {
  const theme = useTheme();
  const c = theme.palette[color] || theme.palette.primary;
  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: alpha(c.main, 0.3),
        background: alpha(c.main, 0.04),
        height: "100%",
      }}
    >
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 700, color: c.main }}>
          {value}
          {unit && (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
              {unit}
            </Typography>
          )}
        </Typography>
      </CardContent>
    </Card>
  );
}

export default function CableMrpDashboard() {
  const theme = useTheme();
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ required_cost: 0, shortfall_cost: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { rows: r, totals: t } = await mrpDashboard();
      setRows(r);
      setTotals(t || { required_cost: 0, shortfall_cost: 0 });
    } catch (err) {
      setError(err.message || "Failed to load MRP data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.shortfall - a.shortfall),
    [rows]
  );

  const kpis = useMemo(() => {
    let copper = 0;
    let pvc = 0;
    let short = 0;
    rows.forEach((r) => {
      if (r.code === "CO001") copper += r.required;
      else pvc += r.required; // PV001 + PV003
      if (r.shortfall > 0) short += 1;
    });
    return {
      copper: +copper.toFixed(1),
      pvc: +pvc.toFixed(1),
      short,
    };
  }, [rows]);

  return (
    <Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            MRP — Material Requirement
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Aggregated across all active (non-completed) production plans.
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={load} disabled={loading}>
              <RefreshRounded />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <KpiCard label="Total Copper Required" value={kpis.copper} unit="kg" color="error" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <KpiCard label="Total PVC Required" value={kpis.pvc} unit="kg" color="info" />
        </Grid>
        <Grid item xs={6} sm={3}>
          <KpiCard
            label="Materials Short"
            value={kpis.short}
            color={kpis.short > 0 ? "warning" : "success"}
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <KpiCard
            label="Shortfall spend"
            value={`₹${(totals.shortfall_cost || 0).toLocaleString("en-IN")}`}
            color={totals.shortfall_cost > 0 ? "warning" : "success"}
          />
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: alpha(theme.palette.primary.main, 0.06) }}>
                <TableCell sx={{ fontWeight: 700 }}>Material</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  Required (kg)
                </TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  On hand
                </TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  Shortfall
                </TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  Unit ₹
                </TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  Req. value ₹
                </TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  Status
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!loading && sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Box sx={{ py: 4, textAlign: "center" }}>
                      <Typography color="text.secondary">
                        No material requirements from active plans.
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
              {sorted.map((r) => {
                const short = r.shortfall > 0;
                return (
                  <TableRow key={r.code} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {r.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {r.code}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{r.required}</TableCell>
                    <TableCell align="right">{r.on_hand}</TableCell>
                    <TableCell align="right">{r.shortfall}</TableCell>
                    <TableCell align="right">{r.unit_cost ? `₹${r.unit_cost.toLocaleString("en-IN")}` : "—"}</TableCell>
                    <TableCell align="right">{r.required_cost ? `₹${r.required_cost.toLocaleString("en-IN")}` : "—"}</TableCell>
                    <TableCell align="right">
                      {short ? (
                        <Chip
                          size="small"
                          color="error"
                          icon={<CancelRounded sx={{ fontSize: 14 }} />}
                          label="SHORT"
                        />
                      ) : (
                        <Chip
                          size="small"
                          color="success"
                          icon={<CheckCircleRounded sx={{ fontSize: 14 }} />}
                          label="OK"
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
