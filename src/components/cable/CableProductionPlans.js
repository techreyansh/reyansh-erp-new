/**
 * Cable Production — Production Plans (Phase 1b).
 *
 * Lists production plans from the LIVE `cable_production_plan` table, and a
 * Create/Edit dialog with live AUTO ROUTING + MATERIAL REQUIREMENT (MRP) +
 * AVAILABILITY panels derived from the cable planner engine. Plans can be saved
 * as drafts or released to a work order via the `cable_create_work_order` RPC.
 *
 * MUI + theme tokens only.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Stack,
  Typography,
  Button,
  Paper,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Chip,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  TextField,
  MenuItem,
  Autocomplete,
  Alert,
  LinearProgress,
  CircularProgress,
  Snackbar,
  Divider,
  useTheme,
  alpha,
} from "@mui/material";
import {
  AddRounded,
  EditRounded,
  DeleteRounded,
  PlayArrowRounded,
  RefreshRounded,
  LaunchRounded,
  CheckCircleRounded,
  CancelRounded,
} from "@mui/icons-material";

import { listCables } from "../../services/cableMasterService";
import {
  listPlans,
  savePlan,
  deletePlan,
  releaseToWorkOrder,
  computeRouting,
  computeMRP,
  productionMetres,
  stockFor,
} from "../../services/cableProductionService";

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const STATUS_COLORS = {
  draft: "default",
  planned: "info",
  released: "secondary",
  in_progress: "warning",
  completed: "success",
  cancelled: "error",
};

const emptyForm = {
  id: null,
  plan_code: "",
  cable_id: null,
  cable_code: "",
  product_name: "",
  customer_code: "",
  customer_name: "",
  sales_order_number: "",
  qty: "",
  length_m: "",
  due_date: "",
  priority: "medium",
  status: "draft",
};

function StatusChip({ status }) {
  return (
    <Chip
      size="small"
      label={String(status || "draft").replace("_", " ")}
      color={STATUS_COLORS[status] || "default"}
      sx={{ textTransform: "capitalize", fontWeight: 600 }}
    />
  );
}

function PriorityChip({ priority }) {
  const color = priority === "high" ? "error" : priority === "low" ? "default" : "primary";
  return (
    <Chip
      size="small"
      variant="outlined"
      label={priority || "medium"}
      color={color}
      sx={{ textTransform: "capitalize" }}
    />
  );
}

export default function CableProductionPlans() {
  const theme = useTheme();
  const [plans, setPlans] = useState([]);
  const [cables, setCables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [stock, setStock] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, c] = await Promise.all([listPlans(), listCables()]);
      setPlans(p);
      setCables(c);
    } catch (err) {
      setError(err.message || "Failed to load production plans.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const selectedCable = useMemo(
    () => cables.find((c) => c.id === form.cable_id) || null,
    [cables, form.cable_id]
  );

  // Live derived panels.
  const routing = useMemo(
    () => (selectedCable ? computeRouting(selectedCable) : []),
    [selectedCable]
  );
  const metres = useMemo(
    () => (selectedCable ? productionMetres(form, selectedCable) : 0),
    [form, selectedCable]
  );
  const mrp = useMemo(
    () => (selectedCable ? computeMRP(selectedCable, metres) : []),
    [selectedCable, metres]
  );

  // Refresh availability whenever the MRP codes change.
  useEffect(() => {
    let active = true;
    const codes = mrp.map((m) => m.code);
    if (!codes.length) {
      setStock({});
      return undefined;
    }
    stockFor(codes).then((s) => {
      if (active) setStock(s);
    });
    return () => {
      active = false;
    };
  }, [mrp]);

  const shortages = useMemo(
    () => mrp.filter((m) => (stock[m.code] || 0) < m.qty_required),
    [mrp, stock]
  );
  const hasShortage = shortages.length > 0;

  const openCreate = () => {
    setForm(emptyForm);
    setStock({});
    setDialogOpen(true);
  };

  const openEdit = (plan) => {
    setForm({
      ...emptyForm,
      ...plan,
      qty: plan.qty ?? "",
      length_m: plan.length_m ?? "",
      due_date: plan.due_date || "",
      priority: plan.priority || "medium",
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (saving) return;
    setDialogOpen(false);
  };

  const onPickCable = (cable) => {
    setForm((f) => ({
      ...f,
      cable_id: cable ? cable.id : null,
      cable_code: cable ? cable.cable_code : "",
      product_name: cable ? cable.cable_name || f.product_name : f.product_name,
    }));
  };

  const buildPlanPayload = (status) => {
    const total = selectedCable ? productionMetres(form, selectedCable) : Number(form.qty) || 0;
    return {
      ...(form.id ? { id: form.id } : {}),
      plan_code:
        form.plan_code || `PLN-${Date.now().toString(36).toUpperCase()}`,
      cable_id: form.cable_id,
      cable_code: form.cable_code,
      product_name: form.product_name || selectedCable?.cable_name || "",
      customer_code: form.customer_code || null,
      customer_name: form.customer_name || null,
      sales_order_number: form.sales_order_number || null,
      qty: Number(form.qty) || 0,
      length_m: form.length_m === "" ? null : Number(form.length_m),
      total_length_m: total,
      due_date: form.due_date || null,
      priority: form.priority || "medium",
      status,
    };
  };

  const validate = () => {
    if (!form.cable_id) {
      setToast({ severity: "error", msg: "Select a cable / product first." });
      return false;
    }
    if (!(Number(form.qty) > 0)) {
      setToast({ severity: "error", msg: "Quantity must be greater than zero." });
      return false;
    }
    return true;
  };

  const handleSaveDraft = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const status = form.status === "planned" ? "planned" : "draft";
      const saved = await savePlan(buildPlanPayload(status));
      setForm((f) => ({ ...f, id: saved.id, plan_code: saved.plan_code, status: saved.status }));
      setToast({ severity: "success", msg: "Plan saved." });
      await load();
      setDialogOpen(false);
    } catch (err) {
      setToast({ severity: "error", msg: err.message || "Save failed." });
    } finally {
      setSaving(false);
    }
  };

  const doRelease = async (plan, cable) => {
    setSaving(true);
    try {
      const result = await releaseToWorkOrder(plan, cable);
      const woNumber = result?.wo_number || result?.woNumber || "created";
      setToast({ severity: "success", msg: `Work Order ${woNumber} created` });
      await load();
      setDialogOpen(false);
    } catch (err) {
      setToast({ severity: "error", msg: err.message || "Release failed." });
    } finally {
      setSaving(false);
    }
  };

  const handleReleaseFromDialog = async () => {
    if (!validate()) return;
    if (hasShortage) {
      // eslint-disable-next-line no-alert
      const ok = window.confirm("Material short — release anyway?");
      if (!ok) return;
    }
    setSaving(true);
    let saved;
    try {
      saved = await savePlan(buildPlanPayload("planned"));
      setForm((f) => ({ ...f, id: saved.id, plan_code: saved.plan_code }));
    } catch (err) {
      setToast({ severity: "error", msg: err.message || "Save failed." });
      setSaving(false);
      return;
    }
    setSaving(false);
    await doRelease(saved, selectedCable);
  };

  const handleReleaseRow = async (plan) => {
    const cable =
      cables.find((c) => c.id === plan.cable_id) ||
      cables.find(
        (c) => String(c.cable_code).toLowerCase() === String(plan.cable_code).toLowerCase()
      );
    if (!cable) {
      setToast({ severity: "error", msg: "Cable not found for this plan." });
      return;
    }
    await doRelease(plan, cable);
  };

  const handleDelete = async (plan) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete plan "${plan.plan_code}"? This cannot be undone.`)) return;
    try {
      await deletePlan(plan.id);
      setToast({ severity: "success", msg: "Plan deleted." });
      await load();
    } catch (err) {
      setToast({ severity: "error", msg: err.message || "Delete failed." });
    }
  };

  const cableOptionLabel = (c) =>
    c ? `${c.cable_code}${c.cable_name ? ` — ${c.cable_name}` : ""}` : "";

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
            Production Plans
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Plan cable production, auto-route stages, and release work orders.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Refresh">
            <span>
              <IconButton onClick={load} disabled={loading}>
                <RefreshRounded />
              </IconButton>
            </span>
          </Tooltip>
          <Button variant="contained" startIcon={<AddRounded />} onClick={openCreate}>
            Create Plan
          </Button>
        </Stack>
      </Stack>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: alpha(theme.palette.primary.main, 0.06) }}>
                <TableCell sx={{ fontWeight: 700 }}>Plan</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Cable / Product</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Customer</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>SO #</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  Qty
                </TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  Length
                </TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Due</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Priority</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Work Order</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!loading && plans.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11}>
                    <Box sx={{ py: 4, textAlign: "center" }}>
                      <Typography color="text.secondary">
                        No production plans yet. Create one to get started.
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
              {plans.map((p) => {
                const released = !!p.work_order_id || p.status === "released" ||
                  p.status === "in_progress" || p.status === "completed";
                const editable = p.status === "draft" || p.status === "planned";
                return (
                  <TableRow key={p.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{p.plan_code}</TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {p.cable_code}
                      </Typography>
                      {p.product_name && (
                        <Typography variant="caption" color="text.secondary">
                          {p.product_name}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{p.customer_name || p.customer_code || "—"}</TableCell>
                    <TableCell>{p.sales_order_number || "—"}</TableCell>
                    <TableCell align="right">{p.qty ?? "—"}</TableCell>
                    <TableCell align="right">{p.length_m ?? "—"}</TableCell>
                    <TableCell>{p.due_date || "—"}</TableCell>
                    <TableCell>
                      <PriorityChip priority={p.priority} />
                    </TableCell>
                    <TableCell>
                      <StatusChip status={p.status} />
                    </TableCell>
                    <TableCell>
                      {p.work_order_id ? (
                        <Chip
                          size="small"
                          icon={<LaunchRounded sx={{ fontSize: 14 }} />}
                          label={p.work_order_id}
                          variant="outlined"
                          color="secondary"
                        />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        {editable && (
                          <Tooltip title="Edit">
                            <IconButton size="small" onClick={() => openEdit(p)}>
                              <EditRounded fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {!released && (
                          <Tooltip title="Release to Work Order">
                            <IconButton
                              size="small"
                              color="secondary"
                              onClick={() => handleReleaseRow(p)}
                            >
                              <PlayArrowRounded fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDelete(p)}
                          >
                            <DeleteRounded fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {form.id ? "Edit Production Plan" : "Create Production Plan"}
        </DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                options={cables}
                value={selectedCable}
                getOptionLabel={cableOptionLabel}
                isOptionEqualToValue={(o, v) => o.id === v?.id}
                onChange={(e, v) => onPickCable(v)}
                renderInput={(params) => (
                  <TextField {...params} label="Cable / Product" required />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="SO Number"
                value={form.sales_order_number}
                onChange={(e) => setField("sales_order_number", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Customer Code"
                value={form.customer_code}
                onChange={(e) => setField("customer_code", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Customer Name"
                value={form.customer_name}
                onChange={(e) => setField("customer_name", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={selectedCable?.is_power_cord ? 4 : 6}>
              <TextField
                fullWidth
                type="number"
                label={selectedCable?.is_power_cord ? "Qty (pieces)" : "Qty (metres)"}
                value={form.qty}
                onChange={(e) => setField("qty", e.target.value)}
                required
              />
            </Grid>
            {selectedCable?.is_power_cord && (
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  type="number"
                  label="Length per piece (m)"
                  value={form.length_m}
                  onChange={(e) => setField("length_m", e.target.value)}
                  helperText={`Default: ${selectedCable?.cord_length || 0} m`}
                />
              </Grid>
            )}
            <Grid item xs={12} sm={selectedCable?.is_power_cord ? 4 : 3}>
              <TextField
                fullWidth
                type="date"
                label="Due Date"
                InputLabelProps={{ shrink: true }}
                value={form.due_date}
                onChange={(e) => setField("due_date", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={selectedCable?.is_power_cord ? 12 : 3}>
              <TextField
                select
                fullWidth
                label="Priority"
                value={form.priority}
                onChange={(e) => setField("priority", e.target.value)}
              >
                {PRIORITIES.map((p) => (
                  <MenuItem key={p.value} value={p.value}>
                    {p.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            {selectedCable && (
              <>
                <Grid item xs={12}>
                  <Divider textAlign="left" sx={{ my: 1 }}>
                    <Chip label="Auto Routing" size="small" color="primary" />
                  </Divider>
                  <Stack
                    direction="row"
                    spacing={1}
                    flexWrap="wrap"
                    useFlexGap
                    alignItems="center"
                  >
                    <Chip label="Copper" size="small" variant="outlined" />
                    {routing.map((s, i) => (
                      <React.Fragment key={`${s.machine_stage}-${i}`}>
                        <Typography color="text.secondary">→</Typography>
                        <Chip
                          label={s.stage_name}
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                      </React.Fragment>
                    ))}
                  </Stack>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Divider textAlign="left" sx={{ my: 1 }}>
                    <Chip label="Material Requirement (MRP)" size="small" color="primary" />
                  </Divider>
                  <Typography variant="caption" color="text.secondary">
                    Production metres: {metres.toLocaleString()}
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Material</TableCell>
                        <TableCell sx={{ fontWeight: 700 }} align="right">
                          Required (kg)
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {mrp.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={2}>
                            <Typography variant="caption" color="text.secondary">
                              Enter a quantity to see material requirement.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                      {mrp.map((m) => (
                        <TableRow key={m.code}>
                          <TableCell>{m.name}</TableCell>
                          <TableCell align="right">{m.qty_required}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Divider textAlign="left" sx={{ my: 1 }}>
                    <Chip label="Availability" size="small" color="primary" />
                  </Divider>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Material</TableCell>
                        <TableCell sx={{ fontWeight: 700 }} align="right">
                          On hand
                        </TableCell>
                        <TableCell sx={{ fontWeight: 700 }} align="right">
                          Status
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {mrp.map((m) => {
                        const onHand = stock[m.code] || 0;
                        const short = onHand < m.qty_required;
                        return (
                          <TableRow key={m.code}>
                            <TableCell>{m.name}</TableCell>
                            <TableCell align="right">{onHand}</TableCell>
                            <TableCell align="right">
                              {short ? (
                                <Chip
                                  size="small"
                                  color="error"
                                  icon={<CancelRounded sx={{ fontSize: 14 }} />}
                                  label={`SHORT ${(m.qty_required - onHand).toFixed(1)}`}
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
                </Grid>

                {hasShortage && (
                  <Grid item xs={12}>
                    <Alert severity="warning">
                      One or more materials are short of the required quantity.
                    </Alert>
                  </Grid>
                )}
              </>
            )}
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeDialog} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSaveDraft} disabled={saving} variant="outlined">
            {saving ? <CircularProgress size={20} /> : "Save Draft"}
          </Button>
          <Button
            onClick={handleReleaseFromDialog}
            disabled={saving}
            variant="contained"
            color="secondary"
            startIcon={<PlayArrowRounded />}
          >
            Release
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!toast}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} variant="filled">
            {toast.msg}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
