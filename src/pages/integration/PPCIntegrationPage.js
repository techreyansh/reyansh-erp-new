import React, { useCallback, useEffect, useState } from "react";
import {
  Box, Container, Typography, Paper, Grid, Chip, Button, Stack, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  CircularProgress, Alert, Tooltip,
} from "@mui/material";
import {
  Sync as SyncIcon, CloudDone, CloudOff, Refresh, ArrowUpward, ArrowDownward,
} from "@mui/icons-material";
import ppcIntegrationService from "../../services/ppcIntegrationService";

// ERP-side control panel for the PPC ↔ ERP integration (Spec v1.0).
// Shows health, sync audit log, watermarks and a manual master-push.
const statusColor = (s) => ({ success: "success", failure: "error", retry: "warning", dead_letter: "error" }[s] || "default");

const ENDPOINTS = [
  { m: "GET", p: "/customers?since=", d: "Customer master delta (clients2)" },
  { m: "GET", p: "/items?since=", d: "Item master delta (products)" },
  { m: "GET", p: "/suppliers?since=", d: "Supplier master delta (vendors)" },
  { m: "GET", p: "/stock-balance/:code", d: "Current on-hand by item" },
  { m: "POST", p: "/invoices", d: "Invoice from a PPC dispatch" },
  { m: "POST", p: "/purchase-orders", d: "PO from a PPC indent" },
  { m: "POST", p: "/stock-journals", d: "Stock Issue / GRN / FG Receipt" },
  { m: "GET", p: "/health", d: "Liveness probe (no auth)" },
];

const StatCard = ({ label, value, sub, icon }) => (
  <Paper sx={{ p: 2, borderRadius: 2, height: "100%" }} elevation={0} variant="outlined">
    <Stack direction="row" spacing={1.5} alignItems="center">
      {icon}
      <Box>
        <Typography variant="h5" fontWeight={700}>{value}</Typography>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        {sub && <Typography variant="caption" display="block" color="text.secondary">{sub}</Typography>}
      </Box>
    </Stack>
  </Paper>
);

const PPCIntegrationPage = () => {
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState(null);
  const [log, setLog] = useState([]);
  const [state, setState] = useState([]);
  const [counts, setCounts] = useState({});
  const [emitting, setEmitting] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, l, s, c] = await Promise.all([
        ppcIntegrationService.health().catch((e) => ({ ok: false, error: e.message })),
        ppcIntegrationService.getSyncLog({ limit: 100 }).catch(() => []),
        ppcIntegrationService.getSyncState().catch(() => []),
        ppcIntegrationService.getInboundCounts().catch(() => ({})),
      ]);
      setHealth(h); setLog(l); setState(s); setCounts(c);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const emit = async (entity) => {
    setEmitting(entity); setNotice(null);
    try {
      const r = await ppcIntegrationService.emitMasters(entity, { all: true });
      setNotice({ type: r?.failed ? "warning" : "success", msg: `Pushed ${entity}: ${r?.ok ?? 0} ok, ${r?.failed ?? 0} failed.` });
      load();
    } catch (e) {
      setNotice({ type: "error", msg: `Push ${entity} failed: ${e.message}. (Configure PPC_BASE_URL / PPC_OUTBOUND_API_KEY / PPC_WEBHOOK_SECRET on the ppc-emit function.)` });
    } finally {
      setEmitting(null);
    }
  };

  const ok = health?.ok;

  return (
    <Container maxWidth="xl">
      <Box sx={{ py: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
          <Box>
            <Typography variant="h4" fontWeight={800}>PPC ↔ ERP Integration</Typography>
            <Typography variant="body2" color="text.secondary">
              The ERP's side of the integration contract — masters out, production documents in. (Spec v1.0)
            </Typography>
          </Box>
          <Button startIcon={<Refresh />} onClick={load} disabled={loading}>Refresh</Button>
        </Stack>

        {notice && <Alert severity={notice.type} sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice.msg}</Alert>}

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>
        ) : (
          <>
            <Grid container spacing={2} mb={2}>
              <Grid item xs={12} sm={6} md={3}>
                <StatCard
                  label="Integration endpoint"
                  value={ok ? "Online" : "Offline"}
                  sub={health?.time ? new Date(health.time).toLocaleString() : health?.error}
                  icon={ok ? <CloudDone color="success" /> : <CloudOff color="error" />}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <StatCard label="Invoices received" value={counts.ppc_invoices ?? 0} icon={<ArrowDownward color="primary" />} />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <StatCard label="POs received" value={counts.ppc_purchase_orders ?? 0} icon={<ArrowDownward color="primary" />} />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <StatCard label="Stock vouchers" value={counts.ppc_stock_journals ?? 0} icon={<ArrowDownward color="primary" />} />
              </Grid>
            </Grid>

            <Grid container spacing={2}>
              {/* Manual master push */}
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, borderRadius: 2, height: "100%" }} variant="outlined" elevation={0}>
                  <Typography variant="subtitle1" fontWeight={700} gutterBottom>Push masters to PPC</Typography>
                  <Typography variant="caption" color="text.secondary">
                    ERP is authoritative for masters. Use these to seed or re-sync PPC (the 15-min poll is the fallback).
                  </Typography>
                  <Stack spacing={1} mt={2}>
                    {["customer", "item", "supplier"].map((e) => (
                      <Button key={e} variant="outlined" startIcon={emitting === e ? <CircularProgress size={16} /> : <ArrowUpward />}
                        disabled={!!emitting} onClick={() => emit(e)} sx={{ justifyContent: "flex-start" }}>
                        Sync all {e}s
                      </Button>
                    ))}
                  </Stack>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>Watermarks</Typography>
                  {state.length === 0 ? <Typography variant="caption" color="text.secondary">No syncs yet.</Typography> : (
                    <Stack spacing={0.5}>
                      {state.map((s) => (
                        <Stack key={s.entity} direction="row" justifyContent="space-between">
                          <Typography variant="caption">{s.entity}</Typography>
                          <Typography variant="caption" color="text.secondary">{new Date(s.last_synced_at).toLocaleString()}</Typography>
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </Paper>
              </Grid>

              {/* Endpoint reference */}
              <Grid item xs={12} md={8}>
                <Paper sx={{ p: 2, borderRadius: 2, height: "100%" }} variant="outlined" elevation={0}>
                  <Typography variant="subtitle1" fontWeight={700} gutterBottom>API endpoints (base: /functions/v1/ppc-integration)</Typography>
                  <Typography variant="caption" color="text.secondary">PPC authenticates with the <code>X-API-Key</code> header. POSTs honour <code>Idempotency-Key</code>.</Typography>
                  <TableContainer sx={{ mt: 1 }}>
                    <Table size="small">
                      <TableBody>
                        {ENDPOINTS.map((e) => (
                          <TableRow key={e.p}>
                            <TableCell sx={{ width: 60 }}><Chip size="small" label={e.m} color={e.m === "GET" ? "info" : "secondary"} /></TableCell>
                            <TableCell><code>{e.p}</code></TableCell>
                            <TableCell><Typography variant="caption" color="text.secondary">{e.d}</Typography></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              </Grid>

              {/* Sync log */}
              <Grid item xs={12}>
                <Paper sx={{ p: 2, borderRadius: 2 }} variant="outlined" elevation={0}>
                  <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                    <SyncIcon fontSize="small" sx={{ verticalAlign: "middle", mr: 0.5 }} /> Sync log (last 100)
                  </Typography>
                  {log.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>No sync activity yet.</Typography>
                  ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Time</TableCell>
                            <TableCell>Dir</TableCell>
                            <TableCell>Entity</TableCell>
                            <TableCell>PPC ref</TableCell>
                            <TableCell>ERP ref</TableCell>
                            <TableCell>HTTP</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell align="right">ms</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {log.map((r) => (
                            <TableRow key={r.id} hover>
                              <TableCell><Typography variant="caption">{new Date(r.created_at).toLocaleString()}</Typography></TableCell>
                              <TableCell>
                                <Tooltip title={r.direction}>
                                  {r.direction === "inbound" ? <ArrowDownward fontSize="inherit" /> : <ArrowUpward fontSize="inherit" />}
                                </Tooltip>
                              </TableCell>
                              <TableCell>{r.entity}</TableCell>
                              <TableCell><Typography variant="caption">{r.ppc_ref || "—"}</Typography></TableCell>
                              <TableCell><Typography variant="caption">{r.erp_ref || "—"}</Typography></TableCell>
                              <TableCell>{r.http_status || "—"}</TableCell>
                              <TableCell><Chip size="small" label={r.status} color={statusColor(r.status)} /></TableCell>
                              <TableCell align="right"><Typography variant="caption">{r.duration_ms ?? "—"}</Typography></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Paper>
              </Grid>
            </Grid>
          </>
        )}
      </Box>
    </Container>
  );
};

export default PPCIntegrationPage;
