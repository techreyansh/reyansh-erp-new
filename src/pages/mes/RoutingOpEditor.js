import React, { useMemo, useState } from 'react';
import {
  Box, Stack, Typography, Button, IconButton, Chip, Divider, Tooltip, Link, TextField, MenuItem,
  Accordion, AccordionSummary, AccordionDetails, Collapse, FormControlLabel, Checkbox,
} from '@mui/material';
import {
  ArrowUpward as ArrowUpIcon, ArrowDownward as ArrowDownIcon, ContentCopy as CopyIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';

/**
 * RoutingOpEditor — one routing operation rendered as a compact summary row that
 * expands (accordion) to a conditional editor. Fields shown depend on the op's
 * operation category (molding vs labour). Inherited values (from a bound mold or
 * the operation default) render as greyed PLACEHOLDERS, never as fake editable
 * numbers — a blank field means "inherit at run time". Mold binding auto-fills
 * cavities/cycle as read-only inherited values with an explicit per-field Override.
 *
 * Props:
 *   step, index, total, op (matched assembly_operation | undefined), molds (array),
 *   onChange(index, key, value), onMove(index, dir), onDup(index), onDel(index)
 */

// A field is "overridden" only when the user has typed a value into it (non-empty).
const has = (v) => v !== '' && v !== null && v !== undefined;
const num = (v) => (has(v) ? Number(v) : null);

export default function RoutingOpEditor({ step, index, op, total, molds, onChange, onMove, onDup, onDel }) {
  const [advanced, setAdvanced] = useState(false);

  const category = op?.category || step.department || '';
  const isMolding = category === 'molding';
  const isLabour = category === 'assembly' || category === 'cutting' || category === 'packing';

  // Bound mold (if any) supplies inherited cavities + cycle.
  const boundMold = useMemo(
    () => (step.mold_id ? molds.find((m) => m.id === step.mold_id) : null),
    [step.mold_id, molds],
  );

  // Molds available for this op: prefer ones matching the op's category-implied
  // mold_type; fall back to all active molds so nothing is hidden.
  const moldChoices = useMemo(() => {
    const active = (molds || []).filter((m) => m.status !== 'inactive' && m.status !== 'retired');
    return active;
  }, [molds]);

  // Inherited values: from mold first, then the operation default.
  const inheritedCavities = boundMold?.cavity_count ?? null;
  const inheritedCycle = boundMold?.cycle_time_sec ?? op?.std_time_sec ?? null;
  const inheritedStd = op?.std_time_sec ?? null;
  const inheritedOee = op?.default_oee ?? null;

  const cavitiesOverridden = has(step.cavities);
  const cycleOverridden = has(step.cycle_time_sec);

  const placeholder = (val, suffix) =>
    (val === null || val === undefined ? '' : `${val}${suffix ? ` — ${suffix}` : ''}`);

  // ---- compact summary (collapsed) -----------------------------------------
  const machineLabel = step.machine || op?.machine_type || '—';
  const summaryCycle = has(step.cycle_time_sec)
    ? `${step.cycle_time_sec}s`
    : inheritedCycle != null
      ? `${inheritedCycle}s (inh.)`
      : '— no cycle';
  const oeeKnown = has(step.oee) || inheritedOee != null;

  return (
    <Accordion disableGutters sx={{ '&:before': { display: 'none' }, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, mb: 0 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />} sx={{ minHeight: 44, '& .MuiAccordionSummary-content': { my: 0.5, alignItems: 'center' } }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ width: '100%' }}>
          <Chip size="small" label={index + 1} sx={{ height: 22 }} />
          <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 120 }}>
            {step.step_name || op?.name || 'New operation'}
          </Typography>
          {category && <Chip size="small" variant="outlined" label={category} sx={{ height: 18 }} />}
          <Typography variant="caption" color="text.secondary">{machineLabel}</Typography>
          <Typography variant="caption" color={has(step.cycle_time_sec) ? 'text.primary' : 'text.secondary'}>· {summaryCycle}</Typography>
          {isMolding && boundMold && <Chip size="small" color="info" variant="outlined" label={`Mold ${boundMold.mold_number}`} sx={{ height: 18 }} />}
          {!oeeKnown
            ? <Chip size="small" variant="outlined" label="OEE not measured" sx={{ height: 18 }} />
            : <Chip size="small" color={has(step.oee) ? 'success' : 'default'} variant="outlined" label={has(step.oee) ? `OEE ${step.oee}` : `OEE ${inheritedOee} (def.)`} sx={{ height: 18 }} />}
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Move up"><span><IconButton size="small" disabled={index === 0} onClick={(e) => { e.stopPropagation(); onMove(index, -1); }}><ArrowUpIcon fontSize="small" /></IconButton></span></Tooltip>
          <Tooltip title="Move down"><span><IconButton size="small" disabled={index === total - 1} onClick={(e) => { e.stopPropagation(); onMove(index, 1); }}><ArrowDownIcon fontSize="small" /></IconButton></span></Tooltip>
          <Tooltip title="Duplicate"><IconButton size="small" onClick={(e) => { e.stopPropagation(); onDup(index); }}><CopyIcon fontSize="small" /></IconButton></Tooltip>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <Divider sx={{ mb: 1.5 }} />
        <Stack spacing={2}>
          {/* Identity */}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <TextField size="small" label="Operation name" value={step.step_name ?? ''} onChange={(e) => onChange(index, 'step_name', e.target.value)} sx={{ width: 200 }} />
            <TextField size="small" label="Department" value={step.department ?? ''} onChange={(e) => onChange(index, 'department', e.target.value)} sx={{ width: 140 }} />
            <TextField size="small" label="Machine / work centre" placeholder={op?.machine_type || ''} value={step.machine ?? ''} onChange={(e) => onChange(index, 'machine', e.target.value)} sx={{ width: 180 }} />
            <TextField
              size="small" type="number" label="Standard time (s)"
              placeholder={placeholder(inheritedStd, inheritedStd != null ? 'op default' : '')}
              value={step.standard_time_sec ?? ''} onChange={(e) => onChange(index, 'standard_time_sec', e.target.value)} sx={{ width: 150 }}
            />
          </Stack>

          {/* Molding-only block */}
          {isMolding && (
            <Box sx={{ p: 1.5, borderRadius: 1.5, border: '1px dashed', borderColor: 'divider' }}>
              <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 1 }}>Molding</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="flex-start">
                <TextField
                  size="small" select label="Bound mold" value={step.mold_id ?? ''}
                  onChange={(e) => onChange(index, 'mold_id', e.target.value || null)} sx={{ width: 220 }}
                >
                  <MenuItem value="">— none —</MenuItem>
                  {moldChoices.map((m) => (
                    <MenuItem key={m.id} value={m.id}>{m.mold_number}{m.mold_type ? ` · ${m.mold_type}` : ''}{m.cavity_count ? ` · ${m.cavity_count} cav` : ''}</MenuItem>
                  ))}
                </TextField>

                {/* Cavities: read-only inherited from mold, with explicit Override */}
                <InheritedField
                  label="Cavities"
                  inherited={inheritedCavities}
                  inheritedFrom={boundMold ? `Mold ${boundMold.mold_number}` : null}
                  overridden={cavitiesOverridden}
                  value={step.cavities}
                  type="number"
                  onOverride={() => onChange(index, 'cavities', String(inheritedCavities ?? ''))}
                  onRevert={() => onChange(index, 'cavities', '')}
                  onChange={(v) => onChange(index, 'cavities', v)}
                  defaultLabel="op default"
                />

                {/* Cycle time: inherited from mold or op std */}
                <InheritedField
                  label="Cycle time (s)"
                  inherited={inheritedCycle}
                  inheritedFrom={boundMold ? `Mold ${boundMold.mold_number}` : (inheritedStd != null ? 'op default' : null)}
                  overridden={cycleOverridden}
                  value={step.cycle_time_sec}
                  type="number"
                  onOverride={() => onChange(index, 'cycle_time_sec', String(inheritedCycle ?? ''))}
                  onRevert={() => onChange(index, 'cycle_time_sec', '')}
                  onChange={(v) => onChange(index, 'cycle_time_sec', v)}
                  defaultLabel="from mold"
                />

                <TextField size="small" type="number" label="Output / cycle" placeholder={inheritedCavities != null ? `${inheritedCavities} — = cavities` : ''} value={step.output_per_cycle ?? ''} onChange={(e) => onChange(index, 'output_per_cycle', e.target.value)} sx={{ width: 140 }} />
                <TextField size="small" type="number" label="Parallel machines" placeholder="1" value={step.parallel_machines ?? ''} onChange={(e) => onChange(index, 'parallel_machines', e.target.value)} sx={{ width: 150 }} />
              </Stack>
            </Box>
          )}

          {/* Labour block */}
          {isLabour && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <TextField size="small" type="number" label="Manpower" placeholder={op?.manpower_reqd != null ? `${op.manpower_reqd} — op default` : ''} value={step.manpower ?? ''} onChange={(e) => onChange(index, 'manpower', e.target.value)} sx={{ width: 130 }} />
              <TextField size="small" type="number" label="Min operators" value={step.min_operators ?? ''} onChange={(e) => onChange(index, 'min_operators', e.target.value)} sx={{ width: 140 }} />
              <TextField size="small" type="number" label="Max operators" value={step.max_operators ?? ''} onChange={(e) => onChange(index, 'max_operators', e.target.value)} sx={{ width: 140 }} />
            </Stack>
          )}

          {/* Advanced (always available) */}
          <Box>
            <Button size="small" onClick={() => setAdvanced((a) => !a)} sx={{ textTransform: 'none' }}>
              {advanced ? 'Hide advanced' : 'Advanced (cycle, scrap, setup, quality, notes)'}
            </Button>
            <Collapse in={advanced} unmountOnExit>
              <Stack spacing={1.5} sx={{ pt: 1 }}>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {!isMolding && (
                    <TextField size="small" type="number" label="Cycle time (s)" placeholder={placeholder(inheritedCycle, inheritedCycle != null ? 'inherited' : '')} value={step.cycle_time_sec ?? ''} onChange={(e) => onChange(index, 'cycle_time_sec', e.target.value)} sx={{ width: 150 }} />
                  )}
                  <TextField size="small" type="number" label="Scrap %" placeholder="0 — none" value={step.scrap_pct ?? ''} onChange={(e) => onChange(index, 'scrap_pct', e.target.value)} sx={{ width: 110 }} />
                  <TextField size="small" type="number" label="Setup time (s)" placeholder="0" value={step.setup_time_sec ?? ''} onChange={(e) => onChange(index, 'setup_time_sec', e.target.value)} sx={{ width: 140 }} />
                  <TextField size="small" type="number" label="Changeover (s)" placeholder="0" value={step.changeover_time_sec ?? ''} onChange={(e) => onChange(index, 'changeover_time_sec', e.target.value)} sx={{ width: 140 }} />
                  <TextField
                    size="small" type="number" label="OEE"
                    placeholder={inheritedOee != null ? `${inheritedOee} — process default` : 'not measured'}
                    value={step.oee ?? ''} onChange={(e) => onChange(index, 'oee', e.target.value)} sx={{ width: 150 }}
                  />
                </Stack>
                <FormControlLabel
                  control={<Checkbox size="small" checked={!!step.quality_check_required} onChange={(e) => onChange(index, 'quality_check_required', e.target.checked)} />}
                  label={<Typography variant="body2">Quality check required at this op</Typography>}
                />
                <TextField size="small" label="Notes" value={step.notes ?? ''} onChange={(e) => onChange(index, 'notes', e.target.value)} fullWidth multiline minRows={1} />
              </Stack>
            </Collapse>
          </Box>

          <Box>
            <Button size="small" color="error" onClick={() => onDel(index)}>Remove operation</Button>
          </Box>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

/**
 * InheritedField — shows an inherited value as read-only ("Cavities: 6 — from Mold
 * M-204") with an explicit "Override" link. When overridden, the field becomes a
 * real input, the inherited value is shown struck-through, and a "revert to mold"
 * link restores inheritance (clears the user value).
 */
function InheritedField({ label, inherited, inheritedFrom, overridden, value, type, onOverride, onRevert, onChange, defaultLabel }) {
  if (!overridden) {
    return (
      <Box sx={{ minWidth: 160 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {inherited != null ? `${inherited}` : '—'}
          {inheritedFrom && inherited != null && (
            <Typography component="span" variant="caption" color="text.secondary"> — from {inheritedFrom}</Typography>
          )}
        </Typography>
        <Link component="button" type="button" variant="caption" onClick={onOverride} sx={{ mt: 0.25 }}>
          Override
        </Link>
      </Box>
    );
  }
  return (
    <Box sx={{ minWidth: 160 }}>
      <TextField size="small" type={type} label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} sx={{ width: 160 }} />
      <Box sx={{ mt: 0.25 }}>
        {inherited != null && (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ textDecoration: 'line-through', mr: 1 }}>
            {inherited}{defaultLabel ? ` ${defaultLabel}` : ''}
          </Typography>
        )}
        <Link component="button" type="button" variant="caption" onClick={onRevert}>
          revert to {inheritedFrom || 'default'}
        </Link>
      </Box>
    </Box>
  );
}

// Re-exported so the parent can normalise step numbers consistently if needed.
export { has, num };
