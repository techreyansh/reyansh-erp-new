import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  Link,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import {
  Inventory2Outlined,
  WarningAmberOutlined,
  TrendingUpOutlined,
  AccessTimeOutlined,
  AddShoppingCartOutlined,
  StorefrontOutlined,
} from '@mui/icons-material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import ppcService from '../../services/ppcService';

// ---------------------------------------------------------------------------
// Small presentational helpers (mirrors CRMDashboard's StatCard/Panel/Empty)
// ---------------------------------------------------------------------------
function StatCard({ label, value, sub, icon: Icon, accent }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2.5, height: '100%' }}>
      <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              {label}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5, lineHeight: 1.15 }}>
              {value}
            </Typography>
            {sub && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                {sub}
              </Typography>
            )}
          </Box>
          <Box sx={{ p: 1, borderRadius: 2, bgcolor: `${accent}1a`, color: accent, display: 'flex' }}>
            <Icon />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

function Panel({ title, subtitle, children, action }) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 1.5, sm: 2 }, display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{title}</Typography>
          {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
        </Box>
        {action}
      </Stack>
      {children}
    </Paper>
  );
}

const Empty = ({ label = 'No data yet' }) => (
  <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 160, color: 'text.disabled', textAlign: 'center', px: 2 }}>
    <Typography variant="body2">{label}</Typography>
  </Stack>
);

const num = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN'));

export default function InventoryDashboard() {
  const theme = useTheme();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [reorder, setReorder] = useState([]);
  const [excess, setExcess] = useState([]);
  const [stock, setStock] = useState([]);
  const [items, setItems] = useState([]);

  // Link-vendor dialog + snackbar -----------------------------------------
  const emptyVendorForm = {
    vendor_name: '',
    vendor_code: '',
    lead_time_days: 7,
    unit_cost: '',
    moq: '',
    is_preferred: true,
  };
  const [vendorDialog, setVendorDialog] = useState({ open: false, row: null });
  const [vendorForm, setVendorForm] = useState(emptyVendorForm);
  const [savingVendor, setSavingVendor] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const loadBoards = async () => {
    const [r, e, s, it] = await Promise.all([
      ppcService.reorderBoard().catch(() => []),
      ppcService.excessStock(120).catch(() => []),
      ppcService.listStock().catch(() => []),
      ppcService.listItems().catch(() => []),
    ]);
    setReorder(Array.isArray(r) ? r : []);
    setExcess(Array.isArray(e) ? e : []);
    setStock(Array.isArray(s) ? s : []);
    setItems(Array.isArray(it) ? it : []);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [r, e, s, it] = await Promise.all([
          ppcService.reorderBoard().catch(() => []),
          ppcService.excessStock(120).catch(() => []),
          ppcService.listStock().catch(() => []),
          ppcService.listItems().catch(() => []),
        ]);
        if (!active) return;
        setReorder(Array.isArray(r) ? r : []);
        setExcess(Array.isArray(e) ? e : []);
        setStock(Array.isArray(s) ? s : []);
        setItems(Array.isArray(it) ? it : []);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Open the Link Vendor dialog for a given reorder row. Pre-fills from the
  // row when a vendor is already linked (so the same dialog edits it).
  const openVendorDialog = (row) => {
    setVendorForm({
      vendor_name: row.vendor_name || '',
      vendor_code: row.vendor_code || '',
      lead_time_days: row.vendor_lead_time != null ? row.vendor_lead_time : 7,
      unit_cost: row.vendor_unit_cost != null ? row.vendor_unit_cost : '',
      moq: '',
      is_preferred: true,
    });
    setVendorDialog({ open: true, row });
  };

  const closeVendorDialog = () => {
    if (savingVendor) return;
    setVendorDialog({ open: false, row: null });
  };

  const handleVendorSubmit = async () => {
    const row = vendorDialog.row;
    if (!row || !vendorForm.vendor_name.trim()) {
      setSnackbar({ open: true, message: 'Vendor name is required', severity: 'error' });
      return;
    }
    setSavingVendor(true);
    try {
      await ppcService.upsertItemVendor({
        item_id: row.item_id,
        vendor_name: vendorForm.vendor_name,
        vendor_code: vendorForm.vendor_code,
        lead_time_days: vendorForm.lead_time_days,
        unit_cost: vendorForm.unit_cost,
        moq: vendorForm.moq,
        is_preferred: vendorForm.is_preferred,
      });
      setVendorDialog({ open: false, row: null });
      await loadBoards();
      setSnackbar({
        open: true,
        message: `Vendor "${vendorForm.vendor_name.trim()}" linked to ${row.code || 'item'}`,
        severity: 'success',
      });
    } catch (err) {
      setSnackbar({
        open: true,
        message: 'Could not link vendor: ' + (err?.message || 'Unknown error'),
        severity: 'error',
      });
    } finally {
      setSavingVendor(false);
    }
  };

  // KPIs -------------------------------------------------------------------
  const avgCover = useMemo(() => {
    const vals = reorder
      .map((r) => r?.days_of_cover)
      .filter((v) => v != null && !Number.isNaN(Number(v)))
      .map(Number);
    if (!vals.length) return '—';
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [reorder]);

  // Chart data -------------------------------------------------------------
  const shortageChart = useMemo(
    () =>
      [...reorder]
        .filter((r) => Number(r?.shortage) > 0)
        .sort((a, b) => Number(b.shortage) - Number(a.shortage))
        .slice(0, 12)
        .map((r) => ({ code: r.code || '—', value: Number(r.shortage) || 0 })),
    [reorder]
  );

  // Fallback chart: on-hand by item code (top 12) when there are no shortages.
  const onHandChart = useMemo(
    () =>
      [...stock]
        .map((s) => ({ code: s?.item?.code || '—', value: Number(s?.on_hand) || 0 }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    [stock]
  );

  const usingShortageChart = shortageChart.length > 0;
  const chartData = usingShortageChart ? shortageChart : onHandChart;
  const chartColor = usingShortageChart ? theme.palette.error.main : theme.palette.primary.main;
  const axis = { fontSize: 12, fill: theme.palette.text.secondary };
  const grid = theme.palette.divider;

  if (loading) {
    return (
      <Box>
        <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4,1fr)' } }}>
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} variant="rounded" height={96} />
          ))}
        </Box>
        <Skeleton variant="rounded" height={280} sx={{ mb: 3 }} />
        <Skeleton variant="rounded" height={240} />
      </Box>
    );
  }

  const kpiCards = [
    {
      label: 'Total Stock Items',
      value: num(items.length || stock.length),
      sub: 'In PPC store',
      icon: Inventory2Outlined,
      accent: theme.palette.primary.main,
    },
    {
      label: 'Shortages',
      value: num(reorder.length),
      sub: 'At / below reorder point',
      icon: WarningAmberOutlined,
      accent: theme.palette.error.main,
    },
    {
      label: 'Excess Items',
      value: num(excess.length),
      sub: 'Slow-moving / overstock',
      icon: TrendingUpOutlined,
      accent: theme.palette.warning.main,
    },
    {
      label: 'Avg Days of Cover',
      value: avgCover === '—' ? '—' : `${avgCover}d`,
      sub: 'Across shortage items',
      icon: AccessTimeOutlined,
      accent: theme.palette.success.main,
    },
  ];

  return (
    <Box>
      {/* KPI row */}
      <Box sx={{ display: 'grid', gap: 2, mb: 3, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4,1fr)' } }}>
        {kpiCards.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
      </Box>

      {/* Shortage chart */}
      <Box sx={{ mb: 3 }}>
        <Panel
          title={usingShortageChart ? 'Top Shortages' : 'On-hand by Item'}
          subtitle={
            usingShortageChart
              ? 'Shortage quantity for the most-depleted items'
              : 'No shortages — showing current stock levels'
          }
        >
          {chartData.length ? (
            <Box sx={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                  <XAxis dataKey="code" tick={axis} tickLine={false} axisLine={{ stroke: grid }} interval={0} angle={-30} textAnchor="end" height={56} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                  <RTooltip
                    cursor={{ fill: `${chartColor}10` }}
                    contentStyle={{ borderRadius: 12, border: `1px solid ${grid}`, background: theme.palette.background.paper }}
                  />
                  <Bar dataKey="value" name={usingShortageChart ? 'Shortage' : 'On hand'} radius={[6, 6, 0, 0]} barSize={34}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={chartColor} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>
          ) : (
            <Empty label="No stock data yet — add items and stock levels to see this chart." />
          )}
        </Panel>
      </Box>

      {/* Reorder / Shortage table */}
      <Box sx={{ mb: 3 }}>
        <Panel title="Reorder / Shortage" subtitle="Items at or below their reorder point">
          {reorder.length ? (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Code</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell align="right">On hand</TableCell>
                    <TableCell align="right">Reorder pt</TableCell>
                    <TableCell align="right">Shortage</TableCell>
                    <TableCell align="right">Suggested qty</TableCell>
                    <TableCell>Preferred Vendor</TableCell>
                    <TableCell align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {reorder.map((r) => (
                    <TableRow key={r.item_id || r.code} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{r.code || '—'}</TableCell>
                      <TableCell>{r.name || '—'}</TableCell>
                      <TableCell align="right">{num(r.on_hand)}</TableCell>
                      <TableCell align="right">{num(r.reorder_point)}</TableCell>
                      <TableCell align="right">
                        <Chip
                          size="small"
                          label={num(r.shortage)}
                          sx={{
                            bgcolor: `${theme.palette.error.main}1a`,
                            color: theme.palette.error.main,
                            fontWeight: 700,
                          }}
                        />
                      </TableCell>
                      <TableCell align="right">{num(r.suggested_qty)}</TableCell>
                      <TableCell>
                        {r.vendor_name ? (
                          <Link
                            component="button"
                            type="button"
                            underline="hover"
                            onClick={() => openVendorDialog(r)}
                            sx={{ textAlign: 'left', color: 'text.primary', fontWeight: 500 }}
                          >
                            <Typography variant="body2" component="span">
                              {r.vendor_name}
                              {r.vendor_lead_time != null && (
                                <Typography component="span" variant="caption" color="text.secondary">
                                  {' '}· {r.vendor_lead_time}d
                                </Typography>
                              )}
                            </Typography>
                          </Link>
                        ) : (
                          <Button
                            size="small"
                            variant="text"
                            startIcon={<StorefrontOutlined fontSize="small" />}
                            onClick={() => openVendorDialog(r)}
                            sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                          >
                            No vendor — link one
                          </Button>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<AddShoppingCartOutlined />}
                          onClick={() =>
                            navigate('/purchase-flow/raise-indent', {
                              state: {
                                inventoryPrefill: {
                                  itemCode: r.code,
                                  itemName: r.name,
                                  qty: r.suggested_qty,
                                  vendorCode: r.vendor_code,
                                  vendorName: r.vendor_name,
                                  unitCost: r.vendor_unit_cost,
                                },
                              },
                            })
                          }
                          sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                        >
                          Raise Indent
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Empty label="No shortages — all items above reorder point." />
          )}
        </Panel>
      </Box>

      {/* Excess / slow-moving table */}
      <Box>
        <Panel title="Excess / Slow-moving" subtitle="Items with more than ~120 days of cover">
          {excess.length ? (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Code</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell align="right">On hand</TableCell>
                    <TableCell align="right">Max</TableCell>
                    <TableCell align="right">Over by</TableCell>
                    <TableCell align="right">Days of cover</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {excess.map((r) => (
                    <TableRow key={r.item_id || r.code} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{r.code || '—'}</TableCell>
                      <TableCell>{r.name || '—'}</TableCell>
                      <TableCell align="right">{num(r.on_hand)}</TableCell>
                      <TableCell align="right">{num(r.max_qty)}</TableCell>
                      <TableCell align="right">
                        <Chip
                          size="small"
                          label={num(r.over_qty)}
                          sx={{
                            bgcolor: `${theme.palette.warning.main}1a`,
                            color: theme.palette.warning.main,
                            fontWeight: 700,
                          }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {r.days_of_cover != null ? `${num(r.days_of_cover)}d` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Empty label="No excess stock — inventory is lean and well-balanced." />
          )}
        </Panel>
      </Box>

      {/* Link Vendor dialog ------------------------------------------------ */}
      <Dialog open={vendorDialog.open} onClose={closeVendorDialog} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {vendorDialog.row?.vendor_name ? 'Edit Vendor' : 'Link Vendor'}
          {vendorDialog.row && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
              {vendorDialog.row.code} · {vendorDialog.row.name}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2} sx={{ mt: 0 }}>
            <Grid item xs={12} sm={7}>
              <TextField
                label="Vendor name"
                value={vendorForm.vendor_name}
                onChange={(e) => setVendorForm((f) => ({ ...f, vendor_name: e.target.value }))}
                required
                fullWidth
                autoFocus
              />
            </Grid>
            <Grid item xs={12} sm={5}>
              <TextField
                label="Vendor code"
                value={vendorForm.vendor_code}
                onChange={(e) => setVendorForm((f) => ({ ...f, vendor_code: e.target.value }))}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Lead time (days)"
                type="number"
                value={vendorForm.lead_time_days}
                onChange={(e) => setVendorForm((f) => ({ ...f, lead_time_days: e.target.value }))}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Unit cost"
                type="number"
                value={vendorForm.unit_cost}
                onChange={(e) => setVendorForm((f) => ({ ...f, unit_cost: e.target.value }))}
                fullWidth
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="MOQ"
                type="number"
                value={vendorForm.moq}
                onChange={(e) => setVendorForm((f) => ({ ...f, moq: e.target.value }))}
                fullWidth
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={vendorForm.is_preferred}
                    onChange={(e) => setVendorForm((f) => ({ ...f, is_preferred: e.target.checked }))}
                  />
                }
                label="Set as preferred vendor"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeVendorDialog} disabled={savingVendor} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleVendorSubmit}
            disabled={savingVendor || !vendorForm.vendor_name.trim()}
            sx={{ textTransform: 'none' }}
          >
            {savingVendor ? 'Saving…' : 'Save Vendor'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
