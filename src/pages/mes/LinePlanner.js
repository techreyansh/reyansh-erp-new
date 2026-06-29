import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Stack, Card, CardContent, Typography, TextField, MenuItem, IconButton, Chip, Tooltip,
  CircularProgress, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  Button, Divider, Dialog, DialogTitle, DialogContent, DialogActions, List, ListItemButton,
  ListItemText, Snackbar, Alert, useTheme, alpha,
} from '@mui/material';
import {
  PrecisionManufacturing as PlantIcon, Refresh as RefreshIcon, WarningAmber as WarnIcon,
  Link as ChainIcon, CheckCircleOutline as MeasuredIcon, HelpOutline as DefaultIcon,
  Add as AddIcon, DeleteOutline as DeleteIcon, ArrowUpward as UpIcon, ArrowDownward as DownIcon,
  Save as SaveIcon, AutoFixHigh as SeedIcon, Balance as BalanceIcon,
  Payments as MoneyIcon, Groups as CrewIcon, AccessTime as ClockIcon, CheckCircle as OkIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import mesService from '../../services/mesService';
import mesMasterService from '../../services/mesMasterService';
import plmProductService from '../../services/plmProductService';
import ieService from '../../services/ieService';
import plmCostingService from '../../services/plmCostingService';
import { planForTarget, planScenarios } from '../../services/ie/ieScenario';
import { seedSampleRoutings } from '../../services/linePlannerSeed';
import BulkImportButton from '../../components/common/BulkImport/BulkImportButton';
import {
  resolveStandard, standardRatePerHour, machineThroughput, lineCapacity, forwardLine, operatorsFor,
} from '../../services/routingCapacity';

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');
const money = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// The three production stages, in flow order. Operation categories map onto them.
const STAGES = ['Assembly', 'Moulding', 'Packing'];
const STAGE_ORDER = { Assembly: 0, Moulding: 1, Packing: 2 };
const STAGE_FOR_CATEGORY = {
  cutting: 'Assembly', assembly: 'Assembly',
  molding: 'Moulding',
  packing: 'Packing', testing: 'Packing', other: 'Packing',
};
const CATEGORIES_FOR_STAGE = {
  Assembly: ['cutting', 'assembly'],
  Moulding: ['molding'],
  Packing: ['packing', 'testing', 'other'],
};

let keySeq = 0;
const withKey = (s) => ({ _key: `k${keySeq++}`, ...s });

const Metric = ({ icon, label, value, highlight }) => (
  <Stack direction="row" spacing={1} alignItems="center">
    <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
    <Box>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1 }}>{label}</Typography>
      <Typography variant="subtitle1" sx={{ fontWeight: 800, color: highlight ? 'success.main' : 'text.primary' }}>{value}</Typography>
    </Box>
  </Stack>
);

const ProvenanceBadge = ({ source }) => {
  if (source === 'routing') return <Chip size="small" variant="outlined" color="success" icon={<MeasuredIcon />} label="measured" sx={{ height: 20 }} />;
  if (source === 'mold') return <Chip size="small" variant="outlined" color="info" icon={<ChainIcon />} label="from mould" sx={{ height: 20 }} />;
  return <Chip size="small" variant="outlined" color="warning" icon={<DefaultIcon />} label="default" sx={{ height: 20 }} />;
};

const LinePlanner = () => {
  const theme = useTheme();
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [operations, setOperations] = useState([]);
  const [molds, setMolds] = useState([]);
  const [steps, setSteps] = useState([]);        // persisted routing (drives the balance)
  const [editSteps, setEditSteps] = useState([]); // editable working copy (drives the editor)
  const [dirty, setDirty] = useState(false);

  const [loading, setLoading] = useState(true);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [snack, setSnack] = useState(null); // { severity, msg }

  const [addStage, setAddStage] = useState(null); // which stage's add-dialog is open
  const [shiftHours, setShiftHours] = useState(8);
  const [targetRate, setTargetRate] = useState(360);
  const [resources, setResources] = useState({}); // forward mode: { [stepId]: count }

  // Section 3 — manpower & overtime
  const [rates, setRates] = useState(null);
  const [targetDay, setTargetDay] = useState(2880); // pcs/day; default = targetRate × shift
  const [headcountPool, setHeadcountPool] = useState(20);
  const [maxOvertime, setMaxOvertime] = useState(2);
  const [rateDraft, setRateDraft] = useState(null); // open the cost-rate editor when set
  const [savingRates, setSavingRates] = useState(false);
  const [materialPerPc, setMaterialPerPc] = useState(0);   // ₹/pc material (from released costing, editable)
  const [materialMeta, setMaterialMeta] = useState(null);  // { source: 'costing'|'manual'|'none', label }

  const opById = useMemo(() => new Map(operations.map((o) => [o.id, o])), [operations]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, ops, mlds, costRates] = await Promise.all([
        plmProductService.listProducts().catch(() => []),
        mesService.listOperations({ includeInactive: false }).catch(() => []),
        mesMasterService.listRows('molding_master').catch(() => []),
        ieService.getCostRates().catch(() => null),
      ]);
      setProducts(prods);
      setOperations(ops);
      setMolds(mlds);
      setRates(costRates);
      setProductId((cur) => cur || (prods[0]?.id ?? ''));
    } catch { /* surfaced globally */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadRouting = useCallback(async (pid) => {
    if (!pid) { setSteps([]); setEditSteps([]); setMaterialPerPc(0); setMaterialMeta(null); return; }
    setRoutingLoading(true);
    try {
      const rows = await plmProductService.listProcess(pid);
      setSteps(rows);
      setEditSteps(rows.map((r) => withKey({
        ...r,
        department: r.department || STAGE_FOR_CATEGORY[opById.get(r.operation_id)?.category] || 'Assembly',
      })));
      setDirty(false);
      setResources({});
      // material per piece from the product's latest released costing (editable override)
      const costing = await plmCostingService.getLatestReleased(pid).catch(() => null);
      const matCost = Number(costing?.material_cost) || 0;
      const qty = Number(costing?.qty_basis) || 1;
      if (costing && matCost > 0) {
        setMaterialPerPc(+(matCost / qty).toFixed(3));
        setMaterialMeta({ source: 'costing', label: `released costing v${costing.version_number}` });
      } else {
        setMaterialPerPc(0);
        setMaterialMeta({ source: 'none', label: 'no released costing — enter manually' });
      }
    } catch { setSteps([]); setEditSteps([]); setMaterialPerPc(0); setMaterialMeta(null); }
    setRoutingLoading(false);
  }, [opById]);
  useEffect(() => { loadRouting(productId); }, [productId, loadRouting]);

  // ---- editor mutations -------------------------------------------------
  const patchStep = (key, patch) => {
    setEditSteps((arr) => arr.map((s) => (s._key === key ? { ...s, ...patch } : s)));
    setDirty(true);
  };
  const removeStep = (key) => { setEditSteps((arr) => arr.filter((s) => s._key !== key)); setDirty(true); };
  const moveStep = (key, dir) => {
    setEditSteps((arr) => {
      const idx = arr.findIndex((s) => s._key === key);
      if (idx < 0) return arr;
      const dept = arr[idx].department;
      // swap with the nearest sibling in the same stage, in array order
      let j = idx + dir;
      while (j >= 0 && j < arr.length && arr[j].department !== dept) j += dir;
      if (j < 0 || j >= arr.length) return arr;
      const next = arr.slice();
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
    setDirty(true);
  };
  const addOperation = (stage, op) => {
    const isMachine = (op.constraint_type || (op.category === 'molding' ? 'machine' : 'labour')) === 'machine';
    setEditSteps((arr) => {
      const step = withKey({
        operation_id: op.id,
        step_name: op.name,
        department: stage,
        cycle_time_sec: op.std_time_sec ?? null,
        cavities: isMachine ? 1 : 1,
        parallel_machines: 1,
        min_operators: 1,
        max_operators: isMachine ? 1 : 9,
        oee: op.default_oee ?? 0.8,
        scrap_pct: 0,
        quality_check_required: !!op.quality_critical,
        notes: null,
      });
      // insert after the last step already in this stage (keeps stages contiguous)
      let lastIdx = -1;
      arr.forEach((s, i) => { if (s.department === stage) lastIdx = i; });
      const next = arr.slice();
      next.splice(lastIdx + 1, 0, step);
      return next;
    });
    setDirty(true);
    setAddStage(null);
  };

  const save = async () => {
    if (!productId) return;
    setSaving(true);
    try {
      const ordered = editSteps
        .slice()
        .sort((a, b) => (STAGE_ORDER[a.department] ?? 9) - (STAGE_ORDER[b.department] ?? 9));
      const payload = ordered.map((s) => ({
        operation_id: s.operation_id || null,
        step_name: s.step_name || null,
        department: s.department || null,
        cycle_time_sec: s.cycle_time_sec === '' || s.cycle_time_sec == null ? null : Number(s.cycle_time_sec),
        cavities: s.cavities == null || s.cavities === '' ? null : Number(s.cavities),
        parallel_machines: num(s.parallel_machines, 1),
        min_operators: num(s.min_operators, 1),
        max_operators: num(s.max_operators, 1),
        oee: s.oee == null || s.oee === '' ? null : Number(s.oee),
        scrap_pct: num(s.scrap_pct, 0),
        quality_check_required: !!s.quality_check_required,
        notes: s.notes || null,
      }));
      await plmProductService.saveProcess(productId, payload);
      await loadRouting(productId);
      setSnack({ severity: 'success', msg: `Saved routing — ${payload.length} operation${payload.length === 1 ? '' : 's'} across ${new Set(payload.map((p) => p.department)).size} stage(s).` });
    } catch (e) {
      setSnack({ severity: 'error', msg: `Save failed: ${e.message}` });
    }
    setSaving(false);
  };

  const runSeed = async () => {
    setSeeding(true);
    try {
      const res = await seedSampleRoutings();
      const createdN = res.filter((r) => r.created).length;
      const missing = res.flatMap((r) => r.missingOps);
      await load();
      const first = res.find((r) => r.customer_code === 'C10041') || res[0];
      if (first?.product_id) setProductId(first.product_id);
      setSnack({
        severity: missing.length ? 'warning' : 'success',
        msg: `Sample routings ready (${createdN} created, ${res.length - createdN} already existed).${missing.length ? ` Unmapped ops: ${[...new Set(missing)].join(', ')}` : ''}`,
      });
    } catch (e) {
      setSnack({ severity: 'error', msg: `Seed failed: ${e.message}` });
    }
    setSeeding(false);
  };

  const saveRates = async () => {
    if (!rateDraft) return;
    setSavingRates(true);
    try {
      const saved = await ieService.saveCostRates(rateDraft);
      setRates((cur) => ({ ...(cur || {}), ...saved }));
      setRateDraft(null);
      setSnack({ severity: 'success', msg: 'Labour & cost rates updated.' });
    } catch (e) {
      setSnack({ severity: 'error', msg: `Could not save rates: ${e.message}` });
    }
    setSavingRates(false);
  };

  // ---- balance (from the SAVED routing) ---------------------------------
  const resolvedOps = useMemo(() => (steps || []).map((step) => {
    const mold = molds.find((m) => m.id === step.mold_id) || null;
    const op = opById.get(step.operation_id) || null;
    const processDefault = op
      ? { default_cycle_sec: op.std_time_sec, default_oee: op.default_oee, constraint_type: op.constraint_type }
      : {};
    return resolveStandard({ ...step, key: step.id }, mold, processDefault);
  }), [steps, molds, opById]);

  const targetView = useMemo(() => {
    const cap = lineCapacity(resolvedOps);
    const rows = resolvedOps.map((r) => {
      if (!r.valid) return { r, na: true };
      const single = r.constraintType === 'machine' ? machineThroughput(r) : standardRatePerHour(r);
      if (r.constraintType === 'machine') {
        const perMachine = standardRatePerHour(r);
        const reqMachines = perMachine > 0 ? Math.ceil(targetRate / perMachine) : Infinity;
        return { r, type: 'machine', single, reqMachines, have: r.parallelMachines, short: reqMachines > r.parallelMachines, throughput: machineThroughput(r) };
      }
      const opsNeeded = operatorsFor(r, targetRate);
      return { r, type: 'labour', single, opsNeeded, throughput: standardRatePerHour(r) * opsNeeded };
    });
    const bnKey = cap.bottleneck?.key ?? null;
    return {
      rows: rows.map((row) => ({ ...row, bottleneck: !row.na && row.r.key === bnKey })),
      bottleneck: cap.bottleneck,
      achievableUph: cap.achievableUph,
      operators: rows.filter((row) => row.type === 'labour').reduce((s, row) => s + (row.opsNeeded || 0), 0),
    };
  }, [resolvedOps, targetRate]);

  const forwardView = useMemo(() => forwardLine(resolvedOps, resources), [resolvedOps, resources]);

  // Section 3 — fixed-pool optimizer: cheapest staffing (people + overtime) to hit the day's target.
  const ieOpts = useMemo(() => ({
    headcountPool: Number(headcountPool) || 0,
    targetQty: Number(targetDay) || 0,
    shiftHours: Number(shiftHours) || 0,
    maxOvertimeHours: Number(maxOvertime) || 0,
    rates: rates || {},
  }), [headcountPool, targetDay, shiftHours, maxOvertime, rates]);
  const ieResult = useMemo(() => planForTarget(resolvedOps, ieOpts), [resolvedOps, ieOpts]);
  const ieScenarios = useMemo(() => planScenarios(resolvedOps, ieOpts), [resolvedOps, ieOpts]);
  const matPc = Number(materialPerPc) || 0;
  // Full per-piece cost = material + conversion (labour + OT + machine + overhead).
  const fullCostPc = (cost) => +((Number(cost?.costPerPc) || 0) + matPc).toFixed(3);

  const anyDefault = resolvedOps.some((r) => r.valid && r.cycleSource === 'default');
  const validCount = resolvedOps.filter((r) => r.valid).length;
  const selectedProduct = products.find((p) => p.id === productId);

  // stage groups for the editor
  const stageGroups = useMemo(() => STAGES.map((stage) => ({
    stage,
    items: editSteps.filter((s) => s.department === stage),
  })), [editSteps]);

  const addOptions = addStage
    ? operations.filter((o) => CATEGORIES_FOR_STAGE[addStage].includes(o.category))
    : [];

  return (
    <Box sx={{ p: 3 }}>
      {/* Hero / header */}
      <Card sx={{ background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`, color: 'white', borderRadius: 3, mb: 2 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, py: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <PlantIcon sx={{ fontSize: 32 }} />
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>Line Planner</Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>Arrange the line — Assembly &middot; Moulding &middot; Packing &rarr; find the bottleneck &rarr; balance stations &amp; manpower.</Typography>
            </Box>
          </Box>
          <Stack direction="row" spacing={1}>
            <Tooltip title="Create the 3 sample power-cord routings (C10041 / C10053 / C10052) from the IE cycle-time sheet">
              <span>
                <Button onClick={runSeed} disabled={seeding} startIcon={seeding ? <CircularProgress size={16} color="inherit" /> : <SeedIcon />} variant="contained" color="secondary" sx={{ whiteSpace: 'nowrap' }}>
                  Load sample routings
                </Button>
              </span>
            </Tooltip>
            <BulkImportButton dataset="routings" label="Import routings" variant="contained" size="medium" onApplied={() => loadRouting(productId)} sx={{ whiteSpace: 'nowrap', bgcolor: 'rgba(255,255,255,0.18)', color: 'white', '&:hover': { bgcolor: 'rgba(255,255,255,0.28)' } }} />
            <Tooltip title="Reload"><IconButton onClick={load} sx={{ color: 'white' }}><RefreshIcon /></IconButton></Tooltip>
          </Stack>
        </CardContent>
      </Card>

      {/* Product picker */}
      <Card sx={{ borderRadius: 2, mb: 2 }}><CardContent>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
          <TextField select label="Product" value={productId} onChange={(e) => setProductId(e.target.value)} sx={{ minWidth: 320 }} disabled={loading || !products.length}>
            {products.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.product_name}{p.customer_code ? ` · ${p.customer_code}` : ''}{p.product_type ? ` · ${p.product_type}` : ''}
              </MenuItem>
            ))}
          </TextField>
          {selectedProduct && (
            <Typography variant="body2" color="text.secondary">
              {validCount} operation{validCount === 1 ? '' : 's'} with a standard{anyDefault ? ' · some use a default cycle' : ''}
            </Typography>
          )}
        </Stack>
      </CardContent></Card>

      {loading ? (
        <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>
      ) : !products.length ? (
        <Card sx={{ borderRadius: 2 }}><CardContent sx={{ textAlign: 'center', py: 6 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>No products yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Click <b>Load sample routings</b> to bring in the three power-cord products from your cycle-time sheet, then arrange and balance them here.</Typography>
          <Button onClick={runSeed} disabled={seeding} startIcon={<SeedIcon />} variant="contained">Load sample routings</Button>
        </CardContent></Card>
      ) : (
        <>
          {/* SECTION 1 — arrange the line sequence */}
          <Card sx={{ borderRadius: 2, mb: 2 }}><CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>1 · Arrange the line sequence</Typography>
              <Button onClick={save} disabled={!dirty || saving} startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />} variant="contained">
                {saving ? 'Saving…' : 'Save routing'}
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Pick the operations in each stage and set their cycle time, parallel stations and manpower band. Moulding stations use the <b>shot time</b> + <b>cavities</b>; assembly &amp; packing use <b>seconds per piece</b>. Save to update the balance below.
            </Typography>

            {routingLoading ? <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress /></Box> : stageGroups.map(({ stage, items }) => (
              <Box key={stage} sx={{ mb: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <Chip label={stage} color={stage === 'Moulding' ? 'info' : 'primary'} size="small" sx={{ fontWeight: 700 }} />
                  <Typography variant="caption" color="text.secondary">{items.length} op{items.length === 1 ? '' : 's'}</Typography>
                  <Button size="small" startIcon={<AddIcon />} onClick={() => setAddStage(stage)}>Add operation</Button>
                </Stack>
                {items.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ pl: 1, pb: 1 }}>No operations in this stage yet.</Typography>
                ) : (
                  <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
                    <Table size="small">
                      <TableHead><TableRow>
                        {['', 'Operation', stage === 'Moulding' ? 'Shot s' : 'Cycle s/pc', stage === 'Moulding' ? 'Cavities' : 'Stations', stage === 'Moulding' ? 'Machines' : 'Min ops', stage === 'Moulding' ? '—' : 'Max ops', 'OEE', 'Scrap %', 'Rate/hr', ''].map((h, i) => (
                          <TableCell key={i} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>
                        ))}
                      </TableRow></TableHead>
                      <TableBody>
                        {items.map((s) => {
                          const op = opById.get(s.operation_id);
                          const isMachine = (op?.constraint_type || (stage === 'Moulding' ? 'machine' : 'labour')) === 'machine';
                          const preview = resolveStandard({ ...s }, null, op ? { default_cycle_sec: op.std_time_sec, default_oee: op.default_oee, constraint_type: op.constraint_type } : {});
                          const rate = isMachine ? machineThroughput(preview) : standardRatePerHour(preview);
                          return (
                            <TableRow key={s._key} hover>
                              <TableCell sx={{ p: 0.5, width: 56 }}>
                                <Stack>
                                  <IconButton size="small" onClick={() => moveStep(s._key, -1)}><UpIcon fontSize="inherit" /></IconButton>
                                  <IconButton size="small" onClick={() => moveStep(s._key, 1)}><DownIcon fontSize="inherit" /></IconButton>
                                </Stack>
                              </TableCell>
                              <TableCell sx={{ fontWeight: 600, minWidth: 150 }}>{s.step_name || op?.name || 'Operation'}</TableCell>
                              <TableCell sx={{ width: 90 }}>
                                <TextField size="small" type="number" value={s.cycle_time_sec ?? ''} onChange={(e) => patchStep(s._key, { cycle_time_sec: e.target.value })} sx={{ width: 80 }} inputProps={{ step: 0.01, min: 0 }} />
                              </TableCell>
                              {isMachine ? (
                                <>
                                  <TableCell sx={{ width: 80 }}><TextField size="small" type="number" value={s.cavities ?? ''} onChange={(e) => patchStep(s._key, { cavities: e.target.value })} sx={{ width: 70 }} inputProps={{ min: 1 }} /></TableCell>
                                  <TableCell sx={{ width: 80 }}><TextField size="small" type="number" value={s.parallel_machines ?? ''} onChange={(e) => patchStep(s._key, { parallel_machines: e.target.value })} sx={{ width: 70 }} inputProps={{ min: 1 }} /></TableCell>
                                  <TableCell sx={{ color: 'text.disabled' }}>—</TableCell>
                                </>
                              ) : (
                                <>
                                  <TableCell sx={{ width: 80 }}><TextField size="small" type="number" value={s.parallel_machines ?? ''} onChange={(e) => patchStep(s._key, { parallel_machines: e.target.value })} sx={{ width: 70 }} inputProps={{ min: 1 }} title="Parallel stations available" /></TableCell>
                                  <TableCell sx={{ width: 80 }}><TextField size="small" type="number" value={s.min_operators ?? ''} onChange={(e) => patchStep(s._key, { min_operators: e.target.value })} sx={{ width: 70 }} inputProps={{ min: 1 }} /></TableCell>
                                  <TableCell sx={{ width: 80 }}><TextField size="small" type="number" value={s.max_operators ?? ''} onChange={(e) => patchStep(s._key, { max_operators: e.target.value })} sx={{ width: 70 }} inputProps={{ min: 1 }} /></TableCell>
                                </>
                              )}
                              <TableCell sx={{ width: 80 }}><TextField size="small" type="number" value={s.oee ?? ''} onChange={(e) => patchStep(s._key, { oee: e.target.value })} sx={{ width: 70 }} inputProps={{ step: 0.05, min: 0.01, max: 1 }} /></TableCell>
                              <TableCell sx={{ width: 80 }}><TextField size="small" type="number" value={s.scrap_pct ?? ''} onChange={(e) => patchStep(s._key, { scrap_pct: e.target.value })} sx={{ width: 70 }} inputProps={{ step: 0.01, min: 0, max: 0.99 }} /></TableCell>
                              <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{preview.valid ? `${fmt(rate)}/hr` : '—'}</TableCell>
                              <TableCell sx={{ width: 44 }}><Tooltip title="Remove"><IconButton size="small" onClick={() => removeStep(s._key)}><DeleteIcon fontSize="small" /></IconButton></Tooltip></TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Box>
            ))}
            <Typography variant="caption" color="text.secondary">Rate/hr is the <b>planned</b> good output (cavities &times; 3600/cycle &times; OEE, less scrap) for one station/machine. Stations multiply it.</Typography>
          </CardContent></Card>

          {/* SECTION 2 — balance both directions */}
          <Card sx={{ borderRadius: 2 }}><CardContent>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>2 · Balance the line</Typography>
            {dirty && <Alert severity="info" sx={{ mb: 2 }}>You have unsaved routing changes — the balance below reflects the last <b>saved</b> routing. Save to refresh it.</Alert>}
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
              <TextField type="number" label="Shift hours" value={shiftHours} onChange={(e) => setShiftHours(num(e.target.value, 8))} sx={{ width: 130 }} inputProps={{ min: 1, max: 24 }} />
              <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
                Day target at {fmt(targetRate)}/hr over {fmt(shiftHours)}h ≈ <b>{fmt(targetRate * shiftHours)}</b> pcs
              </Typography>
            </Stack>

            {validCount === 0 ? (
              <Alert severity="warning">This product&apos;s saved routing has no usable cycle time yet. Add operations above and click <b>Save routing</b>.</Alert>
            ) : (
              <>
                {/* Bottleneck hero */}
                {targetView.bottleneck && (
                  <Card variant="outlined" sx={{ borderColor: 'error.main', bgcolor: alpha(theme.palette.error.main, 0.05), mb: 2 }}><CardContent sx={{ py: 1.5 }}>
                    <Typography variant="body1" sx={{ fontWeight: 600, color: 'error.main' }}>
                      <WarnIcon sx={{ verticalAlign: 'middle', mr: 0.5 }} fontSize="small" />
                      Bottleneck: <b>{targetView.bottleneck.label}</b> — caps the line at {fmt(targetView.achievableUph)}/hr with one station each.{anyDefault && ' (estimated — some ops use a default cycle)'}
                    </Typography>
                  </CardContent></Card>
                )}

                <Stack direction={{ xs: 'column', xl: 'row' }} spacing={2} alignItems="stretch">
                  {/* LEFT — target -> resources */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                      <BalanceIcon fontSize="small" color="action" />
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Target → resources</Typography>
                    </Stack>
                    <TextField type="number" label="Target line rate (pcs/hr)" value={targetRate} onChange={(e) => setTargetRate(num(e.target.value, 0))} size="small" sx={{ width: 220, mb: 1 }} />
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Operators to balance assembly + packing: <b>{targetView.operators}</b></Typography>
                    <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1, overflowX: 'auto' }}>
                      <Table size="small">
                        <TableHead><TableRow>{['Operation', 'Src', 'Type', 'Single/hr', 'Need', 'At rate'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                        <TableBody>
                          {targetView.rows.map((row, i) => (
                            <TableRow key={row.r.key || i} hover sx={{ bgcolor: row.bottleneck ? alpha(theme.palette.error.main, 0.06) : 'inherit' }}>
                              <TableCell sx={{ fontWeight: 600 }}>{row.r.label}{row.bottleneck && <Chip size="small" color="error" label="bottleneck" sx={{ height: 18, ml: 0.5 }} />}</TableCell>
                              <TableCell><ProvenanceBadge source={row.r.cycleSource} /></TableCell>
                              <TableCell><Chip size="small" variant="outlined" label={row.na ? '—' : row.type} sx={{ height: 20, textTransform: 'capitalize' }} /></TableCell>
                              {row.na ? <TableCell colSpan={3}><Chip size="small" color="warning" label="no standard" sx={{ height: 20 }} /></TableCell> : (
                                <>
                                  <TableCell>{fmt(row.single)}</TableCell>
                                  <TableCell sx={{ fontWeight: 700, color: row.short ? 'error.main' : 'inherit', whiteSpace: 'nowrap' }}>
                                    {row.type === 'machine'
                                      ? <>{Number.isFinite(row.reqMachines) ? `${row.reqMachines} mach.` : '—'}{row.short ? ` (have ${row.have})` : ''}</>
                                      : `${row.opsNeeded} op${row.opsNeeded === 1 ? '' : 's'}`}
                                  </TableCell>
                                  <TableCell>{fmt(row.throughput)}/hr</TableCell>
                                </>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>

                  <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', xl: 'block' } }} />

                  {/* RIGHT — resources -> output */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                      <BalanceIcon fontSize="small" color="action" />
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Resources → output</Typography>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      Achievable line output: <b style={{ color: theme.palette.success.main }}>{fmt(forwardView.achievableUph)}/hr</b>
                      {forwardView.bottleneck && <> — gated by <b>{forwardView.bottleneck.label}</b></>}
                    </Typography>
                    <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1, overflowX: 'auto' }}>
                      <Table size="small">
                        <TableHead><TableRow>{['Operation', 'Type', 'You have', 'Per unit/hr', 'Station/hr'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                        <TableBody>
                          {forwardView.rows.map((row) => (
                            <TableRow key={row.key} hover sx={{ bgcolor: row.bottleneck ? alpha(theme.palette.error.main, 0.06) : 'inherit' }}>
                              <TableCell sx={{ fontWeight: 600 }}>{row.label}{row.bottleneck && <Chip size="small" color="error" label="gates" sx={{ height: 18, ml: 0.5 }} />}</TableCell>
                              <TableCell><Chip size="small" variant="outlined" label={row.type} sx={{ height: 20, textTransform: 'capitalize' }} /></TableCell>
                              <TableCell sx={{ width: 90 }}>
                                <TextField size="small" type="number" value={resources[row.key] ?? 1} onChange={(e) => setResources((m) => ({ ...m, [row.key]: Math.max(1, num(e.target.value, 1)) }))} sx={{ width: 70 }} inputProps={{ min: 1 }} />
                              </TableCell>
                              <TableCell>{fmt(row.perUnit)}</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>{fmt(row.throughput)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                      Enter the stations/operators you actually run; the line moves at its slowest station. Add stations to the bottleneck to lift it.
                    </Typography>
                  </Box>
                </Stack>
              </>
            )}
          </CardContent></Card>

          {/* SECTION 3 — manpower & overtime (fixed-pool optimizer) */}
          <Card sx={{ borderRadius: 2, mt: 2 }}><CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>3 · Manpower &amp; Overtime</Typography>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip size="small" variant="outlined" icon={<MoneyIcon />} label={`Labour ${money(rates?.labour_per_hr ?? 0)}/hr`} />
                <Chip size="small" variant="outlined" label={`OT ×${rates?.overtime_multiplier ?? 1.5}`} />
                <Chip size="small" variant="outlined" label={`Machine ${money(rates?.machine_per_hr ?? 0)}/hr`} />
                <Chip size="small" variant="outlined" label={`Overhead ${Math.round((rates?.indirect_pct ?? 0) * 100)}%`} />
                <Button size="small" startIcon={<EditIcon />} onClick={() => setRateDraft({
                  labour_per_hr: rates?.labour_per_hr ?? 80, overtime_multiplier: rates?.overtime_multiplier ?? 1.5,
                  machine_per_hr: rates?.machine_per_hr ?? 50, indirect_pct: rates?.indirect_pct ?? 0.15,
                })}>Edit rates</Button>
              </Stack>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Cheapest way to hit a day&apos;s target from a fixed crew: staff the labour stations, then add overtime only when the pool can&apos;t cover it. Machines (moulding) can&apos;t be sped up by people. <i>Full cost / piece = material + conversion (labour + OT + machine + overhead). Material pulls from the product&apos;s released costing.</i>
            </Typography>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
              <TextField type="number" label="Target / day (pcs)" value={targetDay} onChange={(e) => setTargetDay(num(e.target.value, 0))} size="small" sx={{ width: 170 }}
                helperText={`line target × shift = ${fmt(targetRate * shiftHours)}`} />
              <TextField type="number" label="Headcount pool" value={headcountPool} onChange={(e) => setHeadcountPool(num(e.target.value, 0))} size="small" sx={{ width: 150 }} helperText="operators available" />
              <TextField type="number" label="Max overtime (h)" value={maxOvertime} onChange={(e) => setMaxOvertime(num(e.target.value, 0))} size="small" sx={{ width: 150 }} inputProps={{ step: 0.5, min: 0 }} />
              <TextField type="number" label="Material ₹/pc" value={materialPerPc}
                onChange={(e) => { setMaterialPerPc(e.target.value); setMaterialMeta({ source: 'manual', label: 'manual override' }); }}
                size="small" sx={{ width: 160 }} inputProps={{ step: 0.01, min: 0 }}
                helperText={materialMeta?.label || 'material per piece'} />
            </Stack>

            {validCount === 0 ? (
              <Alert severity="warning">Save a routing above first — the manpower plan computes from it.</Alert>
            ) : (
              <Stack spacing={2}>
                {/* Verdict */}
                <Paper variant="outlined" sx={{ p: 2, borderWidth: 1.5, borderColor: ieResult.feasible ? 'success.main' : 'error.main', bgcolor: alpha(ieResult.feasible ? theme.palette.success.main : theme.palette.error.main, 0.05) }}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: ieResult.feasible ? 1 : 0 }}>
                    {ieResult.feasible ? <OkIcon color="success" /> : <WarnIcon color="error" />}
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>{ieResult.feasible ? `Make ${fmt(targetDay)}/day` : `Can't make ${fmt(targetDay)}/day`}</Typography>
                  </Stack>
                  {ieResult.feasible && (
                    <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
                      <Metric icon={<CrewIcon fontSize="small" />} label="Operators" value={ieResult.plan?.totalOperators ?? 0} />
                      <Metric icon={<ClockIcon fontSize="small" />} label="Overtime" value={`${ieResult.overtimeHours}h`} />
                      <Metric icon={<BalanceIcon fontSize="small" />} label="Line rate" value={`${fmt(ieResult.achievableUph)}/hr`} />
                      <Metric icon={<MoneyIcon fontSize="small" />} label={matPc > 0 ? 'Full cost / pc' : 'Conversion / pc'} value={money(fullCostPc(ieResult.cost))} highlight />
                    </Stack>
                  )}
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{ieResult.reason}{anyDefault && ' (estimated — some ops use a default cycle)'}</Typography>
                  {!ieResult.feasible && ieResult.unlock && (
                    <Box sx={{ mt: 1 }}>{ieResult.unlock.suggestions.map((s, i) => <Chip key={i} size="small" variant="outlined" color="warning" label={s} sx={{ mr: 0.5, mb: 0.5 }} />)}</Box>
                  )}
                </Paper>

                {/* Compare options */}
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Compare options (cheapest first)</Typography>
                  <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', pb: 1, pt: 1 }}>
                    {ieScenarios.map((s) => (
                      <Paper key={s.key} variant="outlined" sx={{ p: 1.5, minWidth: 160, flexShrink: 0, position: 'relative', borderWidth: s.recommended ? 1.5 : 1, borderColor: s.recommended ? 'success.main' : 'divider' }}>
                        {s.recommended && <Chip size="small" color="success" label="Recommended" sx={{ position: 'absolute', top: -10, right: 8, height: 18 }} />}
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{s.label}</Typography>
                        {s.result.feasible ? (
                          <>
                            <Typography variant="caption" color="text.secondary" display="block">{s.result.plan?.totalOperators} ops · {s.result.overtimeHours}h OT</Typography>
                            <Typography variant="h6" sx={{ fontWeight: 800, color: s.recommended ? 'success.main' : 'text.primary' }}>
                              {money(fullCostPc(s.result.cost))}<Typography component="span" variant="caption" color="text.secondary">/pc</Typography>
                            </Typography>
                            <Typography variant="caption" color="text.secondary">{money((Number(s.result.cost?.total) || 0) + matPc * (Number(targetDay) || 0))}/day</Typography>
                          </>
                        ) : <Typography variant="caption" color="error">Not achievable</Typography>}
                      </Paper>
                    ))}
                  </Stack>
                </Box>

                {/* Cost breakdown for the recommended plan */}
                {ieResult.feasible && ieResult.cost && (
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Cost breakdown <Chip size="small" variant="outlined" color="warning" label="estimated — uses master rates" sx={{ height: 18, ml: 0.5 }} /></Typography>
                    <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1, maxWidth: 460 }}>
                      <Table size="small">
                        <TableBody>
                          {[
                            ['Direct labour (shift hours)', ieResult.cost.labourCost],
                            ['Overtime (incl. premium)', ieResult.cost.overtimeCost],
                            ['Machine', ieResult.cost.machineCost],
                            ['Overhead', +(ieResult.cost.total - ieResult.cost.labourCost - ieResult.cost.overtimeCost - ieResult.cost.machineCost).toFixed(2)],
                          ].map(([label, val]) => (
                            <TableRow key={label}>
                              <TableCell>{label}</TableCell>
                              <TableCell align="right">{money(val)}/day</TableCell>
                              <TableCell align="right" sx={{ color: 'text.secondary' }}>{money((Number(targetDay) || 0) > 0 ? val / targetDay : 0)}/pc</TableCell>
                            </TableRow>
                          ))}
                          <TableRow sx={{ '& td': { fontWeight: 700, borderTop: `1px solid ${theme.palette.divider}` } }}>
                            <TableCell>Conversion subtotal</TableCell>
                            <TableCell align="right">{money(ieResult.cost.total)}/day</TableCell>
                            <TableCell align="right">{money(ieResult.cost.costPerPc)}/pc</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>Material{materialMeta?.source && materialMeta.source !== 'manual' ? ` (${materialMeta.label})` : materialMeta?.source === 'manual' ? ' (manual)' : ''}</TableCell>
                            <TableCell align="right">{money(matPc * (Number(targetDay) || 0))}/day</TableCell>
                            <TableCell align="right" sx={{ color: 'text.secondary' }}>{money(matPc)}/pc</TableCell>
                          </TableRow>
                          <TableRow sx={{ '& td': { fontWeight: 800, borderTop: `2px solid ${theme.palette.divider}` } }}>
                            <TableCell>Full cost{matPc > 0 ? '' : ' (conversion only — no material)'}</TableCell>
                            <TableCell align="right">{money(ieResult.cost.total + matPc * (Number(targetDay) || 0))}/day</TableCell>
                            <TableCell align="right">{money(fullCostPc(ieResult.cost))}/pc</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </TableContainer>
                    {materialMeta?.source === 'none' && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        No released costing for this product — material shows ₹0. Enter a material ₹/pc above, or release a costing in the Costing module to pull it automatically.
                      </Typography>
                    )}
                  </Box>
                )}
              </Stack>
            )}
          </CardContent></Card>
        </>
      )}

      {/* Add-operation dialog */}
      <Dialog open={!!addStage} onClose={() => setAddStage(null)} fullWidth maxWidth="xs">
        <DialogTitle>Add a {addStage} operation</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {addOptions.length === 0 ? (
            <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">No operations in the master for this stage. Add them under MES Setup → Operations.</Typography></Box>
          ) : (
            <List dense>
              {addOptions.map((op) => (
                <ListItemButton key={op.id} onClick={() => addOperation(addStage, op)}>
                  <ListItemText
                    primary={op.name}
                    secondary={`${op.category}${op.constraint_type ? ` · ${op.constraint_type}` : ''}${op.std_time_sec ? ` · ${op.std_time_sec}s default` : ''}`}
                  />
                  <AddIcon fontSize="small" color="action" />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setAddStage(null)}>Close</Button></DialogActions>
      </Dialog>

      {/* Labour & cost rates editor */}
      <Dialog open={!!rateDraft} onClose={() => setRateDraft(null)} fullWidth maxWidth="xs">
        <DialogTitle>Labour &amp; cost rates</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Labour ₹/hr" type="number" value={rateDraft?.labour_per_hr ?? ''} onChange={(e) => setRateDraft((d) => ({ ...d, labour_per_hr: e.target.value }))} size="small" />
            <TextField label="Overtime multiplier" type="number" value={rateDraft?.overtime_multiplier ?? ''} onChange={(e) => setRateDraft((d) => ({ ...d, overtime_multiplier: e.target.value }))} size="small" inputProps={{ step: 0.1, min: 1 }} helperText="e.g. 1.5 = 150% of base on OT hours" />
            <TextField label="Machine ₹/hr" type="number" value={rateDraft?.machine_per_hr ?? ''} onChange={(e) => setRateDraft((d) => ({ ...d, machine_per_hr: e.target.value }))} size="small" />
            <TextField label="Overhead / indirect %" type="number" value={rateDraft != null ? Math.round((Number(rateDraft.indirect_pct) || 0) * 100) : ''} onChange={(e) => setRateDraft((d) => ({ ...d, indirect_pct: (Number(e.target.value) || 0) / 100 }))} size="small" helperText="applied on top of direct cost" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRateDraft(null)} disabled={savingRates}>Cancel</Button>
          <Button onClick={saveRates} variant="contained" disabled={savingRates} startIcon={savingRates ? <CircularProgress size={16} /> : <SaveIcon />}>Save rates</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={6000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} onClose={() => setSnack(null)} variant="filled">{snack.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
};

export default LinePlanner;
