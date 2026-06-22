// One-click CRM Action Report — internal ERP view + PDF/Excel/CSV/Print export.
// Data + derivations live in services/reporting/crmReport.js; export rendering
// in services/reporting/reportEngine.js. This file is presentation only.
import React, { useState, useEffect, useCallback } from "react";
import {
  Dialog, AppBar, Toolbar, Typography, IconButton, Box, Button, Chip, Stack,
  Grid, Card, CardContent, Table, TableHead, TableRow, TableCell, TableBody,
  CircularProgress, Alert, TextField, Divider, Tooltip, useTheme, alpha,
} from "@mui/material";
import {
  Close as CloseIcon,
  PictureAsPdf as PdfIcon,
  GridOn as ExcelIcon,
  Description as CsvIcon,
  Print as PrintIcon,
  AutoAwesome as AiIcon,
  Refresh as RefreshIcon,
  WarningAmberRounded as WarnIcon,
} from "@mui/icons-material";
import { buildCrmActionReport, rangeFor } from "../../services/reporting/crmReport";
import { exportReport } from "../../services/reporting/reportEngine";

const RANGE_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "custom", label: "Custom" },
];

const statusColor = (theme, status) => {
  switch (status) {
    case "Action Required": return { bg: alpha(theme.palette.error.main, 0.12), fg: theme.palette.error.main };
    case "Overdue": return { bg: alpha(theme.palette.error.main, 0.12), fg: theme.palette.error.main };
    case "Due Today": return { bg: alpha(theme.palette.warning.main, 0.16), fg: theme.palette.warning.dark };
    case "In Progress": return { bg: alpha(theme.palette.info.main, 0.12), fg: theme.palette.info.main };
    case "Inactive": return { bg: alpha(theme.palette.text.disabled, 0.12), fg: theme.palette.text.disabled };
    default: return { bg: alpha(theme.palette.success.main, 0.12), fg: theme.palette.success.main };
  }
};

export default function CrmReportDialog({ open, onClose }) {
  const theme = useTheme();
  const [rangeKey, setRangeKey] = useState("month");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const range = rangeFor(rangeKey, custom);
      const rep = await buildCrmActionReport({ range });
      setReport(rep);
    } catch (e) {
      setError(e?.message || "Failed to generate the report.");
    } finally {
      setLoading(false);
    }
  }, [rangeKey, custom]);

  // Auto-generate when opened, and whenever a non-custom range is picked.
  useEffect(() => {
    if (!open) return;
    if (rangeKey === "custom" && (!custom.from || !custom.to)) return;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rangeKey, custom.from, custom.to]);

  const doExport = (fmt) => report && exportReport(report, fmt);

  return (
    <Dialog fullScreen open={open} onClose={onClose}>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: "background.paper", color: "text.primary", borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Toolbar sx={{ gap: 2, flexWrap: "wrap" }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flex: 1, minWidth: 200 }}>
            <AiIcon color="primary" />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1 }}>CRM Action Report</Typography>
              <Typography variant="caption" color="text.secondary">
                {report ? `Generated ${report.generatedAt.toLocaleString()} · ${report.dateRange.label}` : "Live pipeline snapshot"}
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            <Tooltip title="Download PDF"><span><Button size="small" startIcon={<PdfIcon />} disabled={!report} onClick={() => doExport("pdf")}>PDF</Button></span></Tooltip>
            <Tooltip title="Download Excel"><span><Button size="small" startIcon={<ExcelIcon />} disabled={!report} onClick={() => doExport("excel")}>Excel</Button></span></Tooltip>
            <Tooltip title="Download CSV"><span><Button size="small" startIcon={<CsvIcon />} disabled={!report} onClick={() => doExport("csv")}>CSV</Button></span></Tooltip>
            <Tooltip title="Print"><span><Button size="small" startIcon={<PrintIcon />} disabled={!report} onClick={() => doExport("print")}>Print</Button></span></Tooltip>
            <IconButton onClick={onClose} edge="end"><CloseIcon /></IconButton>
          </Stack>
        </Toolbar>

        {/* Date quick filters */}
        <Toolbar variant="dense" sx={{ gap: 1, flexWrap: "wrap", pb: 1 }}>
          {RANGE_OPTIONS.map((o) => (
            <Chip
              key={o.key}
              label={o.label}
              color={rangeKey === o.key ? "primary" : "default"}
              variant={rangeKey === o.key ? "filled" : "outlined"}
              onClick={() => setRangeKey(o.key)}
              size="small"
            />
          ))}
          {rangeKey === "custom" && (
            <>
              <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </>
          )}
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="contained" startIcon={<RefreshIcon />} onClick={generate} disabled={loading}>
            {loading ? "Generating…" : "Generate report"}
          </Button>
        </Toolbar>
      </AppBar>

      <Box sx={{ p: { xs: 1.5, md: 3 }, bgcolor: "background.default", minHeight: "100%" }}>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        {loading && !report && (
          <Stack alignItems="center" sx={{ py: 10 }} spacing={2}>
            <CircularProgress />
            <Typography color="text.secondary">Pulling the live pipeline…</Typography>
          </Stack>
        )}

        {report && (
          <>
            {/* KPI cards */}
            <Grid container spacing={1.5} sx={{ mb: 2 }}>
              {report.kpis.map((k) => (
                <Grid item xs={6} sm={4} md={3} lg={1.5} key={k.label}>
                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent sx={{ py: 1.25, "&:last-child": { pb: 1.25 } }}>
                      <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, fontSize: "0.62rem" }}>
                        {k.label}
                      </Typography>
                      <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }}>{k.value}</Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>

            {/* AI summary */}
            {report.narrative && (
              <Card variant="outlined" sx={{ mb: 2, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.05), borderColor: alpha(theme.palette.primary.main, 0.25) }}>
                <CardContent>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    <AiIcon fontSize="small" color="primary" />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>AI Summary</Typography>
                  </Stack>
                  <Typography variant="body2">{report.narrative}</Typography>
                </CardContent>
              </Card>
            )}

            {/* Recommended actions */}
            {report.actions?.length > 0 && (
              <Card variant="outlined" sx={{ mb: 2, borderRadius: 2 }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>What should be done next</Typography>
                  <Stack spacing={0.5}>
                    {report.actions.map((a, i) => (
                      <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                        <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "primary.main", mt: "7px", flexShrink: 0 }} />
                        <Typography variant="body2">{a}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            )}

            {/* Sections as tables */}
            {report.sections.map((sec) => (
              <Card key={sec.key} variant="outlined" sx={{ mb: 2, borderRadius: 2, overflow: "hidden" }}>
                <Box sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${theme.palette.divider}`, display: "flex", alignItems: "center", gap: 1 }}>
                  {sec.key === "attention" && <WarnIcon fontSize="small" color="warning" />}
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{sec.title}</Typography>
                  <Chip size="small" label={sec.rows.length} sx={{ height: 20 }} />
                </Box>
                <Box sx={{ overflowX: "auto" }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        {sec.columns.map((c) => (
                          <TableCell key={c.key} sx={{ fontWeight: 700, whiteSpace: "nowrap", fontSize: "0.72rem", bgcolor: "background.paper" }}>{c.label}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sec.rows.length === 0 ? (
                        <TableRow><TableCell colSpan={sec.columns.length} sx={{ textAlign: "center", color: "text.secondary", py: 3 }}>{sec.emptyText}</TableCell></TableRow>
                      ) : (
                        sec.rows.map((row, i) => (
                          <TableRow key={i} hover>
                            {sec.columns.map((c) => (
                              <TableCell key={c.key} sx={{ fontSize: "0.76rem", whiteSpace: c.key === "company" ? "nowrap" : "normal" }}>
                                {c.key === "status" ? (
                                  <Chip size="small" label={row[c.key]} sx={{ height: 20, fontSize: "0.66rem", fontWeight: 700, bgcolor: statusColor(theme, row[c.key]).bg, color: statusColor(theme, row[c.key]).fg }} />
                                ) : c.key === "type" ? (
                                  <Chip size="small" variant="outlined" label={row[c.key]} sx={{ height: 20, fontSize: "0.66rem" }} />
                                ) : (
                                  row[c.key]
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </Box>
              </Card>
            ))}

            <Divider sx={{ my: 2 }} />
            <Typography variant="caption" color="text.secondary">
              Snapshot of the live CRM pipeline. The auto summary is generated from the figures above (heuristic, not an external model).
            </Typography>
          </>
        )}
      </Box>
    </Dialog>
  );
}
