import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Stack, Card, CardContent, Typography, TextField, IconButton, Chip, Divider, Tooltip,
  useTheme, alpha,
} from '@mui/material';
import {
  Speed as CapIcon, Refresh as RefreshIcon, WarningAmber as WarnIcon, Add as PlusIcon, Remove as MinusIcon,
} from '@mui/icons-material';
import mesMasterService from '../../services/mesMasterService';

// hours (decimal) added to a start hour -> "HH:MM"
const toTime = (startHour, addHours) => {
  let t = (Number(startHour) || 0) + (Number(addHours) || 0);
  t = ((t % 24) + 24) % 24;
  const h = Math.floor(t); const m = Math.round((t - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}`;
};
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

// Department capacity models (pcs/hour).
function capPerHour(d) {
  if (d.model === 'molding') return (Number(d.machines) || 0) * (Number(d.cavities) || 1) * (Number(d.cycleSec) > 0 ? 3600 / Number(d.cycleSec) : 0);
  if (d.model === 'packing') return (Number(d.operators) || 0) * (Number(d.cycleSec) > 0 ? 3600 / Number(d.cycleSec) : 0);
  return (Number(d.operators) || 0) * (Number(d.uph) || 0); // assembly
}

const CapacityPlanner = () => {
  const theme = useTheme();
  const [qty, setQty] = useState(1000);
  const [shiftStart, setShiftStart] = useState(9);
  const [shiftHours, setShiftHours] = useState(8);
  const [depts, setDepts] = useState([
    { key: 'assembly', name: 'Assembly', model: 'assembly', operators: 12, uph: 35, note: 'planned as one block' },
    { key: 'molding', name: 'Molding', model: 'molding', machines: 3, cavities: 1, cycleSec: 55, note: 'inner / outer / grommet' },
    { key: 'packing', name: 'Packing', model: 'packing', operators: 6, cycleSec: 18, note: 'folding is the bottleneck' },
  ]);

  // Pull molding machine defaults from the master if present
  const loadDefaults = useCallback(async () => {
    try {
      const molds = await mesMasterService.listRows('molding_master');
      const active = molds.filter((m) => m.status === 'active' && m.cycle_time_sec);
      if (active.length) {
        const cav = Math.round(active.reduce((s, m) => s + (Number(m.cavity_count) || 1), 0) / active.length);
        const cyc = Math.round(active.reduce((s, m) => s + Number(m.cycle_time_sec), 0) / active.length);
        setDepts((ds) => ds.map((d) => d.key === 'molding' ? { ...d, machines: active.length, cavities: cav, cycleSec: cyc } : d));
      }
    } catch { /* keep defaults */ }
  }, []);
  useEffect(() => { loadDefaults(); }, [loadDefaults]);

  const setD = (key, field, val) => setDepts((ds) => ds.map((d) => d.key === key ? { ...d, [field]: val } : d));

  const computed = useMemo(() => {
    const rows = depts.map((d) => {
      const cap = capPerHour(d);
      const reqHr = cap > 0 ? qty / cap : Infinity;
      const ot = Math.max(0, reqHr - shiftHours);
      return { ...d, cap: round1(cap), reqHr: cap > 0 ? round1(reqHr) : null, ot: round1(ot), end: cap > 0 ? toTime(shiftStart, reqHr) : '—' };
    });
    const valid = rows.filter((r) => r.reqHr != null);
    const maxReq = valid.length ? Math.max(...valid.map((r) => r.reqHr)) : 0;
    return rows.map((r) => ({ ...r, bottleneck: r.reqHr != null && r.reqHr === maxReq && maxReq > 0 }));
  }, [depts, qty, shiftHours, shiftStart]);

  const Stepper = ({ label, value, onChange, step = 1 }) => (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <IconButton size="small" onClick={() => onChange(Math.max(0, (Number(value) || 0) - step))}><MinusIcon fontSize="small" /></IconButton>
      <TextField size="small" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))} label={label}
        inputProps={{ inputMode: 'numeric', style: { textAlign: 'center', width: 56 } }} />
      <IconButton size="small" onClick={() => onChange((Number(value) || 0) + step)}><PlusIcon fontSize="small" /></IconButton>
    </Stack>
  );

  return (
    <Box sx={{ p: 3 }}>
      <Card sx={{ background: `linear-gradient(135deg, ${theme.palette.warning.dark} 0%, ${theme.palette.error.dark} 100%)`, color: 'white', borderRadius: 3, mb: 2 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, py: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CapIcon sx={{ fontSize: 32 }} />
            <Box><Typography variant="h5" sx={{ fontWeight: 700 }}>Capacity & Overtime Planner</Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>Hours, overtime and the bottleneck across Assembly · Molding · Packing.</Typography></Box>
          </Box>
          <Tooltip title="Reload mold defaults"><IconButton onClick={loadDefaults} sx={{ color: 'white' }}><RefreshIcon /></IconButton></Tooltip>
        </CardContent>
      </Card>

      {/* Inputs */}
      <Card sx={{ borderRadius: 2, mb: 2 }}><CardContent>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
          <TextField type="number" label="Quantity to make" value={qty} onChange={(e) => setQty(Number(e.target.value) || 0)} sx={{ width: 170 }} />
          <TextField type="number" label="Shift start (hr)" value={shiftStart} onChange={(e) => setShiftStart(Number(e.target.value) || 0)} sx={{ width: 130 }} />
          <TextField type="number" label="Shift hours" value={shiftHours} onChange={(e) => setShiftHours(Number(e.target.value) || 0)} sx={{ width: 120 }} />
          <Typography variant="body2" color="text.secondary">Normal shift: {toTime(shiftStart, 0)} → {toTime(shiftStart, shiftHours)}</Typography>
        </Stack>
      </CardContent></Card>

      {/* Department cards */}
      <Stack spacing={2}>
        {computed.map((d) => (
          <Card key={d.key} sx={{ borderRadius: 2, border: '2px solid', borderColor: d.bottleneck ? 'error.main' : 'divider' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} sx={{ mb: 1.5 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>{d.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{d.note}</Typography>
                  {d.bottleneck && <Chip size="small" color="error" icon={<WarnIcon />} label="BOTTLENECK" />}
                </Stack>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Box sx={{ textAlign: 'center' }}><Typography variant="caption" color="text.secondary">Capacity/hr</Typography><Typography variant="h6" sx={{ fontWeight: 700 }}>{d.cap}</Typography></Box>
                  <Box sx={{ textAlign: 'center' }}><Typography variant="caption" color="text.secondary">Hours needed</Typography><Typography variant="h6" sx={{ fontWeight: 700, color: d.bottleneck ? 'error.main' : 'text.primary' }}>{d.reqHr ?? '—'}</Typography></Box>
                  <Box sx={{ textAlign: 'center' }}><Typography variant="caption" color="text.secondary">Overtime</Typography><Typography variant="h6" sx={{ fontWeight: 700, color: d.ot > 0 ? 'warning.main' : 'success.main' }}>{d.ot > 0 ? `${d.ot}h` : '—'}</Typography></Box>
                  <Box sx={{ textAlign: 'center', minWidth: 110, bgcolor: alpha(theme.palette.primary.main, 0.06), borderRadius: 1, px: 1, py: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">Come → Leave</Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{toTime(shiftStart, 0)} → {d.end}</Typography>
                  </Box>
                </Stack>
              </Stack>
              <Divider sx={{ mb: 1.5 }} />
              <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap alignItems="center">
                {d.model === 'molding' ? (
                  <>
                    <Stepper label="Machines" value={d.machines} onChange={(v) => setD(d.key, 'machines', v)} />
                    <Stepper label="Cavities" value={d.cavities} onChange={(v) => setD(d.key, 'cavities', v)} />
                    <Stepper label="Cycle (s)" value={d.cycleSec} onChange={(v) => setD(d.key, 'cycleSec', v)} step={5} />
                    <Typography variant="caption" color="text.secondary">per machine: {round1((Number(d.cavities) || 1) * (Number(d.cycleSec) > 0 ? 3600 / Number(d.cycleSec) : 0))}/hr</Typography>
                  </>
                ) : d.model === 'packing' ? (
                  <>
                    <Stepper label="Operators" value={d.operators} onChange={(v) => setD(d.key, 'operators', v)} />
                    <Stepper label="Fold cycle (s)" value={d.cycleSec} onChange={(v) => setD(d.key, 'cycleSec', v)} step={2} />
                  </>
                ) : (
                  <>
                    <Stepper label="Operators" value={d.operators} onChange={(v) => setD(d.key, 'operators', v)} />
                    <Stepper label="UPH/op" value={d.uph} onChange={(v) => setD(d.key, 'uph', v)} step={5} />
                  </>
                )}
              </Stack>
              {d.bottleneck && d.ot > 0 && (
                <Typography variant="body2" sx={{ mt: 1.5, color: 'error.main', fontWeight: 600 }}>
                  ⚠ {d.name} is the bottleneck — needs {d.ot}h overtime (leave by {d.end}). Add {d.model === 'molding' ? 'a machine' : 'an operator'} or run the overtime.
                </Typography>
              )}
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Card sx={{ borderRadius: 2, mt: 2, bgcolor: alpha(theme.palette.warning.main, 0.06) }}><CardContent>
        <Typography variant="body2">
          <b>Plan summary:</b> to make {qty} pcs, the line is paced by <b>{computed.find((d) => d.bottleneck)?.name || '—'}</b> at{' '}
          {computed.find((d) => d.bottleneck)?.reqHr ?? '—'}h. Other departments finish earlier and can be planned as a block.
          Adjust machines / operators / cycle above to clear overtime.
        </Typography>
      </CardContent></Card>
    </Box>
  );
};

export default CapacityPlanner;
