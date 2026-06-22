// Employee CSV / Excel bulk import — upload, preview, validate, import.
// Parsing/validation is in employeeImport.js (pure, tested). The actual inserts
// are delegated to `onRunImport(records, opts)` (implemented in the page with
// rbacService), so this component stays presentational.
import React, { useState, useMemo, useRef } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Stack, Chip, Table, TableHead, TableRow, TableCell, TableBody, Alert,
  FormControlLabel, Checkbox, LinearProgress, Link, IconButton, useTheme, alpha,
} from "@mui/material";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import * as XLSX from "xlsx";
import { parseEmployeesCsv } from "./employeeImport";

const TEMPLATE = "Employee ID,Name,Department,Designation,Reporting Manager,Mobile,Email,Status\n" +
  "EMP01,Ravi Sharma,Production,Plant Head,,9000000001,ravi@example.com,Active\n";

export default function EmployeeImportDialog({ open, onClose, existingEmployees = [], onRunImport, onDone }) {
  const theme = useTheme();
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState(null);   // result of parseEmployeesCsv
  const [error, setError] = useState(null);
  const [markTest, setMarkTest] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);    // { created, failed, errors[] }

  const existingEmails = useMemo(
    () => new Set((existingEmployees || []).map((e) => String(e.email || "").toLowerCase()).filter(Boolean)),
    [existingEmployees]
  );

  const reset = () => { setFileName(""); setParsed(null); setError(null); setResult(null); setRunning(false); setMarkTest(false); };
  const close = () => { reset(); onClose?.(); };

  const handleFile = async (file) => {
    if (!file) return;
    setError(null); setResult(null);
    setFileName(file.name);
    try {
      let text;
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        text = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
      } else {
        text = await file.text();
      }
      const res = parseEmployeesCsv(text, existingEmails);
      if (!res.records.length) setError("No data rows found. Check the file has a header row + at least one record.");
      if (!Object.values(res.mapped).includes("email")) setError("Couldn't find an Email column. A header like 'Email' is required.");
      setParsed(res);
    } catch (e) {
      setError(e?.message || "Could not read the file.");
      setParsed(null);
    }
  };

  const validRecords = parsed?.records.filter((r) => r._valid) || [];

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "employee_import_template.csv"; a.click();
    URL.revokeObjectURL(a.href);
  };

  const runImport = async () => {
    if (!validRecords.length || !onRunImport) return;
    setRunning(true); setError(null);
    try {
      const rows = validRecords.map(({ _row, _issues, _valid, ...fields }) => ({
        ...fields,
        full_name: markTest ? `TEST — ${fields.full_name}` : fields.full_name,
      }));
      const res = await onRunImport(rows, { markTest });
      setResult(res);
      onDone?.();
    } catch (e) {
      setError(e?.message || "Import failed.");
    } finally {
      setRunning(false);
    }
  };

  const statusChip = (n, label, color) => (
    <Chip size="small" label={`${n} ${label}`} color={n ? color : "default"} variant={n ? "filled" : "outlined"} />
  );

  return (
    <Dialog open={open} onClose={running ? undefined : close} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <UploadFileOutlinedIcon color="primary" /> Import employees
        <Box sx={{ flex: 1 }} />
        {!running && <IconButton size="small" onClick={close}><CloseIcon fontSize="small" /></IconButton>}
      </DialogTitle>
      <DialogContent dividers>
        {result ? (
          <Alert severity={result.failed ? "warning" : "success"} sx={{ mb: 1 }}>
            Imported <b>{result.created}</b> employee{result.created === 1 ? "" : "s"}
            {result.failed ? <> · <b>{result.failed}</b> failed</> : null}.
            {result.errors?.length ? (
              <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2 }}>
                {result.errors.slice(0, 5).map((er, i) => <li key={i}><Typography variant="caption">{er}</Typography></li>)}
              </Box>
            ) : null}
          </Alert>
        ) : (
          <>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, flexWrap: "wrap" }}>
              <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={() => fileRef.current?.click()}>
                Choose CSV / Excel
              </Button>
              <input
                ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" hidden
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              {fileName && <Typography variant="body2" color="text.secondary">{fileName}</Typography>}
              <Box sx={{ flex: 1 }} />
              <Link component="button" type="button" variant="body2" onClick={downloadTemplate}>Download template</Link>
            </Stack>

            {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}

            {parsed && (
              <>
                <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: "wrap" }} useFlexGap>
                  {statusChip(parsed.summary.total, "rows", "default")}
                  {statusChip(parsed.summary.valid, "ready", "success")}
                  {statusChip(parsed.summary.duplicate, "duplicate", "warning")}
                  {statusChip(parsed.summary.invalid, "invalid", "error")}
                </Stack>

                <Box sx={{ maxHeight: 320, overflow: "auto", border: `1px solid ${theme.palette.divider}`, borderRadius: 1 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 36 }} />
                        <TableCell>Name</TableCell>
                        <TableCell>Email</TableCell>
                        <TableCell>Dept</TableCell>
                        <TableCell>Designation</TableCell>
                        <TableCell>Issue</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {parsed.records.slice(0, 50).map((r) => (
                        <TableRow key={r._row} sx={{ bgcolor: r._valid ? "transparent" : alpha(theme.palette.error.main, 0.05) }}>
                          <TableCell>
                            {r._valid
                              ? <CheckCircleIcon sx={{ fontSize: 16, color: "success.main" }} />
                              : <ErrorOutlineIcon sx={{ fontSize: 16, color: "error.main" }} />}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>{markTest && r._valid ? `TEST — ${r.full_name}` : r.full_name || "—"}</TableCell>
                          <TableCell>{r.email || "—"}</TableCell>
                          <TableCell>{r.department || "—"}</TableCell>
                          <TableCell>{r.designation || "—"}</TableCell>
                          <TableCell><Typography variant="caption" color="error">{r._issues.join(", ")}</Typography></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>

                <FormControlLabel
                  sx={{ mt: 1 }}
                  control={<Checkbox checked={markTest} onChange={(e) => setMarkTest(e.target.checked)} />}
                  label={<Typography variant="body2">Mark these as TEST records (prefixes each name with “TEST —” for easy cleanup)</Typography>}
                />
              </>
            )}

            {running && <LinearProgress sx={{ mt: 2 }} />}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {result ? (
          <Button variant="contained" onClick={close}>Done</Button>
        ) : (
          <>
            <Button onClick={close} disabled={running}>Cancel</Button>
            <Button variant="contained" onClick={runImport} disabled={!validRecords.length || running}>
              {running ? "Importing…" : `Import ${validRecords.length} employee${validRecords.length === 1 ? "" : "s"}`}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
