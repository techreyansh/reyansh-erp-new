// Small inline rows editor for header+lines masters (routing steps, BOM lines).
// value = array of objects; columns describe each editable cell. Add / remove /
// move up-down. Used inside MasterScreen via a custom form field. (Wave 3.)
import React from "react";
import {
  Box, Stack, Typography, IconButton, Button, TextField, MenuItem, Tooltip,
} from "@mui/material";
import {
  AddRounded, DeleteOutlineRounded, ArrowUpwardRounded, ArrowDownwardRounded,
} from "@mui/icons-material";

export default function RowsEditor({ value = [], onChange, columns = [], newRow = {}, label, addLabel = "Add row" }) {
  const rows = Array.isArray(value) ? value : [];
  const update = (i, key, v) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
  const add = () => onChange([...rows, { ...newRow }]);
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const copy = [...rows];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange(copy);
  };

  return (
    <Box>
      {label && <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary" }}>{label}</Typography>}
      <Stack spacing={1} sx={{ mt: 0.5 }}>
        {rows.length === 0 && <Typography variant="caption" color="text.secondary">No rows yet.</Typography>}
        {rows.map((r, i) => (
          <Stack key={i} direction="row" spacing={1} alignItems="center">
            <Typography variant="caption" sx={{ width: 18, color: "text.secondary" }}>{i + 1}</Typography>
            {columns.map((c) => (
              c.type === "select" ? (
                <TextField key={c.key} select size="small" label={c.label} value={r[c.key] ?? ""} onChange={(e) => update(i, c.key, e.target.value)} sx={{ minWidth: c.width || 130, flex: c.flex || "none" }}>
                  {(c.options || []).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                </TextField>
              ) : (
                <TextField key={c.key} size="small" type={c.type === "number" ? "number" : "text"} label={c.label} value={r[c.key] ?? ""} onChange={(e) => update(i, c.key, c.type === "number" ? e.target.value : e.target.value)} sx={{ minWidth: c.width || 120, flex: c.flex || "none" }} />
              )
            ))}
            <Stack direction="row">
              <Tooltip title="Up"><span><IconButton size="small" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUpwardRounded fontSize="small" /></IconButton></span></Tooltip>
              <Tooltip title="Down"><span><IconButton size="small" disabled={i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDownwardRounded fontSize="small" /></IconButton></span></Tooltip>
              <Tooltip title="Remove"><IconButton size="small" color="error" onClick={() => remove(i)}><DeleteOutlineRounded fontSize="small" /></IconButton></Tooltip>
            </Stack>
          </Stack>
        ))}
      </Stack>
      <Button size="small" startIcon={<AddRounded />} onClick={add} sx={{ mt: 1 }}>{addLabel}</Button>
    </Box>
  );
}
