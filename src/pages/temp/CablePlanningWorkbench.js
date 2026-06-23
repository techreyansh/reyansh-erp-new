// TEMPORARY — Cable Planning Workbench. Fast manual planner: order + cable
// inputs → auto-routing → one-page printable production planning sheet.
// Standalone (no ERP integration); reuses the cable engine via cablePlanService.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Card, CardContent, Chip, Grid, TextField, MenuItem, Button,
  Divider, Table, TableHead, TableRow, TableCell, TableBody, Tabs, Tab, IconButton, Tooltip,
  CircularProgress, Alert, Snackbar,
} from '@mui/material';
import CableOutlined from '@mui/icons-material/CableOutlined';
import BoltRounded from '@mui/icons-material/BoltRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import cablePlan from '../../services/temp/cablePlanService';
import ReportExportButton from '../../components/common/ReportExportButton';

const EMPTY = {
  customerName: '', productName: '', cableDescription: '', orderQty: '', requiredLength: '', deliveryDate: '', priority: 'normal', remarks: '',
  cores: 3, shape: 'Round', conductorSize: '', strandConstruction: '', numStrands: '', coreColours: '', finishedOd: '', cableLength: '',
};
const kg = (n) => `${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })} kg`;

function Field({ label, value, onChange, type = 'text', select, options, ...rest }) {
  return (
    <TextField label={label} value={value} onChange={(e) => onChange(e.target.value)} type={type} select={select}
      size="small" fullWidth InputLabelProps={type === 'date' ? { shrink: true } : undefined} {...rest}>
      {select && options.map((o) => <MenuItem key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</MenuItem>)}
    </TextField>
  );
}

function ProductionFlow({ flow }) {
  const nodes = [{ label: 'Copper', required: true }, ...flow, { label: 'Finished Cable', required: true }];
  return (
    <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap sx={{ gap: 0.5, my: 1.5 }}>
      {nodes.map((n, i) => (
        <React.Fragment key={i}>
          <Chip label={n.label} size="small"
            color={n.required ? 'primary' : 'default'} variant={n.required ? 'filled' : 'outlined'}
            sx={{ fontWeight: 700, textDecoration: n.required ? 'none' : 'line-through', opacity: n.required ? 1 : 0.5 }} />
          {i < nodes.length - 1 && <Typography sx={{ color: 'text.disabled' }}>→</Typography>}
        </React.Fragment>
      ))}
    </Stack>
  );
}

function DeptCard({ title, dept, rows }) {
  if (!dept?.required) return (
    <Card variant="outlined" sx={{ borderRadius: 2, opacity: 0.55 }}><CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{title}</Typography>
      <Typography variant="caption" color="text.secondary">Not required — {dept?.reason || 'skipped'}</Typography>
    </CardContent></Card>
  );
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'primary.main' }}><CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      <Stack spacing={0.25}>
        {rows.map(([k, v]) => v != null && v !== '' && (
          <Stack key={k} direction="row" justifyContent="space-between" spacing={2}>
            <Typography variant="caption" color="text.secondary">{k}</Typography>
            <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'right' }}>{v}</Typography>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}

function PlanningSheet({ form, plan, planNumber }) {
  const d = plan.departments;
  const m = plan.material;
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, mt: 2 }}>
      <CardContent>
        {/* Header */}
        <Stack direction="row" justifyContent="space-between" flexWrap="wrap" sx={{ mb: 1 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>Production Planning Sheet</Typography>
            <Typography variant="caption" color="text.secondary">{planNumber || 'DRAFT'} · {new Date().toLocaleDateString('en-IN')}</Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="body2"><strong>{form.customerName || '—'}</strong></Typography>
            <Typography variant="caption" color="text.secondary">{form.productName} · Due {form.deliveryDate || '—'}</Typography>
          </Box>
        </Stack>
        <Divider />
        <Typography variant="overline" color="text.secondary">Production flow</Typography>
        <ProductionFlow flow={plan.flow} />

        <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
          <Grid item xs={12} sm={6} md={3}><DeptCard title="Bunching" dept={d.bunching} rows={[['Cable', d.bunching.cable], ['Strand const.', d.bunching.strandConstruction], ['Quantity', d.bunching.quantity], ['Machine', d.bunching.machine], ['Target', d.bunching.target || '—'], ['Remarks', d.bunching.remarks || '—']]} /></Grid>
          <Grid item xs={12} sm={6} md={3}><DeptCard title="Core Extrusion" dept={d.core} rows={[['Colour', d.core.colour], ['Size', d.core.size], ['Length', d.core.length], ['Core OD', d.core.od], ['Machine', d.core.machine], ['Target', d.core.target || '—']]} /></Grid>
          <Grid item xs={12} sm={6} md={3}><DeptCard title="Laying" dept={d.laying} rows={[['Cores', d.laying.cores], ['Length', d.laying.length], ['Drum', d.laying.drum], ['Machine', d.laying.machine], ['Target', d.laying.target || '—']]} /></Grid>
          <Grid item xs={12} sm={6} md={3}><DeptCard title="Sheathing" dept={d.sheathing} rows={[['Flat/Round', d.sheathing.shape], ['Finished OD', d.sheathing.finishedOd], ['Length', d.sheathing.length], ['Machine', d.sheathing.machine], ['Target', d.sheathing.target || '—']]} /></Grid>
        </Grid>

        <Typography variant="overline" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>Material estimate ({plan.totalMeters.toLocaleString('en-IN')} m total)</Typography>
        <Table size="small">
          <TableHead><TableRow>{['Material', 'Required', `Wastage (${m.wastagePct}%)`, 'Incl. wastage'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }} align={h === 'Material' ? 'left' : 'right'}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            <TableRow><TableCell>Copper conductor</TableCell><TableCell align="right">{kg(m.copper)}</TableCell><TableCell align="right">{kg(m.estWastageCopper)}</TableCell><TableCell align="right" sx={{ fontWeight: 700 }}>{kg(m.copperWithWastage)}</TableCell></TableRow>
            <TableRow><TableCell>PVC (insulation + sheath)</TableCell><TableCell align="right">{kg(m.pvcTotal)} <Typography component="span" variant="caption" color="text.secondary">(ins {kg(m.pvcIns)} · sh {kg(m.pvcSheath)})</Typography></TableCell><TableCell align="right">{kg(m.estWastagePvc)}</TableCell><TableCell align="right" sx={{ fontWeight: 700 }}>{kg(m.pvcWithWastage)}</TableCell></TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function CablePlanningWorkbench() {
  const [tab, setTab] = useState(0);
  const [form, setForm] = useState(EMPTY);
  const [plan, setPlan] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [savedNumber, setSavedNumber] = useState(null);
  const [saved, setSaved] = useState([]);
  const [loading, setLoading] = useState(false);
  const [snack, setSnack] = useState(null);

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); };

  const loadSaved = useCallback(async () => {
    setLoading(true);
    try { setSaved(await cablePlan.listPlans()); } catch (e) { setSnack({ message: e.message, severity: 'error' }); } finally { setLoading(false); }
  }, []);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  const generate = () => {
    if (!form.cores || !form.conductorSize) { setSnack({ message: 'Enter cores + conductor size at minimum.', severity: 'info' }); return; }
    setPlan(cablePlan.buildPlan(form));
  };
  const save = async () => {
    try {
      const row = await cablePlan.savePlan(form, plan, editingId);
      setEditingId(row.id); setSavedNumber(row.plan_number);
      setSnack({ message: `Saved ${row.plan_number}.`, severity: 'success' });
      loadSaved();
    } catch (e) { setSnack({ message: e.message, severity: 'error' }); }
  };
  const newPlan = () => { setForm(EMPTY); setPlan(null); setEditingId(null); setSavedNumber(null); setTab(0); };

  const openSaved = (row) => {
    const f = { ...EMPTY };
    Object.keys(EMPTY).forEach((k) => { const snake = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`); if (row[snake] != null) f[k] = row[snake]; });
    setForm(f); setEditingId(row.id); setSavedNumber(row.plan_number);
    setPlan(row.plan || cablePlan.buildPlan(f)); setTab(0);
  };
  const dup = async (id) => { try { const r = await cablePlan.duplicatePlan(id); setSnack({ message: `Duplicated → ${r.plan_number}`, severity: 'success' }); loadSaved(); } catch (e) { setSnack({ message: e.message, severity: 'error' }); } };
  const del = async (id) => { try { await cablePlan.deletePlan(id); setSnack({ message: 'Deleted', severity: 'success' }); if (id === editingId) newPlan(); loadSaved(); } catch (e) { setSnack({ message: e.message, severity: 'error' }); } };

  const buildReport = () => {
    if (!plan) return { key: 'plan', title: 'Cable Plan', sections: [] };
    const d = plan.departments; const m = plan.material;
    const dept = (name, dp, rows) => ({ key: name, title: name, columns: [{ key: 'k', label: 'Field' }, { key: 'v', label: 'Value' }],
      rows: dp?.required ? rows.map(([k, v]) => ({ k, v: String(v ?? '—') })) : [{ k: 'Status', v: `Not required — ${dp?.reason || ''}` }], emptyText: '—' });
    return {
      key: `cable-plan-${savedNumber || 'draft'}`, title: `Production Planning Sheet — ${savedNumber || 'DRAFT'}`,
      subtitle: `${form.customerName || ''} · ${form.productName || ''}`, generatedAt: new Date(),
      kpis: [{ label: 'Customer', value: form.customerName || '—' }, { label: 'Delivery', value: form.deliveryDate || '—' },
        { label: 'Total length', value: `${plan.totalMeters.toLocaleString('en-IN')} m` }, { label: 'Routing', value: plan.routing.map((r) => r.label).join(' → ') }],
      sections: [
        dept('Bunching', d.bunching, [['Cable', d.bunching.cable], ['Strand construction', d.bunching.strandConstruction], ['Quantity', d.bunching.quantity], ['Machine', d.bunching.machine]]),
        dept('Core Extrusion', d.core, [['Colour', d.core.colour], ['Size', d.core.size], ['Length', d.core.length], ['Core OD', d.core.od], ['Machine', d.core.machine]]),
        dept('Laying', d.laying, [['Cores', d.laying.cores], ['Length', d.laying.length], ['Drum', d.laying.drum], ['Machine', d.laying.machine]]),
        dept('Sheathing', d.sheathing, [['Flat/Round', d.sheathing.shape], ['Finished OD', d.sheathing.finishedOd], ['Length', d.sheathing.length], ['Machine', d.sheathing.machine]]),
        { key: 'mat', title: 'Material Estimate', columns: [{ key: 'mat', label: 'Material' }, { key: 'req', label: 'Required' }, { key: 'waste', label: 'Wastage' }, { key: 'tot', label: 'Incl. wastage' }],
          rows: [{ mat: 'Copper', req: kg(m.copper), waste: kg(m.estWastageCopper), tot: kg(m.copperWithWastage) }, { mat: 'PVC', req: kg(m.pvcTotal), waste: kg(m.estWastagePvc), tot: kg(m.pvcWithWastage) }], emptyText: '—' },
      ],
    };
  };

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <CableOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Cable Planning Workbench</Typography>
        <Chip size="small" label="Temporary" color="warning" variant="outlined" />
        <Box sx={{ flexGrow: 1 }} />
        {tab === 0 && <Button variant="outlined" size="small" onClick={newPlan} sx={{ borderRadius: 2 }}>New plan</Button>}
      </Stack>
      <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Planner" /><Tab label={`Saved plans${saved.length ? ` (${saved.length})` : ''}`} />
      </Tabs>

      {tab === 0 ? (
        <Stack spacing={2}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>1 · Order details</Typography>
            <Grid container spacing={1.5}>
              <Grid item xs={12} sm={4}><Field label="Customer name" value={form.customerName} onChange={set('customerName')} /></Grid>
              <Grid item xs={12} sm={4}><Field label="Product name" value={form.productName} onChange={set('productName')} /></Grid>
              <Grid item xs={12} sm={4}><Field label="Cable description" value={form.cableDescription} onChange={set('cableDescription')} /></Grid>
              <Grid item xs={6} sm={2}><Field label="Order qty" type="number" value={form.orderQty} onChange={set('orderQty')} /></Grid>
              <Grid item xs={6} sm={2}><Field label="Length / cable (m)" type="number" value={form.requiredLength} onChange={set('requiredLength')} /></Grid>
              <Grid item xs={6} sm={3}><Field label="Delivery date" type="date" value={form.deliveryDate} onChange={set('deliveryDate')} /></Grid>
              <Grid item xs={6} sm={2}><Field label="Priority" select value={form.priority} onChange={set('priority')} options={['high', 'normal', 'low']} /></Grid>
              <Grid item xs={12} sm={3}><Field label="Remarks" value={form.remarks} onChange={set('remarks')} /></Grid>
            </Grid>
          </CardContent></Card>

          <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>2 · Cable configuration</Typography>
            <Grid container spacing={1.5}>
              <Grid item xs={6} sm={3}><Field label="Cores" select value={form.cores} onChange={(v) => set('cores')(Number(v))} options={[{ value: 1, label: 'Single core' }, { value: 2, label: 'Two core' }, { value: 3, label: 'Three core' }, { value: 4, label: 'Four core' }]} /></Grid>
              <Grid item xs={6} sm={3}><Field label="Shape" select value={form.shape} onChange={set('shape')} options={['Round', 'Flat']} /></Grid>
              <Grid item xs={6} sm={3}><Field label="Conductor size (sqmm)" type="number" value={form.conductorSize} onChange={set('conductorSize')} /></Grid>
              <Grid item xs={6} sm={3}><Field label="No. of strands" type="number" value={form.numStrands} onChange={set('numStrands')} helperText="≥24 → bunching" /></Grid>
              <Grid item xs={6} sm={3}><Field label="Strand construction" value={form.strandConstruction} onChange={set('strandConstruction')} placeholder="e.g. 7/0.3" /></Grid>
              <Grid item xs={6} sm={3}><Field label="Core colours" value={form.coreColours} onChange={set('coreColours')} placeholder="Red, Black…" /></Grid>
              <Grid item xs={6} sm={3}><Field label="Finished OD (mm)" type="number" value={form.finishedOd} onChange={set('finishedOd')} /></Grid>
              <Grid item xs={6} sm={3}><Field label="Cable length (m)" type="number" value={form.cableLength} onChange={set('cableLength')} /></Grid>
            </Grid>
            <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
              <Button variant="contained" size="large" startIcon={<BoltRounded />} onClick={generate} sx={{ borderRadius: 2 }}>Generate planning sheet</Button>
              {plan && <Button variant="outlined" onClick={save} sx={{ borderRadius: 2 }}>{editingId ? 'Update saved plan' : 'Save plan'}</Button>}
              {plan && <ReportExportButton buildReport={buildReport} label="Print / PDF" />}
            </Stack>
          </CardContent></Card>

          {plan && <PlanningSheet form={form} plan={plan} planNumber={savedNumber} />}
        </Stack>
      ) : (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          {loading ? <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack> : saved.length === 0 ? (
            <Box sx={{ p: 3 }}><Typography variant="body2" color="text.secondary">No saved plans yet. Generate one in the Planner tab and click Save.</Typography></Box>
          ) : (
            <Table size="small">
              <TableHead><TableRow>{['Plan no.', 'Customer', 'Product', 'Qty × len', 'Delivery', 'Created', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>{saved.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer' }} onClick={() => openSaved(r)}>{r.plan_number}</TableCell>
                  <TableCell>{r.customer_name || '—'}</TableCell>
                  <TableCell>{r.product_name || '—'}</TableCell>
                  <TableCell>{r.order_qty || '—'} × {r.required_length || '—'}m</TableCell>
                  <TableCell>{r.delivery_date || '—'}</TableCell>
                  <TableCell><Typography variant="caption" color="text.secondary">{new Date(r.created_at).toLocaleDateString('en-IN')}</Typography></TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                      <Tooltip title="View / edit"><IconButton size="small" onClick={() => openSaved(r)}><EditOutlined fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Duplicate"><IconButton size="small" onClick={() => dup(r.id)}><ContentCopyRounded fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton size="small" onClick={() => del(r.id)}><DeleteOutlineRounded fontSize="small" /></IconButton></Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </Card>
      )}

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
