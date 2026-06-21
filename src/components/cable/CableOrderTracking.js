// Order Tracking + Workflow View (Cable Production Planning — Phase 4).
// Left: work-order list (status filter). Right: the selected order's stage
// workflow (copper→…→packing) with per-stage status / operator / output, plus
// material consumption (issued vs required) and QC results. Reads ppc_wo layer.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Paper, Stack, Typography, Button, Chip, CircularProgress, LinearProgress,
  List, ListItemButton, TextField, MenuItem, Divider, Tooltip, useTheme, alpha,
} from "@mui/material";
import {
  RefreshRounded, CheckCircleRounded, PlayCircleRounded, RadioButtonUncheckedRounded,
  ArrowForwardRounded, ScienceRounded,
} from "@mui/icons-material";
import { woStatusBucket, woProgress } from "../../services/cablePlanner";
import ppcService from "../../services/ppcService";

const fmtDT = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—");
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—");
const STATUS_COLOR = { open: "default", planned: "info", running: "warning", completed: "success", cancelled: "default" };

const stageIcon = (status) => {
  const s = String(status || "").toLowerCase();
  if (s.includes("done") || s.includes("complete")) return <CheckCircleRounded color="success" />;
  if (s.includes("progress") || s.includes("running")) return <PlayCircleRounded color="warning" />;
  return <RadioButtonUncheckedRounded color="disabled" />;
};

export default function CableOrderTracking() {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [wos, setWos] = useState([]);
  const [filter, setFilter] = useState("active");
  const [selId, setSelId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try { setWos(await ppcService.listWorkOrders() || []); }
    catch { setWos([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  const filtered = useMemo(() => {
    const list = wos.map((w) => ({ ...w, _bucket: woStatusBucket(w.status) }));
    if (filter === "all") return list;
    if (filter === "active") return list.filter((w) => w._bucket !== "completed" && w._bucket !== "cancelled");
    return list.filter((w) => w._bucket === filter);
  }, [wos, filter]);

  useEffect(() => {
    if (!selId && filtered.length) setSelId(filtered[0].id);
  }, [filtered, selId]);

  const loadDetail = useCallback(async (id) => {
    if (!id) return;
    setDetailLoading(true);
    try { setDetail(await ppcService.getWorkOrder(id)); }
    catch { setDetail(null); }
    finally { setDetailLoading(false); }
  }, []);
  useEffect(() => { if (selId) loadDetail(selId); }, [selId, loadDetail]);

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Order Tracking</Typography>
          <Typography variant="body2" color="text.secondary">Per-order stage workflow, material consumption & QC</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <TextField select size="small" label="Show" value={filter} onChange={(e) => setFilter(e.target.value)} sx={{ minWidth: 140 }}>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="running">Running</MenuItem>
            <MenuItem value="open">Open / Planned</MenuItem>
            <MenuItem value="completed">Completed</MenuItem>
            <MenuItem value="all">All</MenuItem>
          </TextField>
          <Button startIcon={<RefreshRounded />} onClick={() => { loadList(); if (selId) loadDetail(selId); }} variant="outlined" size="small">Refresh</Button>
        </Stack>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="flex-start">
        {/* List */}
        <Paper variant="outlined" sx={{ width: { xs: "100%", md: 320 }, flexShrink: 0, maxHeight: 560, overflow: "auto" }}>
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress size={24} /></Box>
          ) : filtered.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No work orders match.</Typography>
          ) : (
            <List disablePadding>
              {filtered.map((w) => {
                const prog = Math.round(woProgress(w) * 100);
                return (
                  <ListItemButton key={w.id} selected={w.id === selId} onClick={() => setSelId(w.id)} sx={{ display: "block", py: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{w.wo_number || w.id?.slice(0, 8)}</Typography>
                      <Chip size="small" color={STATUS_COLOR[w._bucket]} label={w._bucket} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                      {w.item?.name || w.customer_name || "—"} · due {fmtDate(w.due_date)}
                    </Typography>
                    <LinearProgress variant="determinate" value={prog} sx={{ height: 4, borderRadius: 2, mt: 0.5 }} />
                  </ListItemButton>
                );
              })}
            </List>
          )}
        </Paper>

        {/* Detail */}
        <Box sx={{ flex: 1, minWidth: 0, width: "100%" }}>
          {detailLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress /></Box>
          ) : !detail ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
              <Typography color="text.secondary">Select a work order to see its workflow.</Typography>
            </Paper>
          ) : (
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>{detail.wo_number || detail.id?.slice(0, 8)}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {detail.item?.name || "—"} · {detail.qty} {detail.item?.uom || "m"}
                      {detail.customer_name ? ` · ${detail.customer_name}` : ""} · due {fmtDate(detail.due_date)}
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: "right" }}>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: "primary.main" }}>{Math.round(woProgress(detail) * 100)}%</Typography>
                    <Typography variant="caption" color="text.secondary">{detail.produced_qty || 0}/{detail.qty} produced</Typography>
                  </Box>
                </Stack>
              </Paper>

              {/* Stage workflow */}
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography sx={{ fontWeight: 700, mb: 1.5 }}>Workflow</Typography>
                {detail.stages.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">No routed stages on this order.</Typography>
                ) : (
                  <Stack direction="row" spacing={0} alignItems="stretch" sx={{ overflowX: "auto", pb: 1 }}>
                    {detail.stages.map((s, i) => (
                      <React.Fragment key={s.id}>
                        <Box sx={{ minWidth: 150, p: 1.25, borderRadius: 1, border: `1px solid ${theme.palette.divider}`,
                          bgcolor: alpha(theme.palette.text.primary, 0.02) }}>
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
                            {stageIcon(s.status)}
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>{s.stage_name}</Typography>
                          </Stack>
                          <Typography variant="caption" color="text.secondary" display="block">{s.machine?.name || "—"}</Typography>
                          {s.operator_name && <Typography variant="caption" display="block">👷 {s.operator_name}</Typography>}
                          {(s.output_qty != null) && <Typography variant="caption" display="block">out {s.output_qty}{s.scrap_qty ? ` · scrap ${s.scrap_qty}` : ""}</Typography>}
                          {s.started_at && <Typography variant="caption" color="text.secondary" display="block">{fmtDT(s.started_at)}</Typography>}
                        </Box>
                        {i < detail.stages.length - 1 && (
                          <Stack justifyContent="center" sx={{ px: 0.5 }}><ArrowForwardRounded fontSize="small" color="disabled" /></Stack>
                        )}
                      </React.Fragment>
                    ))}
                  </Stack>
                )}
              </Paper>

              {/* Material consumption */}
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography sx={{ fontWeight: 700, mb: 1 }}>Material consumption</Typography>
                {detail.materials.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">No material kit on this order.</Typography>
                ) : (
                  <Stack spacing={1} divider={<Divider flexItem />}>
                    {detail.materials.map((mt) => {
                      const req = Number(mt.qty_required) || 0;
                      const iss = Number(mt.qty_issued) || 0;
                      const p = req > 0 ? Math.min(100, Math.round((iss / req) * 100)) : 0;
                      return (
                        <Stack key={mt.id} direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                          <Typography variant="body2" sx={{ minWidth: 0 }} noWrap>{mt.item?.name || mt.item?.code || mt.item_id}</Typography>
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 200 }}>
                            <Box sx={{ width: 110 }}><LinearProgress variant="determinate" value={p} sx={{ height: 6, borderRadius: 3 }} /></Box>
                            <Typography variant="caption" color="text.secondary">{iss}/{req} {mt.item?.uom || ""}</Typography>
                          </Stack>
                        </Stack>
                      );
                    })}
                  </Stack>
                )}
              </Paper>

              {/* QC */}
              {detail.qc.length > 0 && (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 1 }}>
                    <ScienceRounded fontSize="small" color="action" />
                    <Typography sx={{ fontWeight: 700 }}>Quality checks</Typography>
                  </Stack>
                  <Stack spacing={0.5}>
                    {detail.qc.slice(0, 8).map((q) => (
                      <Stack key={q.id} direction="row" justifyContent="space-between">
                        <Typography variant="body2">{q.check_type}{q.measured_value != null ? ` · ${q.measured_value}` : ""}</Typography>
                        <Tooltip title={fmtDT(q.checked_at)}>
                          <Chip size="small" color={String(q.result).toLowerCase().includes("pass") ? "success" : String(q.result).toLowerCase().includes("fail") ? "error" : "default"} label={q.result} />
                        </Tooltip>
                      </Stack>
                    ))}
                  </Stack>
                </Paper>
              )}
            </Stack>
          )}
        </Box>
      </Stack>
    </Box>
  );
}
