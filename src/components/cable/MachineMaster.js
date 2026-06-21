import React, { useState, useEffect, useCallback } from "react";
import {
  Box,
  Paper,
  Typography,
  Button,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  IconButton,
  Tooltip,
  Chip,
  Stack,
  Switch,
  Skeleton,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Grid,
  FormControlLabel,
  MenuItem,
  useTheme,
  alpha,
} from "@mui/material";
import {
  Edit as EditIcon,
  Add as AddIcon,
  PrecisionManufacturingRounded as MachineIcon,
} from "@mui/icons-material";

import ppcService from "../../services/ppcService";

const STAGES = ["bunching", "core", "laying", "sheathing", "cutting"];

// Editable numeric spec columns shown in the dialog.
const NUMBER_FIELDS = [
  { key: "speed_m_per_hr", label: "Speed (m/hr)" },
  { key: "changeover_min", label: "Changeover (min)" },
  { key: "scrap_pct", label: "Scrap %" },
  { key: "lay_reduction_pct", label: "Lay reduction %" },
  { key: "shift_start_hour", label: "Shift start hour" },
  { key: "shift_hours", label: "Shift hours" },
  { key: "days_per_week", label: "Days per week" },
  { key: "drum_capacity_m", label: "Drum capacity (m)" },
  { key: "core_capacity_m", label: "Core capacity (m)" },
  { key: "laying_drum_capacity_m", label: "Laying drum capacity (m)" },
];

const num = (v) => (v === null || v === undefined || v === "" ? "—" : v);

const EMPTY_MACHINE = {
  code: "",
  name: "",
  stage: "bunching",
  is_available: true,
};

const MachineMaster = () => {
  const theme = useTheme();
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_MACHINE);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [isNew, setIsNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await ppcService.listCableMachines();
      setMachines(rows || []);
    } catch (e) {
      setError(e.message || "Failed to load machines.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (key, value) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const openEdit = (row) => {
    setDialogError("");
    setIsNew(false);
    setForm({ ...row });
    setDialogOpen(true);
  };

  const openNew = () => {
    setDialogError("");
    setIsNew(true);
    setForm({ ...EMPTY_MACHINE });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (saving) return;
    setDialogOpen(false);
  };

  // Build a clean patch: numeric fields coerced (blank → null).
  const buildPatch = (source) => {
    const patch = {};
    NUMBER_FIELDS.forEach(({ key }) => {
      const v = source[key];
      patch[key] = v === null || v === undefined || v === "" ? null : Number(v);
    });
    patch.is_available = !!source.is_available;
    return patch;
  };

  const handleSave = async () => {
    setDialogError("");
    if (!String(form.code || "").trim()) {
      setDialogError("Machine code is required.");
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        await ppcService.createMachine({
          code: form.code?.trim(),
          name: form.name?.trim(),
          machine_type: form.stage,
          status: "idle",
        });
        // Apply spec fields to the freshly created row by reloading then patching
        // is best-effort; createMachine only sets the base columns, so refresh.
      } else {
        await ppcService.updateCableMachine(form.id, {
          code: form.code?.trim(),
          name: form.name?.trim(),
          stage: form.stage,
          ...buildPatch(form),
        });
      }
      await load();
      setDialogOpen(false);
    } catch (e) {
      setDialogError(e.message || "Failed to save machine.");
    } finally {
      setSaving(false);
    }
  };

  // Toggle availability inline and persist immediately.
  const toggleAvailable = async (row) => {
    const next = !row.is_available;
    // Optimistic update.
    setMachines((prev) =>
      prev.map((m) => (m.id === row.id ? { ...m, is_available: next } : m))
    );
    try {
      await ppcService.updateCableMachine(row.id, { is_available: next });
    } catch (e) {
      setError(e.message || "Failed to update availability.");
      // Roll back on failure.
      setMachines((prev) =>
        prev.map((m) => (m.id === row.id ? { ...m, is_available: row.is_available } : m))
      );
    }
  };

  const headerCellSx = { fontWeight: 700, whiteSpace: "nowrap" };

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
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Machine Master
          </Typography>
          <Typography variant="body2" color="text.secondary">
            These machines drive auto-routing, scheduling and capacity planning.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>
          Add machine
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={headerCellSx}>Code</TableCell>
                <TableCell sx={headerCellSx}>Name</TableCell>
                <TableCell sx={headerCellSx}>Stage</TableCell>
                <TableCell sx={headerCellSx} align="right">Speed (m/hr)</TableCell>
                <TableCell sx={headerCellSx} align="right">Changeover (min)</TableCell>
                <TableCell sx={headerCellSx} align="right">Scrap %</TableCell>
                <TableCell sx={headerCellSx} align="right">Lay red. %</TableCell>
                <TableCell sx={headerCellSx} align="center">Shift (start/hrs/days)</TableCell>
                <TableCell sx={headerCellSx} align="right">Drum cap. (m)</TableCell>
                <TableCell sx={headerCellSx} align="right">Core cap. (m)</TableCell>
                <TableCell sx={headerCellSx} align="right">Laying drum (m)</TableCell>
                <TableCell sx={headerCellSx} align="center">Available</TableCell>
                <TableCell sx={headerCellSx} align="center">Edit</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    {Array.from({ length: 13 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton variant="text" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

              {!loading && machines.length === 0 && (
                <TableRow>
                  <TableCell colSpan={13}>
                    <Box sx={{ py: 6, textAlign: "center", color: "text.secondary" }}>
                      <MachineIcon
                        sx={{
                          fontSize: 40,
                          color: alpha(theme.palette.text.secondary, 0.5),
                          mb: 1,
                        }}
                      />
                      <Typography variant="body2">
                        No machines configured yet.
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}

              {!loading &&
                machines.map((m) => (
                  <TableRow key={m.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{m.code}</TableCell>
                    <TableCell>{m.name || "—"}</TableCell>
                    <TableCell>
                      <Chip
                        label={m.stage || "—"}
                        size="small"
                        variant="outlined"
                        sx={{ textTransform: "capitalize" }}
                      />
                    </TableCell>
                    <TableCell align="right">{num(m.speed_m_per_hr)}</TableCell>
                    <TableCell align="right">{num(m.changeover_min)}</TableCell>
                    <TableCell align="right">{num(m.scrap_pct)}</TableCell>
                    <TableCell align="right">{num(m.lay_reduction_pct)}</TableCell>
                    <TableCell align="center">
                      {num(m.shift_start_hour)} / {num(m.shift_hours)} /{" "}
                      {num(m.days_per_week)}
                    </TableCell>
                    <TableCell align="right">{num(m.drum_capacity_m)}</TableCell>
                    <TableCell align="right">{num(m.core_capacity_m)}</TableCell>
                    <TableCell align="right">{num(m.laying_drum_capacity_m)}</TableCell>
                    <TableCell align="center">
                      <Switch
                        size="small"
                        checked={!!m.is_available}
                        onChange={() => toggleAvailable(m)}
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="Edit machine">
                        <IconButton size="small" onClick={() => openEdit(m)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth scroll="paper">
        <DialogTitle sx={{ fontWeight: 700 }}>
          {isNew ? "Add machine" : `Edit ${form.code || "machine"}`}
        </DialogTitle>
        <DialogContent dividers>
          {dialogError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {dialogError}
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Code"
                required
                fullWidth
                size="small"
                value={form.code || ""}
                onChange={(e) => setField("code", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={5}>
              <TextField
                label="Name"
                fullWidth
                size="small"
                value={form.name || ""}
                onChange={(e) => setField("name", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField
                select
                label="Stage"
                fullWidth
                size="small"
                value={form.stage || "bunching"}
                onChange={(e) => setField("stage", e.target.value)}
              >
                {STAGES.map((s) => (
                  <MenuItem key={s} value={s} sx={{ textTransform: "capitalize" }}>
                    {s}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            {!isNew &&
              NUMBER_FIELDS.map(({ key, label }) => (
                <Grid item xs={6} sm={4} key={key}>
                  <TextField
                    label={label}
                    type="number"
                    fullWidth
                    size="small"
                    value={form[key] ?? ""}
                    onChange={(e) => setField(key, e.target.value)}
                  />
                </Grid>
              ))}

            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={!!form.is_available}
                    onChange={(e) => setField("is_available", e.target.checked)}
                  />
                }
                label="Available"
              />
            </Grid>

            {isNew && (
              <Grid item xs={12}>
                <Alert severity="info">
                  Saving creates the machine with its code, name and stage. Re-open it
                  to set speed, capacities and the other spec values.
                </Alert>
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeDialog} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MachineMaster;
