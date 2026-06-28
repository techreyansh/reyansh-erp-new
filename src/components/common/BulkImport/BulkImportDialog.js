import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Stack, Typography,
  Chip, Table, TableHead, TableRow, TableCell, TableBody, TableContainer, Paper,
  LinearProgress, Alert, CircularProgress, IconButton, useTheme, alpha,
} from "@mui/material";
import {
  CloudUploadOutlined, FileDownloadOutlined, DownloadDoneOutlined, Close as CloseIcon,
  CheckCircleOutline, ErrorOutline, ChangeCircleOutlined, AddCircleOutline,
} from "@mui/icons-material";
import { StatCard } from "../kit";
import { downloadTemplate } from "../../../services/bulkImport/template";
import { parseWorkbook } from "../../../services/bulkImport/parse";
import { analyzeRows, summarize } from "../../../services/bulkImport/runner";

const ACCEPT = ".xlsx,.xls,.csv";

/**
 * Generic bulk-import dialog for any dataset in the registry.
 * Flow: download template (blank / with data) → upload → preview (new/update/
 * invalid) → apply with progress → result. Domain logic lives in dataset.apply.
 */
export default function BulkImportDialog({ dataset, open, onClose, onApplied }) {
  const theme = useTheme();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(null); // 'blank' | 'data' | 'parse' | 'apply'
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState(null);
  const [analyzed, setAnalyzed] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);

  const reset = () => { setAnalyzed(null); setError(null); setResult(null); setFileName(null); setProgress({ done: 0, total: 0 }); };
  const handleClose = () => { if (busy === "apply") return; reset(); onClose && onClose(); };

  const summary = useMemo(() => (analyzed ? summarize(analyzed) : null), [analyzed]);
  const validItems = useMemo(() => (analyzed || []).filter((a) => a.valid), [analyzed]);

  const dlBlank = async () => { setBusy("blank"); try { downloadTemplate(dataset, { withData: false }); } finally { setBusy(null); } };
  const dlData = async () => {
    setBusy("data"); setError(null);
    try {
      const rows = await dataset.fetchExisting().catch(() => []);
      downloadTemplate(dataset, { withData: true, currentRows: rows });
    } catch (e) { setError(`Couldn't load current data: ${e.message}`); } finally { setBusy(null); }
  };

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setError("Please upload an .xlsx, .xls or .csv file."); return; }
    setError(null); setResult(null); setBusy("parse"); setFileName(file.name); setAnalyzed(null);
    try {
      const { rows } = await parseWorkbook(file, dataset);
      if (!rows.length) { setError("No data rows found in the file. Did you fill the Template sheet?"); setBusy(null); return; }
      const a = await analyzeRows(dataset, rows);
      setAnalyzed(a);
    } catch (e) { setError(e?.message || "Could not read the file."); } finally { setBusy(null); }
  }, [dataset]);

  const onDrop = useCallback((e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer?.files?.[0]); }, [handleFile]);

  const apply = async () => {
    if (!validItems.length) return;
    setBusy("apply"); setError(null); setProgress({ done: 0, total: validItems.length });
    try {
      const res = await dataset.apply(validItems, (done, total) => setProgress({ done, total }));
      setResult(res);
      onApplied && onApplied(res);
    } catch (e) { setError(e?.message || "Import failed."); } finally { setBusy(null); }
  };

  const statusChip = (s) => {
    if (s === "update") return <Chip size="small" color="info" icon={<ChangeCircleOutlined />} label="Update" sx={{ height: 22 }} />;
    if (s === "new") return <Chip size="small" color="success" icon={<AddCircleOutline />} label="New" sx={{ height: 22 }} />;
    return <Chip size="small" color="error" icon={<ErrorOutline />} label="Skip" sx={{ height: 22 }} />;
  };

  const previewCols = useMemo(() => {
    const mk = dataset.columns.find((c) => c.key === dataset.matchKey);
    const others = dataset.columns.filter((c) => c.key !== dataset.matchKey).slice(0, 2);
    return [mk, ...others].filter(Boolean);
  }, [dataset]);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, pr: 6 }}>
        Bulk import — {dataset.label}
        <IconButton onClick={handleClose} disabled={busy === "apply"} sx={{ position: "absolute", right: 8, top: 8 }}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {/* Step 1 — template */}
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>1 · Get the template</Typography>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          <Button onClick={dlBlank} disabled={!!busy} startIcon={busy === "blank" ? <CircularProgress size={16} /> : <FileDownloadOutlined />} variant="outlined">
            Download blank template
          </Button>
          <Button onClick={dlData} disabled={!!busy} startIcon={busy === "data" ? <CircularProgress size={16} /> : <DownloadDoneOutlined />} variant="outlined">
            Download with current data
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          Fill the <b>Template</b> sheet in Excel (see the <b>Instructions</b> sheet for allowed values). Rows are matched by <b>{(dataset.columns.find((c) => c.key === dataset.matchKey) || {}).label}</b> — a match updates the record, otherwise it's created new.
        </Typography>

        {/* Step 2 — upload */}
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>2 · Upload the filled file</Typography>
        <Paper
          variant="outlined"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          sx={{
            borderStyle: "dashed", borderWidth: 2, borderRadius: 2, p: 3, textAlign: "center", cursor: "pointer",
            borderColor: dragOver ? "primary.main" : "divider", bgcolor: dragOver ? alpha(theme.palette.primary.main, 0.04) : "transparent",
          }}
        >
          <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => handleFile(e.target.files?.[0])} />
          {busy === "parse" ? <CircularProgress size={24} /> : <CloudUploadOutlined sx={{ fontSize: 32, color: "text.secondary" }} />}
          <Typography variant="body2" sx={{ mt: 1 }}>
            {busy === "parse" ? "Reading…" : fileName ? fileName : dragOver ? "Drop to read" : "Drag & drop, or click to choose a file"}
          </Typography>
        </Paper>

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

        {/* Step 3 — preview */}
        {summary && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>3 · Review</Typography>
            <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(4,1fr)" }, mb: 1.5 }}>
              <StatCard label="Rows" value={summary.total} icon={CloudUploadOutlined} accent={theme.palette.text.secondary} />
              <StatCard label="New" value={summary.new} icon={AddCircleOutline} accent={theme.palette.success.main} />
              <StatCard label="Update" value={summary.update} icon={ChangeCircleOutlined} accent={theme.palette.info.main} />
              <StatCard label="Skipped" value={summary.invalid} icon={ErrorOutline} accent={theme.palette.error.main} />
            </Box>
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5, maxHeight: 320 }}>
              <Table size="small" stickyHeader>
                <TableHead><TableRow>
                  <TableCell sx={{ fontWeight: 700, width: 90 }}>Status</TableCell>
                  {previewCols.map((c) => <TableCell key={c.key} sx={{ fontWeight: 700 }}>{c.label}</TableCell>)}
                  <TableCell sx={{ fontWeight: 700 }}>Issues</TableCell>
                </TableRow></TableHead>
                <TableBody>
                  {analyzed.slice(0, 200).map((a) => (
                    <TableRow key={a.i} sx={{ bgcolor: a.status === "invalid" ? alpha(theme.palette.error.main, 0.05) : "inherit" }}>
                      <TableCell>{statusChip(a.status)}</TableCell>
                      {previewCols.map((c) => <TableCell key={c.key} sx={{ whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{a.rec[c.key] == null || a.rec[c.key] === "__invalid__" ? "—" : String(a.rec[c.key])}</TableCell>)}
                      <TableCell>
                        <Typography variant="caption" color={a.errors.length ? "error" : "text.secondary"}>
                          {[...a.errors, ...a.warnings].join("; ") || (a.status === "update" ? "matches existing" : "")}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {summary.invalid > 0 && <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>{summary.invalid} row(s) will be skipped (fix the issues and re-upload to include them).</Typography>}
          </Box>
        )}

        {busy === "apply" && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress variant="determinate" value={progress.total ? (progress.done / progress.total) * 100 : 0} />
            <Typography variant="caption" color="text.secondary">Importing {progress.done}/{progress.total}…</Typography>
          </Box>
        )}

        {result && (
          <Alert severity={result.errors?.length ? "warning" : "success"} sx={{ mt: 2 }}>
            Done — {result.created} created, {result.updated} updated{result.errors?.length ? `, ${result.errors.length} failed` : ""}.
            {result.errors?.length ? (
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
                {result.errors.slice(0, 8).map((e, i) => <li key={i}><Typography variant="caption">{e.label}: {e.message}</Typography></li>)}
              </Box>
            ) : null}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy === "apply"}>{result ? "Close" : "Cancel"}</Button>
        {!result && (
          <Button onClick={apply} variant="contained" disabled={busy === "apply" || !validItems.length}
            startIcon={busy === "apply" ? <CircularProgress size={16} /> : <CheckCircleOutline />}>
            Apply {validItems.length ? `(${validItems.length})` : ""}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
