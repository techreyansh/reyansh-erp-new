import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box, Card, CardContent, Typography, Stack, Button, Chip, Divider, Autocomplete,
  TextField, Alert, Snackbar, CircularProgress, Table, TableHead, TableRow, TableCell,
  TableBody, useTheme,
} from "@mui/material";
import { MergeTypeOutlined, WarningAmberOutlined } from "@mui/icons-material";
import inventoryMergeService, { isLikelyGeneric } from "../../services/inventoryMergeService";

const fmtDateTime = (v) => { if (!v) return ""; const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(); };

/**
 * Admin tool to fold a generic ppc_items code (COPPER, PVC_INS, …) into a
 * physical SKU. You pick the mapping; the tool previews the impact and applies
 * the merge transactionally via inv_merge_item. CEO/super-admin only.
 */
export default function MergeItems() {
  const theme = useTheme();
  const [items, setItems] = useState([]);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [preview, setPreview] = useState(null); // result of inv_merge_preview
  const [previewing, setPreviewing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [snack, setSnack] = useState(null); // { message, severity }

  const notify = (message, severity = "info") => setSnack({ message, severity });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [its, lg] = await Promise.all([
        inventoryMergeService.listItems(),
        inventoryMergeService.listMergeLog(),
      ]);
      setItems(its || []);
      setLog(lg || []);
    } catch (e) {
      notify(e?.message || "Failed to load items", "error");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const generics = useMemo(() => items.filter(isLikelyGeneric), [items]);

  const runPreview = async (f = from, t = to) => {
    if (!f || !t) return;
    setPreview(null);
    setPreviewing(true);
    try {
      const res = await inventoryMergeService.preview(f.code, t.code);
      if (res?.error) { notify(res.error, "warning"); setPreview(null); }
      else setPreview(res);
    } catch (e) {
      notify(e?.message || "Preview failed", "error");
    } finally {
      setPreviewing(false);
    }
  };

  const doMerge = async () => {
    if (!from || !to || !preview || preview.blocked) return;
    setMerging(true);
    try {
      await inventoryMergeService.merge(from.code, to.code);
      notify(`Merged ${from.code} → ${to.code}.`, "success");
      setFrom(null); setTo(null); setPreview(null);
      await load();
    } catch (e) {
      notify(e?.message || "Merge failed", "error");
    } finally {
      setMerging(false);
    }
  };

  const label = (it) => (it ? `${it.code} — ${it.name || ""}` : "");

  return (
    <Box sx={{ p: 3, maxWidth: 980, mx: "auto" }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
        <MergeTypeOutlined sx={{ color: theme.palette.primary.main, fontSize: 30 }} />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Merge Items</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Fold a generic code (e.g. COPPER, PVC_INS) into a physical SKU. All BOM, rate-master, costing
        and stock references are repointed in one transaction, then the generic is removed. Preview the
        impact before applying — every merge is logged.
      </Typography>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress /></Box>
      ) : (
        <>
          {generics.length > 0 && (
            <Card variant="outlined" sx={{ mb: 2, borderRadius: 2.5 }}>
              <CardContent>
                <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>Detected generic codes</Typography>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
                  {generics.map((g) => (
                    <Chip key={g.code} label={g.code} size="small"
                      color={from?.code === g.code ? "primary" : "default"}
                      variant={from?.code === g.code ? "filled" : "outlined"}
                      onClick={() => { setFrom(g); setPreview(null); }} />
                  ))}
                </Box>
              </CardContent>
            </Card>
          )}

          <Card variant="outlined" sx={{ mb: 2, borderRadius: 2.5 }}>
            <CardContent>
              <Stack spacing={2}>
                <Autocomplete
                  options={items}
                  value={from}
                  onChange={(_, v) => { setFrom(v); setPreview(null); }}
                  getOptionLabel={label}
                  isOptionEqualToValue={(o, v) => o.id === v.id}
                  renderInput={(p) => <TextField {...p} size="small" label="Merge FROM (generic — will be removed)" />}
                />
                <Autocomplete
                  options={items.filter((i) => !from || i.id !== from.id)}
                  value={to}
                  onChange={(_, v) => { setTo(v); setPreview(null); }}
                  getOptionLabel={label}
                  isOptionEqualToValue={(o, v) => o.id === v.id}
                  renderInput={(p) => <TextField {...p} size="small" label="INTO (physical SKU — kept)" />}
                />
                <Stack direction="row" spacing={1}>
                  <Button variant="outlined" disabled={!from || !to || previewing} onClick={() => runPreview()}>
                    {previewing ? "Previewing…" : "Preview impact"}
                  </Button>
                  <Button variant="contained" color="error"
                    disabled={!preview || preview.blocked || merging}
                    onClick={doMerge}>
                    {merging ? "Merging…" : "Merge"}
                  </Button>
                </Stack>

                {preview && (
                  <Alert severity={preview.blocked ? "error" : "info"} icon={preview.blocked ? <WarningAmberOutlined /> : undefined}>
                    {preview.blocked ? (
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{preview.block_reason}</Typography>
                    ) : (
                      <Typography variant="body2">
                        Merging <b>{preview.from_code}</b> → <b>{preview.to_code}</b> will repoint:{" "}
                        {preview.bom_component_rows} BOM component + {preview.bom_parent_rows} parent rows,{" "}
                        {preview.material_rate_rows} rate-master, {preview.costing_line_rows} costing,{" "}
                        {preview.rate_log_rows} rate-log, {preview.ledger_rows} ledger rows.
                        {Number(preview.bom_collisions) > 0 && ` ${preview.bom_collisions} BOM line(s) will be folded into existing.`}
                        {(Number(preview.on_hand_from) > 0) && ` On-hand moving: ${preview.on_hand_from}.`}
                        {" "}Then <b>{preview.from_code}</b> is deleted.
                      </Typography>
                    )}
                  </Alert>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined" sx={{ borderRadius: 2.5 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>Merge history</Typography>
              <Divider sx={{ my: 1 }} />
              {log.length === 0 ? (
                <Typography variant="caption" color="text.secondary">No merges yet.</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>{["From", "Into", "By", "When"].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: "0.72rem" }}>{h}</TableCell>)}</TableRow>
                  </TableHead>
                  <TableBody>
                    {log.map((r) => (
                      <TableRow key={r.merge_id}>
                        <TableCell sx={{ fontWeight: 600 }}>{r.from_code}</TableCell>
                        <TableCell>{r.to_code}</TableCell>
                        <TableCell>{r.merged_by || "—"}</TableCell>
                        <TableCell>{fmtDateTime(r.merged_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Snackbar open={Boolean(snack)} autoHideDuration={5000} onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        {snack ? <Alert severity={snack.severity} onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
