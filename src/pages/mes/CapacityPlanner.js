import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Stack, Card, CardContent, Typography, TextField, MenuItem, IconButton, Chip, Tooltip, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, CircularProgress,
  useTheme, alpha,
} from '@mui/material';
import {
  Speed as CapIcon, Refresh as RefreshIcon, WarningAmber as WarnIcon, Link as ChainIcon,
  CheckCircleOutline as MeasuredIcon, HelpOutline as DefaultIcon,
} from '@mui/icons-material';
import mesService from '../../services/mesService';
import mesMasterService from '../../services/mesMasterService';
import plmProductService from '../../services/plmProductService';
import { resolveStandard, standardRatePerHour, machineThroughput, lineCapacity, operatorsFor } from '../../services/routingCapacity';

// hours (decimal) added to a start hour -> "HH:MM"
const toTime = (startHour, addHours) => {
  let t = (Number(startHour) || 0) + (Number(addHours) || 0);
  t = ((t % 24) + 24) % 24;
  const h = Math.floor(t); const m = Math.round((t - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}`;
};
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');

// provenance badge per resolved.cycleSource
const ProvenanceBadge = ({ source }) => {
  if (source === 'routing') return <Chip size="small" variant="outlined" color="success" icon={<MeasuredIcon />} label="measured" sx={{ height: 20 }} />;
  if (source === 'mold') return <Chip size="small" variant="outlined" color="info" icon={<ChainIcon />} label="from mold" sx={{ height: 20 }} />;
  return <Chip size="small" variant="outlined" color="warning" icon={<DefaultIcon />} label="default" sx={{ height: 20 }} />;
};

const CapacityPlanner = () => {
  const theme = useTheme();
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [steps, setSteps] = useState([]);
  const [molds, setMolds] = useState([]);
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [routingLoading, setRoutingLoading] = useState(false);

  // Shift hours drives daily output (no longer the price of entry).
  const [shiftStart, setShiftStart] = useState(9);
  const [shiftHours, setShiftHours] = useState(8);
  // OPTIONAL what-if: a target line UPH to staff/machine against. Empty by default.
  const [targetUph, setTargetUph] = useState('');
  const [qty, setQty] = useState(60000);

  // master data (products picker + molds + operation catalogue) — load once
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, mlds, ops] = await Promise.all([
        plmProductService.listProducts().catch(() => []),
        mesMasterService.listRows('molding_master').catch(() => []),
        mesService.listOperations({ includeInactive: false }).catch(() => []),
      ]);
      setProducts(prods);
      setMolds(mlds);
      setOperations(ops);
      if (prods.length && !productId) setProductId(prods[0].id);
    } catch { setProducts([]); }
    setLoading(false);
  }, [productId]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // active routing for the selected SKU
  const loadRouting = useCallback(async (pid) => {
    if (!pid) { setSteps([]); return; }
    setRoutingLoading(true);
    try { setSteps(await plmProductService.listProcess(pid)); }
    catch { setSteps([]); }
    setRoutingLoading(false);
  }, []);
  useEffect(() => { loadRouting(productId); }, [productId, loadRouting]);

  // resolve every routing step through the engine
  const resolvedOps = useMemo(() => {
    return (steps || []).map((step) => {
      const mold = molds.find((m) => m.id === step.mold_id) || null;
      const op = operations.find((o) => o.id === step.operation_id) || null;
      const processDefault = op
        ? { default_cycle_sec: op.std_time_sec, default_oee: op.default_oee, constraint_type: op.constraint_type }
        : {};
      const resolved = resolveStandard(step, mold, processDefault);
      return { ...resolved, step };
    });
  }, [steps, molds, operations]);

  const line = useMemo(() => lineCapacity(resolvedOps), [resolvedOps]);

  // any contributing (valid) op falling back to a default -> the headline is an estimate
  const anyDefault = useMemo(
    () => resolvedOps.some((r) => r.valid && r.cycleSource === 'default'),
    [resolvedOps],
  );
  const validCount = resolvedOps.filter((r) => r.valid).length;

  const achievableUph = line.achievableUph;
  const dailyOutput = achievableUph * (Number(shiftHours) || 0);
  const completionHrs = achievableUph > 0 ? (Number(qty) || 0) / achievableUph : 0;

  const selectedProduct = products.find((p) => p.id === productId);

  // OPTIONAL what-if: staff/machine each op to hold the typed target rate.
  const tgt = Number(targetUph) || 0;
  const whatIf = useMemo(() => {
    if (tgt <= 0) return null;
    return resolvedOps.map((r) => {
      if (!r.valid) return { ...r, na: true };
      if (r.constraintType === 'machine') {
        const perMachine = standardRatePerHour(r);
        const reqMachines = perMachine > 0 ? Math.ceil(tgt / perMachine) : Infinity;
        return { ...r, type: 'machine', perMachine, reqMachines, have: r.parallelMachines, short: reqMachines > r.parallelMachines };
      }
      const reqOps = operatorsFor(r, tgt);
      const perOp = standardRatePerHour(r);
      const capped = perOp * reqOps < tgt; // clamped by max_operators
      return { ...r, type: 'labour', reqOps, perOp, capped };
    });
  }, [resolvedOps, tgt]);

  const totalOperators = whatIf
    ? whatIf.filter((s) => s.type === 'labour').reduce((a, s) => a + (s.reqOps || 0), 0)
    : null;

  return (
    <Box sx={{ p: 3 }}>
      <Card sx={{ background: `linear-gradient(135deg, ${theme.palette.warning.dark} 0%, ${theme.palette.error.dark} 100%)`, color: 'white', borderRadius: 3, mb: 2 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, py: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CapIcon sx={{ fontSize: 32 }} />
            <Box><Typography variant="h5" sx={{ fontWeight: 700 }}>Capacity Engine</Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>Pick a part &rarr; its routing tells you the achievable line rate and the bottleneck.</Typography></Box>
          </Box>
          <Tooltip title="Reload"><IconButton onClick={load} sx={{ color: 'white' }}><RefreshIcon /></IconButton></Tooltip>
        </CardContent>
      </Card>

      {/* SKU PICKER + shift (no required numeric input to see the truth) */}
      <Card sx={{ borderRadius: 2, mb: 2 }}><CardContent>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
          <TextField select label="Part / SKU" value={productId} onChange={(e) => setProductId(e.target.value)} sx={{ minWidth: 280 }} disabled={loading || !products.length}>
            {products.map((p) => <MenuItem key={p.id} value={p.id}>{p.product_name}{p.product_code ? ` (${p.product_code})` : ''}</MenuItem>)}
          </TextField>
          <TextField type="number" label="Shift start (hr)" value={shiftStart} onChange={(e) => setShiftStart(Number(e.target.value) || 0)} sx={{ width: 130 }} />
          <TextField type="number" label="Shift hours" value={shiftHours} onChange={(e) => setShiftHours(Number(e.target.value) || 0)} sx={{ width: 120 }} />
        </Stack>
      </CardContent></Card>

      {loading ? <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box> : !products.length ? (
        <Card sx={{ borderRadius: 2 }}><CardContent sx={{ textAlign: 'center', py: 5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>No products yet</Typography>
          <Typography variant="body2" color="text.secondary">Create a product and its routing in PLM / NPD, then return here.</Typography>
        </CardContent></Card>
      ) : routingLoading ? <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box> : validCount === 0 ? (
        <Card sx={{ borderRadius: 2 }}><CardContent sx={{ textAlign: 'center', py: 5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>No standard set for {selectedProduct?.product_name || 'this part'}</Typography>
          <Typography variant="body2" color="text.secondary">Its active routing has no usable cycle time. Set a cycle time on the routing steps (PLM &rarr; Process) so the engine can compute a rate.</Typography>
        </CardContent></Card>
      ) : (
        <>
          {/* HERO — the truth of the selected SKU */}
          <Card sx={{ borderRadius: 3, mb: 2, color: 'white', background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)` }}>
            <CardContent sx={{ py: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="h2" sx={{ fontWeight: 800, lineHeight: 1 }}>{fmt(achievableUph)}</Typography>
                <Typography variant="h6" sx={{ opacity: 0.9 }}>pcs / hr achievable</Typography>
                {anyDefault && <Chip size="small" color="warning" icon={<WarnIcon />} label="estimated" sx={{ fontWeight: 700 }} />}
              </Box>
              <Box sx={{ display: 'flex', gap: 4, mt: 2, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="caption" sx={{ opacity: 0.8, textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Daily output ({r1(shiftHours)}h shift)</Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>{fmt(dailyOutput)} pcs</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ opacity: 0.8, textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Bottleneck</Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>
                    {line.bottleneck ? `${line.bottleneck.label} — ${fmt(line.bottleneck.constraintType === 'machine' ? machineThroughput(line.bottleneck) : standardRatePerHour(line.bottleneck))}/hr` : '—'}
                  </Typography>
                </Box>
              </Box>
              {anyDefault && (
                <Typography variant="caption" sx={{ display: 'block', mt: 1.5, opacity: 0.85 }}>
                  Estimated: at least one operation has no measured/mold cycle time and is using the Process Master default. Set its routing cycle to firm up this number.
                </Typography>
              )}
            </CardContent>
          </Card>

          {/* PER-OP BREAKDOWN with provenance */}
          <Card sx={{ borderRadius: 2, mb: 2 }}><CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Routing operations — {selectedProduct?.product_name}</Typography>
            <Divider sx={{ mb: 1 }} />
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
              <Table size="small">
                <TableHead><TableRow>
                  {['Operation', 'Source', 'Constraint', 'Cycle (s)', 'Cavities', 'Rate/machine·op', 'Throughput/hr', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}
                </TableRow></TableHead>
                <TableBody>
                  {resolvedOps.map((r, i) => {
                    const isBn = line.bottleneck && r.key === line.bottleneck.key && r.label === line.bottleneck.label;
                    const tput = r.constraintType === 'machine' ? machineThroughput(r) : standardRatePerHour(r);
                    return (
                      <TableRow key={r.key || i} hover sx={{ bgcolor: isBn ? alpha(theme.palette.error.main, 0.07) : 'inherit' }}>
                        <TableCell sx={{ fontWeight: 600 }}>{r.label}{isBn && <Chip size="small" color="error" icon={<WarnIcon />} label="bottleneck" sx={{ height: 18, ml: 0.5 }} />}</TableCell>
                        <TableCell><ProvenanceBadge source={r.cycleSource} /></TableCell>
                        <TableCell><Chip size="small" variant="outlined" label={r.constraintType} sx={{ height: 20, textTransform: 'capitalize' }} /></TableCell>
                        {r.valid ? (
                          <>
                            <TableCell>{r1(r.cycle)}</TableCell>
                            <TableCell>{r.constraintType === 'machine' ? r.cavities : '—'}</TableCell>
                            <TableCell>{fmt(standardRatePerHour(r))}{r.constraintType === 'machine' && r.parallelMachines > 1 ? ` × ${r.parallelMachines}` : ''}</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>{fmt(tput)}</TableCell>
                            <TableCell />
                          </>
                        ) : (
                          <TableCell colSpan={5}><Chip size="small" color="warning" icon={<WarnIcon />} label="no standard — set a cycle time" sx={{ height: 22 }} /></TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent></Card>

          {/* OPTIONAL WHAT-IF: target UPH -> resources */}
          <Card sx={{ borderRadius: 2, mb: 2, bgcolor: alpha(theme.palette.secondary.main, 0.04) }}><CardContent>
            <Typography variant="overline" color="text.secondary">What-if: hit a target rate</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Optional. Type a target line UPH to see how many operators each labour station needs, and how many machines each molding station needs, to hold it.
            </Typography>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mb: tgt > 0 ? 2 : 0 }}>
              <TextField type="number" label="Target line UPH" value={targetUph} onChange={(e) => setTargetUph(e.target.value)} placeholder={String(Math.round(achievableUph))} sx={{ width: 190 }} />
              <TextField type="number" label="Order quantity" value={qty} onChange={(e) => setQty(Number(e.target.value) || 0)} sx={{ width: 160 }} />
            </Stack>

            {tgt > 0 && whatIf && (
              <>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(4,1fr)' }, gap: 2, mb: 2 }}>
                  {[
                    ['Target rate', `${fmt(tgt)}/hr`, 'secondary.main'],
                    ['Operators needed', totalOperators, 'primary.main'],
                    ['Completion', `${r1(completionHrs)}h`, 'text.primary'],
                    ['Finish by', toTime(shiftStart, completionHrs), 'text.primary'],
                  ].map(([l, v, c]) => (
                    <Box key={l}><Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.56rem', display: 'block' }}>{l}</Typography>
                      <Typography variant="h6" sx={{ fontWeight: 800, color: c }}>{v}</Typography></Box>
                  ))}
                </Box>
                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
                  <Table size="small">
                    <TableHead><TableRow>{['Operation', 'Type', 'Single rate/hr', 'Resource to hold target', 'Status'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                    <TableBody>
                      {whatIf.map((s, i) => (
                        <TableRow key={s.key || i} hover>
                          <TableCell sx={{ fontWeight: 600 }}>{s.label}</TableCell>
                          <TableCell sx={{ textTransform: 'capitalize' }}>{s.na ? '—' : s.type}</TableCell>
                          {s.na ? (
                            <TableCell colSpan={3}><Chip size="small" color="warning" icon={<WarnIcon />} label="no standard — set a cycle time" sx={{ height: 22 }} /></TableCell>
                          ) : s.type === 'machine' ? (
                            <>
                              <TableCell>{fmt(s.perMachine)} / machine</TableCell>
                              <TableCell sx={{ fontWeight: 700, color: s.short ? 'error.main' : 'inherit' }}>{Number.isFinite(s.reqMachines) ? `${s.reqMachines} machine(s)` : '—'}{s.short ? ` (have ${s.have})` : ''}</TableCell>
                              <TableCell>{s.short ? <Chip size="small" color="error" icon={<WarnIcon />} label="short" sx={{ height: 20 }} /> : <Chip size="small" color="success" label="ok" sx={{ height: 20 }} />}</TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell>{fmt(s.perOp)} / operator</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>{s.reqOps} operator(s)</TableCell>
                              <TableCell>{s.capped ? <Chip size="small" color="warning" label="capped by max ops" sx={{ height: 20 }} /> : <Chip size="small" color="success" label="ok" sx={{ height: 20 }} />}</TableCell>
                            </>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Operators are the result, not a dial that lifts UPH. A molding station short of machines is a hard bottleneck — add a machine or lower the target.
                </Typography>
              </>
            )}
          </CardContent></Card>
        </>
      )}
    </Box>
  );
};

export default CapacityPlanner;
