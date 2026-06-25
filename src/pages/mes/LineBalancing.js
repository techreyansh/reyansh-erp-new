import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Stack, Card, CardContent, Typography, TextField, MenuItem, IconButton, Chip, Tooltip,
  CircularProgress, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  useTheme, alpha,
} from '@mui/material';
import {
  Balance as BalanceIcon, Refresh as RefreshIcon, WarningAmber as WarnIcon, Link as ChainIcon,
  CheckCircleOutline as MeasuredIcon, HelpOutline as DefaultIcon,
} from '@mui/icons-material';
import mesService from '../../services/mesService';
import mesMasterService from '../../services/mesMasterService';
import plmProductService from '../../services/plmProductService';
import { resolveStandard, standardRatePerHour, machineThroughput, lineCapacity, operatorsFor } from '../../services/routingCapacity';

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');

const ProvenanceBadge = ({ source }) => {
  if (source === 'routing') return <Chip size="small" variant="outlined" color="success" icon={<MeasuredIcon />} label="measured" sx={{ height: 20 }} />;
  if (source === 'mold') return <Chip size="small" variant="outlined" color="info" icon={<ChainIcon />} label="from mold" sx={{ height: 20 }} />;
  return <Chip size="small" variant="outlined" color="warning" icon={<DefaultIcon />} label="default" sx={{ height: 20 }} />;
};

const LineBalancing = () => {
  const theme = useTheme();
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [steps, setSteps] = useState([]);
  const [molds, setMolds] = useState([]);
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [targetRate, setTargetRate] = useState(200);

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
    const processDefault = op
      ? { default_cycle_sec: op.std_time_sec, default_oee: op.default_oee, constraint_type: op.constraint_type }
      : {};
    return resolveStandard(step, mold, processDefault);
  }), [steps, molds, operations]);

  const line = useMemo(() => {
    const cap = lineCapacity(resolvedOps);
    const rows = resolvedOps.map((r) => {
      if (!r.valid) return { r, na: true, single: 0, opsNeeded: 0, throughput: 0 };
      const single = r.constraintType === 'machine' ? machineThroughput(r) : standardRatePerHour(r);
      if (r.constraintType === 'machine') {
        const perMachine = standardRatePerHour(r);
        const reqMachines = perMachine > 0 ? Math.ceil(targetRate / perMachine) : Infinity;
        return { r, na: false, type: 'machine', single, reqMachines, have: r.parallelMachines, short: reqMachines > r.parallelMachines, throughput: machineThroughput(r) };
      }
      const opsNeeded = operatorsFor(r, targetRate);
      return { r, na: false, type: 'labour', single, opsNeeded, throughput: standardRatePerHour(r) * opsNeeded };
    }).sort((a, b) => a.single - b.single); // slowest single first
    const bnKey = cap.bottleneck ? `${cap.bottleneck.key}|${cap.bottleneck.label}` : null;
    return {
      rows: rows.map((row) => ({ ...row, bottleneck: !row.na && bnKey === `${row.r.key}|${row.r.label}` })),
      bottleneck: cap.bottleneck,
      achievableUph: cap.achievableUph,
      totalMen: rows.filter((row) => row.type === 'labour').reduce((s, row) => s + (row.opsNeeded || 0), 0),
    };
  }, [resolvedOps, targetRate]);

  const anyDefault = resolvedOps.some((r) => r.valid && r.cycleSource === 'default');
  const validCount = resolvedOps.filter((r) => r.valid).length;
  const bn = line.bottleneck;
  const bnRow = line.rows.find((row) => row.bottleneck);
  const selectedProduct = products.find((p) => p.id === productId);

  return (
    <Box sx={{ p: 3 }}>
      <Card sx={{ background: `linear-gradient(135deg, ${theme.palette.secondary.main} 0%, ${theme.palette.secondary.dark} 100%)`, color: 'white', borderRadius: 3, mb: 2 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, py: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <BalanceIcon sx={{ fontSize: 32 }} />
            <Box><Typography variant="h5" sx={{ fontWeight: 700 }}>Line Balancing</Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>Per-part routing &rarr; find the bottleneck &rarr; man &amp; machine each station to free the line.</Typography></Box>
          </Box>
          <Tooltip title="Reload"><IconButton onClick={load} sx={{ color: 'white' }}><RefreshIcon /></IconButton></Tooltip>
        </CardContent>
      </Card>

      <Card sx={{ borderRadius: 2, mb: 2 }}><CardContent>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
          <TextField select label="Part / SKU" value={productId} onChange={(e) => setProductId(e.target.value)} sx={{ minWidth: 280 }} disabled={loading || !products.length}>
            {products.map((p) => <MenuItem key={p.id} value={p.id}>{p.product_name}{p.product_code ? ` (${p.product_code})` : ''}</MenuItem>)}
          </TextField>
          <TextField type="number" label="Target line rate (pcs/hr)" value={targetRate} onChange={(e) => setTargetRate(Number(e.target.value) || 0)} sx={{ width: 200 }} />
          <Typography variant="body2" color="text.secondary">Operators to balance: <b>{line.totalMen}</b></Typography>
        </Stack>
      </CardContent></Card>

      {loading ? <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box> : !products.length ? (
        <Card sx={{ borderRadius: 2 }}><CardContent sx={{ textAlign: 'center', py: 6 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>No products yet</Typography>
          <Typography variant="body2" color="text.secondary">Create a product and its routing in PLM / NPD first.</Typography>
        </CardContent></Card>
      ) : routingLoading ? <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box> : validCount === 0 ? (
        <Card sx={{ borderRadius: 2 }}><CardContent sx={{ textAlign: 'center', py: 6 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>No standard for {selectedProduct?.product_name || 'this part'}</Typography>
          <Typography variant="body2" color="text.secondary">Its active routing has no usable cycle time. Set cycle times on the routing steps (PLM &rarr; Process); UPH and the bottleneck compute from them.</Typography>
        </CardContent></Card>
      ) : (
        <>
          {bn && (
            <Card sx={{ borderRadius: 2, mb: 2, border: '1px solid', borderColor: 'error.main', bgcolor: alpha(theme.palette.error.main, 0.05) }}><CardContent sx={{ py: 1.5 }}>
              <Typography variant="body1" sx={{ fontWeight: 600, color: 'error.main' }}>
                <WarnIcon sx={{ verticalAlign: 'middle', mr: 0.5 }} fontSize="small" /> Bottleneck: <b>{bn.label}</b> — caps the line at {fmt(line.achievableUph)}/hr.{anyDefault && ' (estimated — some ops use a default cycle)'}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {bnRow && bnRow.type === 'machine'
                  ? <>To run the line at {fmt(targetRate)}/hr this molding station needs <b>{Number.isFinite(bnRow.reqMachines) ? bnRow.reqMachines : '—'} machine{bnRow.reqMachines === 1 ? '' : 's'}</b> (has {bnRow.have}). Machines, not operators, lift it.</>
                  : bnRow
                    ? <>To run the line at {fmt(targetRate)}/hr it needs <b>{bnRow.opsNeeded} operator{bnRow.opsNeeded > 1 ? 's' : ''}</b> ({fmt(bnRow.throughput)}/hr with that crew). Man it up to free the bottleneck.</>
                    : null}
              </Typography>
            </CardContent></Card>
          )}
          <Card sx={{ borderRadius: 2 }}><CardContent>
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
              <Table size="small">
                <TableHead><TableRow>{['Operation', 'Source', 'Constraint', 'Single rate/hr', 'Resource to balance', 'Station throughput', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {line.rows.map((row, i) => (
                    <TableRow key={row.r.key || i} hover sx={{ bgcolor: row.bottleneck ? alpha(theme.palette.error.main, 0.06) : 'inherit' }}>
                      <TableCell sx={{ fontWeight: 600 }}>{row.r.label}</TableCell>
                      <TableCell><ProvenanceBadge source={row.r.cycleSource} /></TableCell>
                      <TableCell><Chip size="small" variant="outlined" label={row.na ? '—' : row.type} sx={{ height: 20, textTransform: 'capitalize' }} /></TableCell>
                      {row.na ? (
                        <TableCell colSpan={4}><Chip size="small" color="warning" icon={<WarnIcon />} label="no standard — set a cycle time" sx={{ height: 22 }} /></TableCell>
                      ) : (
                        <>
                          <TableCell><Chip size="small" variant="outlined" color={row.bottleneck ? 'error' : 'default'} label={`${fmt(row.single)}/hr`} sx={{ height: 20 }} /></TableCell>
                          <TableCell sx={{ fontWeight: 700, color: row.short ? 'error.main' : 'inherit' }}>
                            {row.type === 'machine'
                              ? <>{Number.isFinite(row.reqMachines) ? `${row.reqMachines} machine(s)` : '—'}{row.short ? ` (have ${row.have})` : ''}</>
                              : `${row.opsNeeded} operator(s)`}
                          </TableCell>
                          <TableCell>{fmt(row.throughput)}/hr {row.throughput >= targetRate && !row.short && <Chip size="small" color="success" label="meets rate" sx={{ height: 18, ml: 0.5 }} />}</TableCell>
                          <TableCell>{row.bottleneck && <Chip size="small" color="error" icon={<WarnIcon />} label="bottleneck" sx={{ height: 22 }} />}{row.short && <Chip size="small" color="error" label="machine short" sx={{ height: 22 }} />}</TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Rates come from the part&apos;s active routing (cavity-aware) via the capacity engine. Labour stations are staffed to the target rate; molding stations are machine-constrained and capped by available machines.
            </Typography>
          </CardContent></Card>
        </>
      )}
    </Box>
  );
};

export default LineBalancing;
