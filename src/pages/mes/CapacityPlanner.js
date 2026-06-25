import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Stack, Card, CardContent, Typography, TextField, IconButton, Chip, Tooltip, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, CircularProgress,
  useTheme, alpha,
} from '@mui/material';
import {
  Speed as CapIcon, Refresh as RefreshIcon, WarningAmber as WarnIcon, Add as PlusIcon, Remove as MinusIcon,
} from '@mui/icons-material';
import mesService from '../../services/mesService';
import mesMasterService from '../../services/mesMasterService';

// hours (decimal) added to a start hour -> "HH:MM"
const toTime = (startHour, addHours) => {
  let t = (Number(startHour) || 0) + (Number(addHours) || 0);
  t = ((t % 24) + 24) % 24;
  const h = Math.floor(t); const m = Math.round((t - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}`;
};
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

const DEFAULT_MOLD = { inner_molding: { machines: 2, cavities: 1 }, outer_molding: { machines: 1, cavities: 1 }, grommet_molding: { machines: 1, cavities: 1 } };

const CapacityPlanner = () => {
  const theme = useTheme();
  const [ops, setOps] = useState([]);
  const [loading, setLoading] = useState(true);
  // INPUTS — operators are NOT an input. Target UPH is.
  const [qty, setQty] = useState(60000);
  const [targetUph, setTargetUph] = useState(600);
  const [shiftStart, setShiftStart] = useState(9);
  const [shiftHours, setShiftHours] = useState(8);
  const [mold, setMold] = useState(DEFAULT_MOLD); // per molding op: { machines, cavities }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const o = await mesService.listOperations({ includeInactive: false });
      setOps(o);
      // pull machine/cavity defaults from molding_master if present
      const molds = await mesMasterService.listRows('molding_master').catch(() => []);
      const active = molds.filter((m) => m.status === 'active');
      if (active.length) {
        const byType = {};
        active.forEach((m) => { const t = `${m.mold_type}_molding`; byType[t] = byType[t] || { machines: 0, cavities: 0, n: 0 }; byType[t].machines += 1; byType[t].cavities += Number(m.cavity_count) || 1; byType[t].n += 1; });
        setMold((prev) => {
          const next = { ...prev };
          Object.entries(byType).forEach(([k, v]) => { if (next[k]) next[k] = { machines: v.machines, cavities: Math.round(v.cavities / v.n) }; });
          return next;
        });
      }
    } catch { setOps([]); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const plan = useMemo(() => {
    const requiredCycle = targetUph > 0 ? 3600 / targetUph : 0; // sec/pc the LINE must hold
    const completionHrs = targetUph > 0 ? qty / targetUph : 0;
    const overtime = Math.max(0, completionHrs - shiftHours);

    const sectionFor = (c) => (c === 'molding' ? 'Molding' : c === 'packing' ? 'Packing' : c === 'testing' ? 'Packing' : 'Assembly');
    const stations = ops.filter((o) => Number(o.std_time_sec) > 0).map((o) => {
      const cycle = Number(o.std_time_sec);
      if (o.category === 'molding') {
        const cfg = mold[o.operation_code] || { machines: 1, cavities: 1 };
        const perMachine = cfg.cavities * (3600 / cycle);          // pcs/hr per machine
        const reqMachines = perMachine > 0 ? Math.ceil(targetUph / perMachine) : Infinity;
        const avail = cfg.machines;
        const capacity = avail * perMachine;
        return {
          ...o, section: 'Molding', type: 'machine', cycle, perMachine: r1(perMachine),
          reqMachines, avail, capacity: r1(capacity), util: capacity > 0 ? Math.round((targetUph / capacity) * 100) : 0,
          short: reqMachines > avail, resource: `${reqMachines} machine(s)`, recommend: reqMachines,
        };
      }
      // labour station: one operator does 3600/cycle; operators needed (parallel) to hold the line rate
      const reqOps = Math.max(1, Math.ceil(cycle / requiredCycle));
      const throughput = reqOps * (3600 / cycle);
      return {
        ...o, section: sectionFor(o.category), type: 'labour', cycle,
        reqOps, throughput: r1(throughput), util: throughput > 0 ? Math.round((targetUph / throughput) * 100) : 0,
        short: false, resource: `${reqOps} operator(s)`, recommend: reqOps,
      };
    });

    // bottleneck: any machine station short of machines is a hard bottleneck;
    // else the labour station that needs the most operators (slowest single station).
    const hardBn = stations.filter((s) => s.short);
    const labour = stations.filter((s) => s.type === 'labour');
    const maxOps = labour.length ? Math.max(...labour.map((s) => s.reqOps)) : 0;
    const tagged = stations.map((s) => ({ ...s, bottleneck: s.short || (s.type === 'labour' && s.reqOps === maxOps && maxOps > 1) }));

    const totalOperators = stations.filter((s) => s.type === 'labour').reduce((a, s) => a + s.reqOps, 0);
    const sections = ['Assembly', 'Molding', 'Packing'].map((sec) => ({ name: sec, rows: tagged.filter((s) => s.section === sec) })).filter((s) => s.rows.length);
    return { requiredCycle: r1(requiredCycle), completionHrs: r1(completionHrs), overtime: r1(overtime), finish: toTime(shiftStart, completionHrs), totalOperators, sections, tagged, hardBn };
  }, [ops, qty, targetUph, shiftStart, shiftHours, mold]);

  const Stepper = ({ value, onChange, step = 1, w = 70 }) => (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <IconButton size="small" onClick={() => onChange(Math.max(0, (Number(value) || 0) - step))}><MinusIcon fontSize="small" /></IconButton>
      <TextField size="small" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))} inputProps={{ inputMode: 'numeric', style: { textAlign: 'center', width: w } }} />
      <IconButton size="small" onClick={() => onChange((Number(value) || 0) + step)}><PlusIcon fontSize="small" /></IconButton>
    </Stack>
  );
  const setMoldCfg = (code, k, v) => setMold((m) => ({ ...m, [code]: { ...m[code], [k]: Number(v) || 0 } }));

  return (
    <Box sx={{ p: 3 }}>
      <Card sx={{ background: `linear-gradient(135deg, ${theme.palette.warning.dark} 0%, ${theme.palette.error.dark} 100%)`, color: 'white', borderRadius: 3, mb: 2 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, py: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CapIcon sx={{ fontSize: 32 }} />
            <Box><Typography variant="h5" sx={{ fontWeight: 700 }}>Line Balancing & Capacity Engine</Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>Target UPH → required cycle → operators &amp; machines are the output.</Typography></Box>
          </Box>
          <Tooltip title="Reload"><IconButton onClick={load} sx={{ color: 'white' }}><RefreshIcon /></IconButton></Tooltip>
        </CardContent>
      </Card>

      {/* INPUTS */}
      <Card sx={{ borderRadius: 2, mb: 2 }}><CardContent>
        <Typography variant="overline" color="text.secondary">Plan inputs</Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center" sx={{ mt: 0.5 }}>
          <TextField type="number" label="Order quantity" value={qty} onChange={(e) => setQty(Number(e.target.value) || 0)} sx={{ width: 160 }} />
          <TextField type="number" label="Target UPH (line rate)" value={targetUph} onChange={(e) => setTargetUph(Number(e.target.value) || 0)} sx={{ width: 190 }} />
          <TextField type="number" label="Shift start (hr)" value={shiftStart} onChange={(e) => setShiftStart(Number(e.target.value) || 0)} sx={{ width: 130 }} />
          <TextField type="number" label="Shift hours" value={shiftHours} onChange={(e) => setShiftHours(Number(e.target.value) || 0)} sx={{ width: 120 }} />
        </Stack>
      </CardContent></Card>

      {/* LINE SUMMARY (outputs) */}
      <Card sx={{ borderRadius: 2, mb: 2, bgcolor: alpha(theme.palette.primary.main, 0.04) }}><CardContent>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(3,1fr)', md: 'repeat(6,1fr)' }, gap: 2 }}>
          {[['Required cycle', `${plan.requiredCycle}s/pc`, 'primary.main'], ['Completion', `${plan.completionHrs}h`, 'text.primary'],
            ['Overtime', plan.overtime > 0 ? `${plan.overtime}h` : '—', plan.overtime > 0 ? 'warning.main' : 'success.main'],
            ['Finish by', plan.finish, 'text.primary'], ['Operators needed', plan.totalOperators, 'secondary.main'],
            ['Bottleneck', plan.hardBn.length ? plan.hardBn[0].name : (plan.tagged.find((s) => s.bottleneck)?.name || 'none'), 'error.main']].map(([l, v, c]) => (
            <Box key={l}><Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.56rem', display: 'block' }}>{l}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 800, color: c }}>{v}</Typography></Box>
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          To run at {targetUph}/hr the line must hold a {plan.requiredCycle}s cycle. Each station below is staffed/machined to keep that pace — that's how the bottleneck is freed. Operators are the result, not a dial that changes UPH.
        </Typography>
      </CardContent></Card>

      {loading ? <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box> : plan.sections.length === 0 ? (
        <Card sx={{ borderRadius: 2 }}><CardContent sx={{ textAlign: 'center', py: 5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>No operations with STD time</Typography>
          <Typography variant="body2" color="text.secondary">Set STD cycle time on operations in MES Setup → Assembly Operations.</Typography>
        </CardContent></Card>
      ) : plan.sections.map((sec) => (
        <Card key={sec.name} sx={{ borderRadius: 2, mb: 2 }}><CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>{sec.name}{sec.name === 'Molding' && <Typography component="span" variant="caption" color="text.secondary"> — machine-constrained, planned per machine</Typography>}</Typography>
          <Divider sx={{ mb: 1 }} />
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
            <Table size="small">
              <TableHead><TableRow>
                {(sec.name === 'Molding'
                  ? ['Operation', 'Cycle (s)', 'Machines', 'Cavities', 'Per machine/hr', 'Req machines', 'Util', 'Split / machine']
                  : ['Operation', 'Cycle (s)', 'Req cycle (s)', 'Operators needed', 'Throughput/hr', 'Util', '']
                ).map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}
              </TableRow></TableHead>
              <TableBody>
                {sec.rows.map((s) => (
                  <TableRow key={s.id} hover sx={{ bgcolor: s.bottleneck ? alpha(theme.palette.error.main, 0.07) : 'inherit' }}>
                    <TableCell sx={{ fontWeight: 600 }}>{s.name}{s.bottleneck && <Chip size="small" color="error" icon={<WarnIcon />} label="bottleneck" sx={{ height: 18, ml: 0.5 }} />}</TableCell>
                    <TableCell>{s.cycle}</TableCell>
                    {s.type === 'machine' ? (
                      <>
                        <TableCell><Stepper value={s.avail} onChange={(v) => setMoldCfg(s.operation_code, 'machines', v)} w={40} /></TableCell>
                        <TableCell><Stepper value={(mold[s.operation_code] || {}).cavities ?? 1} onChange={(v) => setMoldCfg(s.operation_code, 'cavities', v)} w={40} /></TableCell>
                        <TableCell>{s.perMachine}</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: s.short ? 'error.main' : 'inherit' }}>{s.reqMachines}{s.short ? ` (have ${s.avail})` : ''}</TableCell>
                        <TableCell><Chip size="small" label={`${s.util}%`} color={s.util > 100 ? 'error' : s.util > 85 ? 'warning' : 'default'} sx={{ height: 20 }} /></TableCell>
                        <TableCell>{Math.round(qty / Math.max(s.avail, 1)).toLocaleString('en-IN')} pcs × {s.avail}</TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell>{plan.requiredCycle}</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: s.bottleneck ? 'error.main' : 'inherit' }}>{s.reqOps}</TableCell>
                        <TableCell>{s.throughput}{s.throughput >= targetUph && <Chip size="small" color="success" label="ok" sx={{ height: 16, ml: 0.5 }} />}</TableCell>
                        <TableCell><Chip size="small" label={`${s.util}%`} color={s.util > 100 ? 'error' : s.util > 85 ? 'warning' : 'default'} sx={{ height: 20 }} /></TableCell>
                        <TableCell />
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent></Card>
      ))}

      {plan.hardBn.length > 0 && (
        <Card sx={{ borderRadius: 2, border: '1px solid', borderColor: 'error.main', bgcolor: alpha(theme.palette.error.main, 0.05) }}><CardContent sx={{ py: 1.5 }}>
          <Typography variant="body1" sx={{ fontWeight: 600, color: 'error.main' }}>
            <WarnIcon sx={{ verticalAlign: 'middle', mr: 0.5 }} fontSize="small" /> Hard bottleneck: {plan.hardBn.map((b) => `${b.name} needs ${b.reqMachines} machines (have ${b.avail})`).join('; ')}.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Add a machine, lower the target UPH, or add overtime to clear it. (Operators alone won't lift a machine-constrained station.)</Typography>
        </CardContent></Card>
      )}
    </Box>
  );
};

export default CapacityPlanner;
