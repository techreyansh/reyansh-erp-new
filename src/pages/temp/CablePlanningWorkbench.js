// TEMPORARY — Cable Planning Workbench. Fast manual planner: order + cable
// inputs → auto-routing → one-page printable production planning sheet.
// Standalone (no ERP integration); reuses the cable engine via cablePlanService.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Card, CardContent, Chip, Grid, TextField, MenuItem, Button,
  Divider, Table, TableHead, TableRow, TableCell, TableBody, Tabs, Tab, IconButton, Tooltip,
  CircularProgress, Alert, Snackbar, Checkbox,
} from '@mui/material';
import CableOutlined from '@mui/icons-material/CableOutlined';
import BoltRounded from '@mui/icons-material/BoltRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import PrintRounded from '@mui/icons-material/PrintRounded';
import cablePlan from '../../services/temp/cablePlanService';
import { buildDaySchedule } from '../../services/temp/cableScheduleService';
import CableJobCards from '../../components/temp/CableJobCards';
import CableDaySchedule from '../../components/temp/CableDaySchedule';
import { LANGS } from '../../services/temp/cablePlanLabels';

// Reconstruct a buildPlan input object from a saved temp_cable_plans row.
const rowToInput = (row) => {
  const f = {};
  Object.keys(EMPTY).forEach((k) => { const snake = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`); if (row[snake] != null) f[k] = row[snake]; });
  return f;
};

const EMPTY = {
  customerName: '', productName: '', cableDescription: '', orderQty: '', requiredLength: '', deliveryDate: '', priority: 'normal', remarks: '',
  cores: 3, shape: 'Round', conductorSize: '', strandConstruction: '', numStrands: '', coreColours: '', finishedOd: '', cableLength: '',
  coreOd: '', wastagePct: 2, layingLossPct: 2, reportLanguage: 'bilingual',
  speedBunching: 500, speedCore: 700, speedLaying: 600, speedSheathing: 500, shiftHours: 8,
};

function Field({ label, value, onChange, type = 'text', select, options, ...rest }) {
  return (
    <TextField label={label} value={value} onChange={(e) => onChange(e.target.value)} type={type} select={select}
      size="small" fullWidth InputLabelProps={type === 'date' ? { shrink: true } : undefined} {...rest}>
      {select && options.map((o) => <MenuItem key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</MenuItem>)}
    </TextField>
  );
}

function FlowChips({ flow }) {
  const nodes = [{ label: 'Copper', required: true }, ...flow, { label: 'Finished Cable', required: true }];
  return (
    <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap sx={{ gap: 0.5 }}>
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

export default function CablePlanningWorkbench() {
  const [tab, setTab] = useState(0);
  const [form, setForm] = useState(EMPTY);
  const [plan, setPlan] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [savedNumber, setSavedNumber] = useState(null);
  const [saved, setSaved] = useState([]);
  const [loading, setLoading] = useState(false);
  const [snack, setSnack] = useState(null);
  // Daily Schedule tab state
  const [schedSel, setSchedSel] = useState({});           // { [rowId]: true }
  const [schedDate, setSchedDate] = useState('');
  const [schedStart, setSchedStart] = useState(8);
  const [schedHours, setSchedHours] = useState(8);
  const [schedule, setSchedule] = useState(null);

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); };

  const loadSaved = useCallback(async () => {
    setLoading(true);
    try { setSaved(await cablePlan.listPlans()); } catch (e) { setSnack({ message: e.message, severity: 'error' }); } finally { setLoading(false); }
  }, []);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  const generate = () => {
    if (!form.cores || !form.conductorSize) { setSnack({ message: 'Enter cores + conductor size at minimum.', severity: 'info' }); return; }
    if (form.coreOd === '' || form.coreOd == null) { setSnack({ message: 'Core OD is required — enter the planned core OD (e.g. 2.20 mm).', severity: 'warning' }); return; }
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

  const printDocs = () => window.print();

  const buildSchedule = () => {
    const rows = saved.filter((r) => schedSel[r.id]);
    if (!rows.length) { setSnack({ message: 'Select at least one saved plan to schedule.', severity: 'info' }); return; }
    const plans = rows.map((r) => ({
      planNumber: r.plan_number, customer: r.customer_name, product: r.product_name,
      priority: r.priority || 'normal', deliveryDate: r.delivery_date,
      plan: cablePlan.buildPlan(rowToInput(r)),   // rebuild for the current engine shape
    }));
    setSchedule(buildDaySchedule({ plans, date: schedDate || null, shiftStartHour: Number(schedStart) || 8, shiftHours: Number(schedHours) || 8 }));
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
        <Tab label="Planner" /><Tab label={`Saved plans${saved.length ? ` (${saved.length})` : ''}`} /><Tab label="Daily Schedule" />
      </Tabs>

      {tab === 2 ? (
        <Stack spacing={2}>
          <Card variant="outlined" sx={{ borderRadius: 2 }} className="cds-toolbar"><CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Daily Machine Schedule</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Pick the plans running today and the shift window. The system auto-sequences each machine (start/finish from capacity + changeover) and produces one schedule sheet per machine + a management view.
            </Typography>
            <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
              <Grid item xs={6} sm={3}><Field label="Schedule date" type="date" value={schedDate} onChange={setSchedDate} /></Grid>
              <Grid item xs={6} sm={3}><Field label="Shift start (hour)" type="number" value={schedStart} onChange={setSchedStart} helperText="24h, e.g. 8 = 08:00" /></Grid>
              <Grid item xs={6} sm={3}><Field label="Shift hours" type="number" value={schedHours} onChange={setSchedHours} /></Grid>
            </Grid>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>Plans to schedule</Typography>
            {saved.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>No saved plans. Create + save plans in the Planner tab first.</Typography>
            ) : (
              <Box sx={{ maxHeight: 240, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1, mt: 0.5 }}>
                {saved.map((r) => (
                  <Stack key={r.id} direction="row" alignItems="center" sx={{ px: 1, py: 0.25, borderBottom: 1, borderColor: 'divider' }}>
                    <Checkbox size="small" checked={!!schedSel[r.id]} onChange={(e) => setSchedSel((s) => ({ ...s, [r.id]: e.target.checked }))} />
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700, mr: 1 }}>{r.plan_number}</Typography>
                    <Typography variant="body2" sx={{ flexGrow: 1 }}>{r.customer_name || '—'} · {r.product_name || '—'}</Typography>
                    <Typography variant="caption" color="text.secondary">{r.order_qty || '—'}×{r.required_length || '—'}m · {r.cores}C · {r.priority || 'normal'}</Typography>
                  </Stack>
                ))}
              </Box>
            )}
            <Stack direction="row" spacing={1.5} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
              <Button variant="contained" startIcon={<BoltRounded />} onClick={buildSchedule} sx={{ borderRadius: 2 }}>Build daily schedule</Button>
              {schedule && <Button variant="outlined" startIcon={<PrintRounded />} onClick={printDocs} sx={{ borderRadius: 2 }}>Print schedule (A3) / PDF</Button>}
            </Stack>
          </CardContent></Card>
          {schedule && <CableDaySchedule schedule={schedule} />}
        </Stack>
      ) : tab === 0 ? (
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
              <Grid item xs={6} sm={3}><Field label="Strand construction / dia (mm)" value={form.strandConstruction} onChange={set('strandConstruction')} placeholder="e.g. 0.201" /></Grid>
              <Grid item xs={6} sm={3}><Field label="Core OD (mm) *" type="number" required value={form.coreOd} onChange={set('coreOd')} placeholder="planner-entered, e.g. 2.20" helperText="Mandatory — not auto-calculated" /></Grid>
              <Grid item xs={6} sm={3}><Field label="Core colours" value={form.coreColours} onChange={set('coreColours')} placeholder="Red, Black, Yellow-Green" /></Grid>
              <Grid item xs={6} sm={3}><Field label="Finished OD (mm)" type="number" value={form.finishedOd} onChange={set('finishedOd')} /></Grid>
            </Grid>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 2, mb: 1.5 }}>3 · Planning factors & output</Typography>
            <Grid container spacing={1.5}>
              <Grid item xs={6} sm={3}><Field label="Wastage %" type="number" value={form.wastagePct} onChange={set('wastagePct')} helperText="default 2% — planner editable" /></Grid>
              {Number(form.cores) >= 3 && (
                <Grid item xs={6} sm={3}><Field label="Laying loss %" type="number" value={form.layingLossPct} onChange={set('layingLossPct')} helperText="3/4-core only · ~1–2%" /></Grid>
              )}
              <Grid item xs={6} sm={3}><Field label="Job-card language" select value={form.reportLanguage} onChange={set('reportLanguage')} options={LANGS} /></Grid>
            </Grid>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 2, mb: 0.5 }}>4 · Machine capacity</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Defaults from the machine master — edit per plan to match the actual machine. Drives required hours, utilisation & completion on every job card.
            </Typography>
            <Grid container spacing={1.5}>
              <Grid item xs={6} sm={3}><Field label="Bunching (m/hr)" type="number" value={form.speedBunching} onChange={set('speedBunching')} /></Grid>
              <Grid item xs={6} sm={3}><Field label="Core extrusion (m/hr)" type="number" value={form.speedCore} onChange={set('speedCore')} /></Grid>
              <Grid item xs={6} sm={3}><Field label="Laying (m/hr)" type="number" value={form.speedLaying} onChange={set('speedLaying')} /></Grid>
              <Grid item xs={6} sm={3}><Field label="Sheathing (m/hr)" type="number" value={form.speedSheathing} onChange={set('speedSheathing')} /></Grid>
              <Grid item xs={6} sm={3}><Field label="Shift hours / day" type="number" value={form.shiftHours} onChange={set('shiftHours')} helperText="capacity = speed × shift hrs" /></Grid>
            </Grid>
            <Stack direction="row" spacing={1.5} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
              <Button variant="contained" size="large" startIcon={<BoltRounded />} onClick={generate} sx={{ borderRadius: 2 }}>Generate planning sheet</Button>
              {plan && <Button variant="outlined" onClick={save} sx={{ borderRadius: 2 }}>{editingId ? 'Update saved plan' : 'Save plan'}</Button>}
              {plan && <Button variant="outlined" startIcon={<PrintRounded />} onClick={printDocs} sx={{ borderRadius: 2 }}>Print job cards / PDF</Button>}
            </Stack>
          </CardContent></Card>

          {plan && (
            <Card variant="outlined" sx={{ borderRadius: 2 }} className="cpd-toolbar"><CardContent sx={{ py: 1.5 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap sx={{ gap: 1, mb: 1 }}>
                <Box>
                  <Typography variant="overline" color="text.secondary">Production flow & documents</Typography>
                  <Typography variant="caption" display="block" color="text.secondary">
                    Master sheet + {plan.flow.filter((f) => f.required).length} operator job card(s) · ~{plan.summary.leadDays} working days lead
                  </Typography>
                </Box>
                <FlowChips flow={plan.flow} />
              </Stack>
            </CardContent></Card>
          )}

          {plan && (
            <CableJobCards plan={plan} form={form} planNumber={savedNumber} lang={form.reportLanguage} />
          )}
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
