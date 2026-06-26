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
  Dialog, DialogTitle, DialogContent, DialogActions, ToggleButton, ToggleButtonGroup,
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
import { planForTarget, planScenarios } from '../../services/ie/ieScenario';
import { poolCapacityByType, scheduleMolding } from '../../services/ie/moldingPool';
import MoldingFleetDialog from '../../components/mes/MoldingFleetDialog';
import IeDashboards from '../../components/mes/IeDashboards';

const fmt = (x) => Math.round(Number(x) || 0).toLocaleString('en-IN');
const money = (x) => `₹${(Number(x) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const clock = (h) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0')}`;

export default function AssemblyPlanner() {
  const theme = useTheme();
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [steps, setSteps] = useState([]);
  const [molds, setMolds] = useState([]);
  const [operations, setOperations] = useState([]);
  const [rates, setRates] = useState(null);
  const [moldingMachines, setMoldingMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [routingLoading, setRoutingLoading] = useState(false);

  // planner inputs
  const [target, setTarget] = useState(5000);
  const [shiftHours, setShiftHours] = useState(8);
  const [headcountPool, setHeadcountPool] = useState(20);
  const [maxOvertime, setMaxOvertime] = useState(2);
  const [rateDraft, setRateDraft] = useState(null); // open cost-rate editor when set
  const [savingRates, setSavingRates] = useState(false);
  const [fleetOpen, setFleetOpen] = useState(false);
  const [view, setView] = useState('planner'); // 'planner' | 'dashboards'

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, mlds, ops, cr, mm] = await Promise.all([
        plmProductService.listProducts().catch(() => []),
        mesMasterService.listRows('molding_master').catch(() => []),
        mesService.listOperations({ includeInactive: false }).catch(() => []),
        ieService.getCostRates().catch(() => null),
        ieService.listMoldingMachines().catch(() => []),
      ]);
      setProducts(prods); setMolds(mlds); setOperations(ops); setRates(cr); setMoldingMachines(mm);
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

  const scenarios = useMemo(() => planScenarios(resolvedOps, {
    headcountPool: Number(headcountPool) || 0, targetQty: Number(target) || 0,
    shiftHours: Number(shiftHours) || 0, maxOvertimeHours: Number(maxOvertime) || 0, rates: rates || {},
  }), [resolvedOps, headcountPool, target, shiftHours, maxOvertime, rates]);

  const moldPool = useMemo(() => poolCapacityByType(moldingMachines), [moldingMachines]);
  // Which mold types this product routes through (from its steps' molds).
  const usedMoldTypes = useMemo(() => {
    const set = new Set();
    (steps || []).forEach((s) => { const m = molds.find((x) => x.id === s.mold_id); if (m?.mold_type) set.add(m.mold_type); });
    return set;
  }, [steps, molds]);
  const moldSchedule = useMemo(() => {
    const hasMolding = resolvedOps.some((r) => r.valid && r.constraintType === 'machine');
    const demand = { inner: 0, outer: 0, grommet: 0 };
    if (hasMolding && Number(target) > 0) {
      const used = usedMoldTypes.size ? usedMoldTypes : new Set(['inner', 'outer', 'grommet']);
      used.forEach((t) => { if (t in demand) demand[t] = Number(target); });
    }
    return scheduleMolding(moldingMachines, demand, 9).filter((r) => r.assignedQty > 0);
  }, [moldingMachines, resolvedOps, usedMoldTypes, target]);
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
        <Typography variant="h6" sx={{ fontWeight: 800, flexGrow: 1 }}>Assembly Planner</Typography>
        <Button size="small" variant="outlined" startIcon={<PaymentsRounded />}
          onClick={() => setRateDraft({
            labour_per_hr: rates?.labour_per_hr ?? 80, overtime_multiplier: rates?.overtime_multiplier ?? 1.5,
            machine_per_hr: rates?.machine_per_hr ?? 50, indirect_pct: rates?.indirect_pct ?? 0.15,
          })}>Cost rates</Button>
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
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, v) => v && setView(v)} sx={{ alignSelf: 'flex-start' }}>
            <ToggleButton value="planner">Planner</ToggleButton>
            <ToggleButton value="dashboards">Dashboards</ToggleButton>
          </ToggleButtonGroup>
          {view === 'dashboards' ? (
            <IeDashboards result={result} scenarios={scenarios} moldSchedule={moldSchedule} moldPool={moldPool}
              target={Number(target) || 0} shiftHours={Number(shiftHours) || 0} headcountPool={Number(headcountPool) || 0} />
          ) : (
          <>
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

          {/* Compare options (scenarios) */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography sx={{ fontWeight: 700, mb: 1.5 }}>Compare options</Typography>
            <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', pb: 1, pt: 1 }}>
              {scenarios.map((s) => {
                const r = s.result;
                return (
                  <Paper key={s.key} variant="outlined"
                    onClick={() => setMaxOvertime(s.key === 'no_ot' ? 0 : s.key === 'fewest_ops' ? Math.max(Number(maxOvertime) || 0, 4) : (Number(maxOvertime) || 2))}
                    sx={{ p: 1.5, minWidth: 150, flexShrink: 0, cursor: 'pointer', position: 'relative',
                      borderColor: s.recommended ? 'success.main' : 'divider', borderWidth: s.recommended ? 1.5 : 1 }}>
                    {s.recommended && <Chip size="small" color="success" label="Recommended" sx={{ position: 'absolute', top: -10, right: 8, height: 18 }} />}
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{s.label}</Typography>
                    {r.feasible ? (
                      <>
                        <Typography variant="caption" color="text.secondary" display="block">{r.plan.totalOperators} ops · {r.overtimeHours}h OT</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 800, color: s.recommended ? 'success.main' : 'text.primary' }}>
                          {money(r.cost?.costPerPc)}<Typography component="span" variant="caption" color="text.secondary">/pc</Typography>
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="caption" color="error">Not achievable</Typography>
                    )}
                  </Paper>
                );
              })}
            </Stack>
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

          {/* Shared molding pool (IE P3) */}
          {moldingMachines.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography sx={{ fontWeight: 700 }}>Shared molding pool</Typography>
                <Button size="small" variant="text" onClick={() => setFleetOpen(true)}>Edit fleet</Button>
              </Stack>
              <Stack direction="row" spacing={3} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
                {['inner', 'outer', 'grommet'].map((t) => (
                  <Box key={t}>
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{t} mold</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>{fmt(moldPool[t] || 0)}<Typography component="span" variant="caption" color="text.secondary">/day</Typography></Typography>
                    {target > 0 && (moldPool[t] || 0) > 0 && (
                      <Chip size="small" color={(moldPool[t] || 0) >= Number(target) ? 'success' : 'error'} variant="outlined"
                        label={`${Math.round((Number(target) / (moldPool[t] || 1)) * 100)}% of target`} sx={{ height: 18, mt: 0.25 }} />
                    )}
                  </Box>
                ))}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {moldingMachines.length} machines (shared across lines). Edit the fleet in MES masters; daily capacity = cavities × (3600/cycle) × hours.
              </Typography>
            </Paper>
          )}

          {/* Per-machine molding schedule (IE P3 — finite sequencer) */}
          {moldSchedule.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography sx={{ fontWeight: 700, mb: 1 }}>Molding machine schedule</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Machine</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell>Window</TableCell>
                    <TableCell align="right">Util</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {moldSchedule.map((r) => (
                    <TableRow key={r.machine.id || r.machine.machine_code} hover sx={{ bgcolor: r.utilization >= 100 ? alpha(theme.palette.error.main, 0.05) : 'inherit' }}>
                      <TableCell sx={{ fontWeight: 600 }}>{r.machine.machine_code}</TableCell>
                      <TableCell><Chip size="small" variant="outlined" label={r.type} sx={{ height: 20, textTransform: 'capitalize' }} /></TableCell>
                      <TableCell align="right">{fmt(r.assignedQty)}</TableCell>
                      <TableCell>{clock(r.startHour)}–{clock(r.finishHour)} · {r.runHours}h</TableCell>
                      <TableCell align="right"><Chip size="small" color={r.utilization >= 95 ? 'error' : r.utilization >= 75 ? 'warning' : 'success'} label={`${r.utilization}%`} sx={{ height: 20 }} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Typography variant="caption" color="text.secondary">Each type's demand splits across its machines to finish together (balanced makespan). Start assumed 09:00.</Typography>
            </Paper>
          )}
          </>
          )}
        </Stack>
      )}

      <Dialog open={!!rateDraft} onClose={() => !savingRates && setRateDraft(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Cost rates</DialogTitle>
        <DialogContent dividers>
          {rateDraft && (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <TextField label="Labour ₹/hr" type="number" value={rateDraft.labour_per_hr} onChange={(e) => setRateDraft((d) => ({ ...d, labour_per_hr: e.target.value }))} fullWidth />
              <TextField label="Overtime multiplier" type="number" value={rateDraft.overtime_multiplier} onChange={(e) => setRateDraft((d) => ({ ...d, overtime_multiplier: e.target.value }))} fullWidth helperText="e.g. 1.5 = 150% of the labour rate" />
              <TextField label="Machine ₹/hr" type="number" value={rateDraft.machine_per_hr} onChange={(e) => setRateDraft((d) => ({ ...d, machine_per_hr: e.target.value }))} fullWidth />
              <TextField label="Indirect %" type="number" value={rateDraft.indirect_pct} onChange={(e) => setRateDraft((d) => ({ ...d, indirect_pct: e.target.value }))} fullWidth helperText="fraction, e.g. 0.15 = +15%" />
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRateDraft(null)} disabled={savingRates}>Cancel</Button>
          <Button variant="contained" disabled={savingRates} onClick={async () => {
            setSavingRates(true);
            try { await ieService.saveCostRates(rateDraft); setRates(await ieService.getCostRates()); setRateDraft(null); }
            catch { /* surface via console; non-blocking */ }
            finally { setSavingRates(false); }
          }}>{savingRates ? 'Saving…' : 'Save rates'}</Button>
        </DialogActions>
      </Dialog>

      <MoldingFleetDialog open={fleetOpen} onClose={() => setFleetOpen(false)}
        onSaved={async () => { try { setMoldingMachines(await ieService.listMoldingMachines()); } catch { /* keep last */ } }} />
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
