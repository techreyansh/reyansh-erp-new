import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  InputAdornment,
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
  Skeleton,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Autocomplete,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Divider,
  useTheme,
  alpha,
} from "@mui/material";
import {
  Add as AddIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  CableRounded as CableIcon,
} from "@mui/icons-material";

import {
  listCables,
  saveCable,
  deleteCable,
  computeSpecs,
} from "../../services/cableMasterService";

const COLOUR_OPTIONS = [
  "Red",
  "Black",
  "Yellow",
  "Green",
  "Blue",
  "Brown",
  "Grey",
  "White",
];

const EMPTY_FORM = {
  cable_code: "",
  cable_name: "",
  cores: 1,
  flat_round: "round",
  strand_construction: "",
  copper_area_sqmm: "",
  conductor_od: "",
  core_od: "",
  finished_od: "",
  colour_combination: [],
  insulation_thickness: 0.6,
  sheath_thickness: 0.9,
  voltage: "",
  standard_length_m: "",
  weight_per_meter: "",
  is_power_cord: false,
  cord_length: "",
  notes: "",
  is_active: true,
};

const round4 = (v) =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? "—"
    : Number(v).toFixed(4);

const CableMaster = () => {
  const theme = useTheme();
  const [cables, setCables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await listCables();
      setCables(rows || []);
    } catch (e) {
      setError(e.message || "Failed to load cables.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cables;
    return cables.filter(
      (c) =>
        String(c.cable_code || "").toLowerCase().includes(q) ||
        String(c.cable_name || "").toLowerCase().includes(q)
    );
  }, [cables, search]);

  // Live derived specs for the dialog preview.
  const preview = useMemo(() => {
    try {
      return computeSpecs(form);
    } catch (e) {
      return null;
    }
  }, [form]);

  const openNew = () => {
    setDialogError("");
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setDialogError("");
    setForm({
      ...EMPTY_FORM,
      ...row,
      colour_combination: Array.isArray(row.colour_combination)
        ? row.colour_combination
        : [],
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (saving) return;
    setDialogOpen(false);
  };

  const setField = (key, value) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Prefill the computed OD/weight fields when they are blank, so the form
  // shows the derived values (user may still override).
  useEffect(() => {
    if (!dialogOpen || !preview) return;
    setForm((prev) => {
      const next = { ...prev };
      let changed = false;
      const blank = (v) => v === null || v === undefined || v === "";
      if (blank(prev.conductor_od)) {
        next.conductor_od = preview.conductor_od;
        changed = true;
      }
      if (blank(prev.core_od)) {
        next.core_od = preview.core_od;
        changed = true;
      }
      if (blank(prev.finished_od)) {
        next.finished_od = preview.finished_od;
        changed = true;
      }
      if (blank(prev.weight_per_meter)) {
        next.weight_per_meter = preview.weight_per_meter;
        changed = true;
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dialogOpen,
    form.cores,
    form.copper_area_sqmm,
    form.strand_construction,
    form.insulation_thickness,
    form.sheath_thickness,
  ]);

  const handleSave = async () => {
    setDialogError("");
    if (!String(form.cable_code || "").trim()) {
      setDialogError("Cable code is required.");
      return;
    }
    setSaving(true);
    try {
      await saveCable(form);
      await load();
      setDialogOpen(false);
    } catch (e) {
      setDialogError(e.message || "Failed to save cable.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete cable "${row.cable_code}"? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteCable(row.id);
      await load();
    } catch (e) {
      setError(e.message || "Failed to delete cable.");
    }
  };

  const headerCellSx = { fontWeight: 700, whiteSpace: "nowrap" };

  return (
    <Box>
      {/* Header */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Cable Master
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Define each cable/power-cord once; routing, BOM and MRP derive from it.
          </Typography>
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ width: { xs: "100%", sm: "auto" } }}>
          <TextField
            size="small"
            placeholder="Search code or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: { sm: 240 } }}
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>
            New Cable
          </Button>
        </Stack>
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
                <TableCell sx={headerCellSx} align="right">Cores</TableCell>
                <TableCell sx={headerCellSx}>Flat/Round</TableCell>
                <TableCell sx={headerCellSx}>Strand</TableCell>
                <TableCell sx={headerCellSx} align="right">Copper mm²</TableCell>
                <TableCell sx={headerCellSx} align="right">Finished OD</TableCell>
                <TableCell sx={headerCellSx} align="right">Weight/m</TableCell>
                <TableCell sx={headerCellSx}>Colours</TableCell>
                <TableCell sx={headerCellSx} align="right">Std length</TableCell>
                <TableCell sx={headerCellSx}>Power cord?</TableCell>
                <TableCell sx={headerCellSx} align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    {Array.from({ length: 12 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton variant="text" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12}>
                    <Box
                      sx={{
                        py: 6,
                        textAlign: "center",
                        color: "text.secondary",
                      }}
                    >
                      <CableIcon
                        sx={{
                          fontSize: 40,
                          color: alpha(theme.palette.text.secondary, 0.5),
                          mb: 1,
                        }}
                      />
                      <Typography variant="body2">
                        {search
                          ? "No cables match your search."
                          : "No cables yet — add your first cable."}
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}

              {!loading &&
                filtered.map((c) => (
                  <TableRow key={c.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{c.cable_code}</TableCell>
                    <TableCell>{c.cable_name || "—"}</TableCell>
                    <TableCell align="right">{c.cores ?? "—"}</TableCell>
                    <TableCell sx={{ textTransform: "capitalize" }}>
                      {c.flat_round || "—"}
                    </TableCell>
                    <TableCell>{c.strand_construction || "—"}</TableCell>
                    <TableCell align="right">{c.copper_area_sqmm ?? "—"}</TableCell>
                    <TableCell align="right">{c.finished_od ?? "—"}</TableCell>
                    <TableCell align="right">{c.weight_per_meter ?? "—"}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {(Array.isArray(c.colour_combination)
                          ? c.colour_combination
                          : []
                        ).map((col, i) => (
                          <Chip key={i} label={col} size="small" variant="outlined" />
                        ))}
                        {(!c.colour_combination ||
                          c.colour_combination.length === 0) && "—"}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">{c.standard_length_m ?? "—"}</TableCell>
                    <TableCell>
                      {c.is_power_cord ? (
                        <Chip label="Power cord" size="small" color="secondary" />
                      ) : (
                        <Chip label="Cable" size="small" variant="outlined" />
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(c)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDelete(c)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Add / Edit dialog */}
      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        maxWidth="md"
        fullWidth
        scroll="paper"
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          {form.id ? "Edit Cable" : "New Cable"}
        </DialogTitle>
        <DialogContent dividers>
          {dialogError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {dialogError}
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Cable code"
                required
                fullWidth
                size="small"
                value={form.cable_code}
                onChange={(e) => setField("cable_code", e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Cable name"
                fullWidth
                size="small"
                value={form.cable_name || ""}
                onChange={(e) => setField("cable_name", e.target.value)}
              />
            </Grid>

            <Grid item xs={6} sm={3}>
              <TextField
                label="Cores"
                type="number"
                fullWidth
                size="small"
                value={form.cores ?? ""}
                onChange={(e) => setField("cores", e.target.value)}
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField
                select
                label="Flat / Round"
                fullWidth
                size="small"
                value={form.flat_round || "round"}
                onChange={(e) => setField("flat_round", e.target.value)}
              >
                <MenuItem value="round">Round</MenuItem>
                <MenuItem value="flat">Flat</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField
                label="Strand construction"
                placeholder="30/0.25"
                fullWidth
                size="small"
                value={form.strand_construction || ""}
                onChange={(e) => setField("strand_construction", e.target.value)}
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField
                label="Copper area (mm²)"
                type="number"
                fullWidth
                size="small"
                value={form.copper_area_sqmm ?? ""}
                onChange={(e) => setField("copper_area_sqmm", e.target.value)}
              />
            </Grid>

            <Grid item xs={6} sm={3}>
              <TextField
                label="Insulation thickness"
                type="number"
                fullWidth
                size="small"
                value={form.insulation_thickness ?? ""}
                onChange={(e) => setField("insulation_thickness", e.target.value)}
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField
                label="Sheath thickness"
                type="number"
                fullWidth
                size="small"
                value={form.sheath_thickness ?? ""}
                onChange={(e) => setField("sheath_thickness", e.target.value)}
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField
                label="Voltage"
                fullWidth
                size="small"
                value={form.voltage || ""}
                onChange={(e) => setField("voltage", e.target.value)}
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField
                label="Standard length (m)"
                type="number"
                fullWidth
                size="small"
                value={form.standard_length_m ?? ""}
                onChange={(e) => setField("standard_length_m", e.target.value)}
              />
            </Grid>

            <Grid item xs={12}>
              <Autocomplete
                multiple
                freeSolo
                options={COLOUR_OPTIONS}
                value={Array.isArray(form.colour_combination) ? form.colour_combination : []}
                onChange={(_e, value) => setField("colour_combination", value)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Colour combination"
                    size="small"
                    placeholder="Add colour"
                  />
                )}
              />
            </Grid>

            {/* Overridable computed fields */}
            <Grid item xs={6} sm={3}>
              <TextField
                label="Conductor OD"
                type="number"
                fullWidth
                size="small"
                value={form.conductor_od ?? ""}
                onChange={(e) => setField("conductor_od", e.target.value)}
                helperText="Auto, overridable"
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField
                label="Core OD"
                type="number"
                fullWidth
                size="small"
                value={form.core_od ?? ""}
                onChange={(e) => setField("core_od", e.target.value)}
                helperText="Auto, overridable"
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField
                label="Finished OD"
                type="number"
                fullWidth
                size="small"
                value={form.finished_od ?? ""}
                onChange={(e) => setField("finished_od", e.target.value)}
                helperText="Auto, overridable"
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField
                label="Weight / m"
                type="number"
                fullWidth
                size="small"
                value={form.weight_per_meter ?? ""}
                onChange={(e) => setField("weight_per_meter", e.target.value)}
                helperText="Auto, overridable"
              />
            </Grid>

            <Grid item xs={12} sm={form.is_power_cord ? 6 : 12}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={!!form.is_power_cord}
                    onChange={(e) => setField("is_power_cord", e.target.checked)}
                  />
                }
                label="Is power cord"
              />
            </Grid>
            {form.is_power_cord && (
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Cord length"
                  type="number"
                  fullWidth
                  size="small"
                  value={form.cord_length ?? ""}
                  onChange={(e) => setField("cord_length", e.target.value)}
                />
              </Grid>
            )}

            <Grid item xs={12}>
              <TextField
                label="Notes"
                fullWidth
                multiline
                minRows={2}
                size="small"
                value={form.notes || ""}
                onChange={(e) => setField("notes", e.target.value)}
              />
            </Grid>

            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.is_active !== false}
                    onChange={(e) => setField("is_active", e.target.checked)}
                  />
                }
                label="Active"
              />
            </Grid>

            {/* Live preview */}
            <Grid item xs={12}>
              <Divider sx={{ mb: 1 }} />
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  backgroundColor: alpha(theme.palette.primary.main, 0.06),
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.15)}`,
                }}
              >
                <Typography
                  variant="subtitle2"
                  sx={{ fontWeight: 700, mb: 1, color: "primary.main" }}
                >
                  Live preview (derived)
                </Typography>
                <Grid container spacing={1}>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary">
                      Conductor OD
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {preview ? round4(preview.conductor_od) : "—"}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary">
                      Core OD
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {preview ? round4(preview.core_od) : "—"}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary">
                      Finished OD
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {preview ? round4(preview.finished_od) : "—"}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary">
                      Weight / m
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {preview ? round4(preview.weight_per_meter) : "—"}
                    </Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary">
                      Auto-BOM
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {preview
                        ? `Copper ${round4(preview.rm.copper)} · PVC-ins ${round4(
                            preview.rm.ins
                          )} · PVC-sheath ${round4(preview.rm.sh)} kg/m`
                        : "—"}
                    </Typography>
                  </Grid>
                </Grid>
              </Box>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeDialog} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save cable"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CableMaster;
