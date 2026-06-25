// Assembly Planner Cockpit (IE engine P1). Enter a daily target -> the engine
// recommends the lowest-cost staffing that hits it within the fixed headcount
// pool, falling back to overtime only when the pool can't cover it, and showing
// a designed infeasible state with the smallest unlock when the target can't be
// met. Reads the active routing (reuses CapacityPlanner's load path) + cost
// rates; all math is pure (services/ie/ieScenario.js), so the screen is a thin
// view over it.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, MenuItem, Button, Chip, Divider,
  CircularProgress, Table, TableHead, TableBody, TableRow, TableCell, Alert,
  useTheme, alpha,
} from '@mui/material';
import {
  BoltRounded, CheckCircleRounded, WarningAmberRounded, GroupRounded,
  AccessTimeRounded, PaymentsRounded, SpeedRounded,
} from '@mui/icons-material';
import mesService from '../../services/mesService';
import mesMasterService from '../../services/mesMasterService';
import plmProductService from '../../services/plmProductService';
import ieService from '../../services/ieService';
import { resolveStandard } from '../../services/routingCapacity';
import { planForTarget } from '../../services/ie/ieScenario';

const fmt = (x) => Math.round(Number(x) || 0).toLocaleString('en-IN');
const money = (x) => `₹${(Number(x) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function AssemblyPlanner() {
  const theme = useTheme();
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [steps, setSteps] = useState([]);
  const [molds, setMolds] = useState([]);
  const [operations, setOperations] = useState([]);
  const [rates, setRates] = useState(null);
  const [loading, setLoading] = useState(true);
  const [routingLoading, setRoutingLoading] = useState(false);

  // planner inputs
  const [target, setTarget] = useState(5000);
  const [shiftHours, setShiftHours] = useState(8);
  const [headcountPool, setHeadcountPool] = useState(20);
  const [maxOvertime, setMaxOvertime] = useState(2);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, mlds, ops, cr] = await Promise.all([
        plmProductService.listProducts().catch(() => []),
        mesMasterService.listRows('molding_master').catch(() => []),
        mesService.listOperations({ includeInactive: false }).catch(() => []),
        ieService.getCostRates().catch(() => null),
      ]);
      setProducts(prods); setMolds(mlds); setOperations(ops); setRates(cr);
      if (prods.length && !productId) setProductId(prods[0].id);
    } catch { setProducts([]); }
    setLoading(false);
  }, [productId]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRouting = useCallback(async (pid) => {
    if (!pid) { setSteps([]); return; }
    setRoutingLoading(true);
    try { setSteps(await plmProductService.listProcess(pid)); }
    catch { setSteps([]); }
    setRoutingLoading(false);
  }, []);
  useEffect(() => { loadRouting(productId); }, [productId, loadRouting]);

  const resolvedOps = useMemo(() => (steps || []).map((step) => {
    const mold = molds.find((m) => m.id === step.mold_id) || null;
    const op = operations.find((o) => o.id === step.operation_id) || null;
    const processDefault = op ? { default_cycle_sec: op.std_time_sec, default_oee: op.default_oee, constraint_type: op.constraint_type } : {};
    return resolveStandard(step, mold, processDefault);
  }), [steps, molds, operations]);

  const result = useMemo(() => planForTarget(resolvedOps, {
    headcountPool: Number(headcountPool) || 0,
    targetQty: Number(target) || 0,
    shiftHours: Number(shiftHours) || 0,
    maxOvertimeHours: Number(maxOvertime) || 0,
    rates: rates || {},
  }), [resolvedOps, headcountPool, target, shiftHours, maxOvertime, rates]);

  const validCount = resolvedOps.filter((r) => r.valid).length;
  const anyDefault = resolvedOps.some((r) => r.valid && r.cycleSource === 'default');
  const selected = products.find((p) => p.id === productId);
  const feasible = result.feasible;
  const completionHrs = result.achievableUph > 0 ? (Number(target) || 0) / result.achievableUph : 0;

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>;

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <BoltRounded color="primary" />
        <Typography variant="h6" sx={{ fontWeight: 800 }}>Assembly Planner</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Enter a daily target — the engine recommends the lowest-cost staffing that hits it, or tells you exactly what's stopping you.
      </Typography>

      {/* Input bar */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField select label="Product" value={productId} onChange={(e) => setProductId(e.target.value)} fullWidth size="small" sx={{ minWidth: 200 }}>
            {products.length === 0 && <MenuItem value="">No products</MenuItem>}
            {products.map((p) => <MenuItem key={p.id} value={p.id}>{p.product_name || p.product_code || p.id}</MenuItem>)}
          </TextField>
          <TextField label="Daily target (pcs)" type="number" value={target} onChange={(e) => setTarget(e.target.value)} size="small" />
          <TextField label="Shift hours" type="number" value={shiftHours} onChange={(e) => setShiftHours(e.target.value)} size="small" />
          <TextField label="Headcount pool" type="number" value={headcountPool} onChange={(e) => setHeadcountPool(e.target.value)} size="small" helperText="operators available" />
          <TextField label="Max overtime (h)" type="number" value={maxOvertime} onChange={(e) => setMaxOvertime(e.target.value)} size="small" />
        </Stack>
      </Paper>

      {routingLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>
      ) : !productId ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">Pick a product to plan.</Typography></Paper>
      ) : validCount === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography sx={{ fontWeight: 700 }}>No usable routing for {selected?.product_name || 'this product'}</Typography>
          <Typography variant="body2" color="text.secondary">Set cycle times on its routing steps (PLM → Process); the plan computes from them.</Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
          {/* The verdict */}
          <Paper variant="outlined" sx={{ p: 2.5, borderColor: feasible ? 'success.main' : 'error.main', borderWidth: 1.5,
            bgcolor: alpha(feasible ? theme.palette.success.main : theme.palette.error.main, 0.05) }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              {feasible ? <CheckCircleRounded color="success" /> : <WarningAmberRounded color="error" />}
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                {feasible ? `Make ${fmt(target)}/day` : `Can't make ${fmt(target)}/day`}
              </Typography>
            </Stack>
            {feasible ? (
              <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
                <Metric icon={<GroupRounded />} label="Operators" value={result.plan.totalOperators} />
                <Metric icon={<AccessTimeRounded />} label="Overtime" value={`${result.overtimeHours}h`} />
                <Metric icon={<SpeedRounded />} label="Line rate" value={`${fmt(result.achievableUph)}/hr`} />
                <Metric icon={<AccessTimeRounded />} label="Completes in" value={`${completionHrs.toFixed(1)}h`} />
                <Metric icon={<PaymentsRounded />} label="Cost / pc" value={money(result.cost?.costPerPc)} highlight />
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">Max achievable shown below — and the smallest thing that unlocks the target.</Typography>
            )}
          </Paper>

          {/* The recommendation / reasoning */}
          <Paper variant="outlined" sx={{ p: 2, borderLeft: `4px solid ${feasible ? theme.palette.success.main : theme.palette.warning.main}` }}>
            <Typography sx={{ fontWeight: 700, mb: 0.5 }}>{feasible ? 'Recommendation' : 'What’s limiting you'}</Typography>
            <Typography variant="body2">{result.reason}{anyDefault && ' (estimated — some operations use a default cycle time)'}</Typography>
            {!feasible && result.unlock && (
              <Box sx={{ mt: 1 }}>
                {result.unlock.suggestions.map((s, i) => (
                  <Chip key={i} size="small" variant="outlined" color="warning" label={s} sx={{ mr: 0.5, mb: 0.5 }} />
                ))}
              </Box>
            )}
            {feasible && (
              <Button variant="contained" size="small" sx={{ mt: 1.5 }} disabled>Apply this plan</Button>
            )}
          </Paper>

          {/* Per-station plan */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Station plan</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Operation</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell align="right">Operators</TableCell>
                  <TableCell align="right">Capacity</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.plan?.stations.map((s) => {
                  const bn = result.bottleneck && result.bottleneck.key === s.key;
                  return (
                    <TableRow key={s.key} hover sx={{ bgcolor: bn ? alpha(theme.palette.error.main, 0.06) : 'inherit' }}>
                      <TableCell sx={{ fontWeight: bn ? 700 : 400 }}>
                        {s.label}{bn && <Chip size="small" color="error" icon={<WarningAmberRounded />} label="bottleneck" sx={{ ml: 0.5, height: 20 }} />}
                      </TableCell>
                      <TableCell><Chip size="small" variant="outlined" label={s.machine ? 'machine' : 'labour'} sx={{ height: 20 }} /></TableCell>
                      <TableCell align="right">{s.machine ? '—' : s.operators}</TableCell>
                      <TableCell align="right">{fmt(s.capacity)}/hr</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Divider sx={{ my: 1 }} />
            <Typography variant="caption" color="text.secondary">
              Required line rate: {fmt(result.requiredUph)}/hr · pool: {headcountPool} operators · cost rates {rates ? `(₹${rates.labour_per_hr}/hr labour)` : '(defaults)'}
            </Typography>
          </Paper>
        </Stack>
      )}
    </Box>
  );
}

function Metric({ icon, label, value, highlight }) {
  return (
    <Box sx={{ minWidth: 90 }}>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary' }}>
        {icon}<Typography variant="caption">{label}</Typography>
      </Stack>
      <Typography variant="h6" sx={{ fontWeight: 800, color: highlight ? 'primary.main' : 'text.primary' }}>{value}</Typography>
    </Box>
  );
}
