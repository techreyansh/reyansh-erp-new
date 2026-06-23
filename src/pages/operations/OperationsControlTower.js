// Operations Control Tower — single command view over the order-to-cash flow.
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container, Box, Stack, Typography, Grid, Card, CardContent, Chip, CircularProgress,
  Alert, Snackbar, Button, Divider, LinearProgress,
} from '@mui/material';
import InsightsOutlined from '@mui/icons-material/InsightsOutlined';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import ops from '../../services/operationsControlService';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const inrK = (n) => { const v = Number(n || 0); return v >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L` : inr(v); };
const SEV = { high: { color: 'error', Icon: ErrorOutlineRounded }, med: { color: 'warning', Icon: WarningAmberRounded }, low: { color: 'info', Icon: WarningAmberRounded } };

export default function OperationsControlTower() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await ops.fetchOperations()); }
    catch (e) { setSnack({ message: e.message || 'Failed', severity: 'error' }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const maxFunnel = data ? Math.max(1, ...data.funnel.map((f) => f.count)) : 1;

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <InsightsOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Operations Control Tower</Typography>
        <Chip size="small" variant="outlined" label="order → cash" color="primary" />
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" startIcon={<RefreshRounded />} onClick={load} disabled={loading}>Refresh</Button>
      </Stack>

      {loading || !data ? <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={28} /></Stack> : (
        <Stack spacing={2}>
          {/* Money flow */}
          <Grid container spacing={1.5}>
            {[
              ['Order backlog', data.money.orderBacklogValue, 'primary', `${data.counts.openOrders} open orders`],
              ['Invoiced', data.money.invoicedValue, 'info', `${data.counts.openInvoices} open invoices`],
              ['Collected', data.money.collectedValue, 'success', 'received to date'],
              ['Outstanding', data.money.outstandingValue, 'error', 'awaiting collection'],
            ].map(([label, val, color, sub]) => (
              <Grid item xs={6} sm={3} key={label}>
                <Card variant="outlined" sx={{ borderRadius: 2, borderColor: `${color}.main`, borderTopWidth: 3 }}>
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.6rem' }}>{label}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: `${color}.main` }}>{inrK(val)}</Typography>
                    <Typography variant="caption" color="text.secondary">{sub}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          <Grid container spacing={2}>
            {/* Funnel */}
            <Grid item xs={12} md={7}>
              <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Order pipeline</Typography>
                  <Stack spacing={1.25}>
                    {data.funnel.map((f) => (
                      <Box key={f.key}>
                        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{f.label}</Typography>
                          <Typography variant="caption" color="text.secondary">{f.count} · {inrK(f.value)}</Typography>
                        </Stack>
                        <LinearProgress variant="determinate" value={(f.count / maxFunnel) * 100} sx={{ height: 8, borderRadius: 1 }} />
                      </Box>
                    ))}
                  </Stack>
                  {data.cancelled > 0 && <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>{data.cancelled} cancelled (excluded)</Typography>}
                  <Divider sx={{ my: 1.5 }} />
                  <Stack direction="row" spacing={2} flexWrap="wrap">
                    {[['Open orders', data.counts.openOrders, '/sales-orders'], ['Open demands', data.counts.openDemands, '/production-demand'], ['Dispatches due', data.counts.upcomingDispatches, '/dispatch-control']].map(([l, v, link]) => (
                      <Box key={l} sx={{ cursor: 'pointer' }} onClick={() => navigate(link)}>
                        <Typography variant="h6" sx={{ fontWeight: 800 }}>{v}</Typography>
                        <Typography variant="caption" color="text.secondary">{l}</Typography>
                      </Box>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            {/* Attention rail */}
            <Grid item xs={12} md={5}>
              <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Needs attention now</Typography>
                    <Chip size="small" label={data.attention.length} color={data.attention.length ? 'error' : 'success'} sx={{ fontWeight: 700 }} />
                  </Stack>
                  {data.attention.length === 0 ? (
                    <Alert severity="success" sx={{ borderRadius: 2 }}>All clear — no overdue dispatches, payments, shortfalls, or pending invoices.</Alert>
                  ) : (
                    <Stack spacing={1}>
                      {data.attention.map((a) => {
                        const sev = SEV[a.severity] || SEV.med;
                        return (
                          <Box key={a.code} onClick={() => navigate(a.link)}
                            sx={{ cursor: 'pointer', p: 1.25, borderRadius: 2, border: '1px solid', borderColor: `${sev.color}.main`, display: 'flex', alignItems: 'center', gap: 1, '&:hover': { bgcolor: 'action.hover' } }}>
                            <sev.Icon color={sev.color} fontSize="small" />
                            <Box sx={{ flexGrow: 1 }}>
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>{a.label}</Typography>
                              <Typography variant="caption" color="text.secondary">{a.detail}</Typography>
                            </Box>
                            <Chip size="small" label={a.count} color={sev.color} />
                            <ChevronRightRounded fontSize="small" color="action" />
                          </Box>
                        );
                      })}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Stack>
      )}

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
