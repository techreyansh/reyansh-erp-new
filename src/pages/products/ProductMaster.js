// PLM Product Master — list + dashboard + Product 360 view. The single source
// of truth (`product` table). Tabs are editable; costing/documents/process/
// revisions plug into plmProductService + plmCostingService.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Container, Box, Stack, Typography, Button, TextField, MenuItem, Grid, Card, CardContent,
  Chip, Table, TableHead, TableRow, TableCell, TableBody, IconButton, Tabs, Tab, Dialog,
  DialogTitle, DialogContent, DialogActions, Snackbar, Alert, CircularProgress, Tooltip,
  InputAdornment, useTheme, alpha,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import BulkImportButton from '../../components/common/BulkImport/BulkImportButton';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloudUpload from '@mui/icons-material/CloudUpload';
import CloudDownload from '@mui/icons-material/CloudDownload';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import { supabase } from '../../lib/supabaseClient';
import { usePermissions } from '../../context/PermissionContext';
import plm from '../../services/plmProductService';
import costing from '../../services/plmCostingService';
import { listAudit, diffRows } from '../../services/masterAuditService';
import CostingEditor from '../../components/product/CostingEditor';

const STATUSES = ['development', 'sample', 'approved', 'production', 'inactive', 'obsolete'];
const STATUS_COLOR = { development: 'info', sample: 'warning', approved: 'success', production: 'primary', inactive: 'default', obsolete: 'error' };
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const inr = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function ProductMaster() {
  const theme = useTheme();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [snack, setSnack] = useState(null);
  const notify = (message, severity = 'success') => setSnack({ message, severity });

  const load = useCallback(async () => {
    setLoading(true);
    try { setProducts(await plm.listProducts()); }
    catch (e) { notify(e.message || 'Failed to load products', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      return [p.product_code, p.product_name, p.company_name, p.product_family, p.customer_part_no]
        .map((x) => String(x || '').toLowerCase()).join(' ').includes(q);
    });
  }, [products, search, statusFilter]);

  const kpis = useMemo(() => ({
    total: products.length,
    development: products.filter((p) => p.status === 'development').length,
    sample: products.filter((p) => p.status === 'sample').length,
    approved: products.filter((p) => p.status === 'approved').length,
    production: products.filter((p) => p.status === 'production').length,
    obsolete: products.filter((p) => p.status === 'obsolete').length,
  }), [products]);

  if (selected) {
    return <Product360 productId={selected.id} onBack={() => { setSelected(null); load(); }} notify={notify} snack={snack} setSnack={setSnack} />;
  }

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
        <Inventory2Outlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Product Master</Typography>
        <Chip size="small" label="PLM" variant="outlined" color="primary" />
        <Box sx={{ flexGrow: 1 }} />
        <BulkImportButton dataset="products" label="Import Excel" onApplied={load} />
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>New product</Button>
      </Stack>

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {[['Total', kpis.total, 'primary'], ['Development', kpis.development, 'info'], ['Sample', kpis.sample, 'warning'],
          ['Approved', kpis.approved, 'success'], ['Production', kpis.production, 'primary'], ['Obsolete', kpis.obsolete, 'error']].map(([label, val, color]) => (
          <Grid item xs={6} sm={4} md={2} key={label}>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.62rem' }}>{label}</Typography>
                <Typography variant="h6" sx={{ fontWeight: 800, color: `${color}.main` }}>{val}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <Box sx={{ p: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField size="small" placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} sx={{ minWidth: 240 }} />
          <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="all">All statuses</MenuItem>
            {STATUSES.map((s) => <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>{s}</MenuItem>)}
          </TextField>
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="caption" color="text.secondary">{filtered.length} of {products.length}</Typography>
        </Box>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" stickyHeader>
            <TableHead><TableRow>
              {['Code', 'Product', 'Customer', 'Family', 'Type', 'Rev', 'Status'].map((h) => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>
              ))}
            </TableRow></TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} sx={{ textAlign: 'center', py: 4 }}><CircularProgress size={24} /></TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>No products. Click “New product”.</TableCell></TableRow>
              ) : filtered.map((p) => (
                <TableRow key={p.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelected(p)}>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '0.74rem' }}>{p.product_code}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{p.product_name || '—'}</TableCell>
                  <TableCell>{p.company_name || '—'}</TableCell>
                  <TableCell>{p.product_family || '—'}</TableCell>
                  <TableCell sx={{ textTransform: 'capitalize' }}>{p.product_type || '—'}</TableCell>
                  <TableCell>{p.current_revision || '—'}</TableCell>
                  <TableCell><Chip size="small" color={STATUS_COLOR[p.status] || 'default'} label={p.status} sx={{ height: 20, textTransform: 'capitalize' }} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Card>

      <AddProductDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={(p) => { setAddOpen(false); load(); setSelected(p); }} notify={notify} />
      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}

function AddProductDialog({ open, onClose, onCreated, notify }) {
  const [form, setForm] = useState({ product_name: '', company_name: '', customer_code: '', product_family: '', product_type: 'cable' });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    if (!form.product_name.trim()) { notify('Product name is required', 'error'); return; }
    setSaving(true);
    try { const p = await plm.createProduct({ ...form, status: 'development' }); onCreated(p); }
    catch (e) { notify(e.message || 'Failed to create', 'error'); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New product</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 2, mt: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField label="Product name" required value={form.product_name} onChange={set('product_name')} />
          <TextField select label="Type" value={form.product_type} onChange={set('product_type')}>
            {['cable', 'power_cord', 'harness', 'custom'].map((t) => <MenuItem key={t} value={t} sx={{ textTransform: 'capitalize' }}>{t}</MenuItem>)}
          </TextField>
          <TextField label="Customer name" value={form.company_name} onChange={set('company_name')} />
          <TextField label="Customer code" value={form.customer_code} onChange={set('customer_code')} />
          <TextField label="Product family" value={form.product_family} onChange={set('product_family')} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button>
      </DialogActions>
    </Dialog>
  );
}

const TABS = ['Overview', 'Costing', 'Process', 'Quality Plan', 'Documents', 'Revisions', 'Activity'];

function Product360({ productId, onBack, notify, snack, setSnack }) {
  const theme = useTheme();
  const { canView } = usePermissions();
  const canCosting = canView('accounts'); // costing/margins are confidential — gate to Accounts
  const visibleTabs = TABS.filter((t) => t !== 'Costing' || canCosting);
  const [tab, setTab] = useState(0);
  const [p, setP] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setP(await plm.getProduct(productId)); } finally { setLoading(false); }
  }, [productId]);
  useEffect(() => { load(); }, [load]);

  if (loading || !p) {
    return <Container sx={{ py: 6, textAlign: 'center' }}><CircularProgress /></Container>;
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1, flexWrap: 'wrap' }} useFlexGap>
        <IconButton onClick={onBack}><ArrowBackIcon /></IconButton>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>{p.product_name}</Typography>
        <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>{p.product_code}</Typography>
        {p.company_name && <Chip size="small" variant="outlined" label={p.company_name} />}
        {p.current_revision && <Chip size="small" variant="outlined" label={`Rev ${p.current_revision}`} />}
        <Chip size="small" color={STATUS_COLOR[p.status] || 'default'} label={p.status} sx={{ textTransform: 'capitalize' }} />
      </Stack>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        {visibleTabs.map((t) => <Tab key={t} label={t} />)}
      </Tabs>

      {visibleTabs[tab] === 'Overview' && <OverviewTab p={p} onSaved={load} notify={notify} />}
      {visibleTabs[tab] === 'Costing' && <CostingTab p={p} notify={notify} />}
      {visibleTabs[tab] === 'Process' && <ProcessTab p={p} notify={notify} />}
      {visibleTabs[tab] === 'Quality Plan' && <QualityPlanTab p={p} notify={notify} />}
      {visibleTabs[tab] === 'Documents' && <DocumentsTab p={p} notify={notify} />}
      {visibleTabs[tab] === 'Revisions' && <RevisionsTab p={p} />}
      {visibleTabs[tab] === 'Activity' && <ActivityTab p={p} />}

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}

function OverviewTab({ p, onSaved, notify }) {
  const [form, setForm] = useState(p);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    try {
      await plm.updateProduct(p.id, {
        product_name: form.product_name, company_name: form.company_name, customer_code: form.customer_code,
        customer_part_no: form.customer_part_no, product_family: form.product_family, product_category: form.product_category,
        product_type: form.product_type, status: form.status, current_revision: form.current_revision,
        voltage_rating: form.voltage_rating, current_rating: form.current_rating,
        length_mm: form.length_mm || null, weight_g: form.weight_g || null, dimensions: form.dimensions,
        packaging_standard: form.packaging_standard, target_per_hour: form.target_per_hour || null,
        target_per_shift: form.target_per_shift || null, cycle_time_sec: form.cycle_time_sec || null,
      });
      notify('Saved'); onSaved();
    } catch (e) { notify(e.message || 'Save failed', 'error'); }
    finally { setSaving(false); }
  };
  const F = (label, k, type = 'text') => (
    <TextField label={label} value={form[k] ?? ''} onChange={set(k)} size="small" type={type} fullWidth />
  );
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
      <Typography variant="overline" color="text.secondary">Basic + Specification</Typography>
      <Box sx={{ display: 'grid', gap: 2, mt: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' } }}>
        {F('Product name', 'product_name')}
        <TextField select label="Status" value={form.status || 'development'} onChange={set('status')} size="small">
          {STATUSES.map((s) => <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>{s}</MenuItem>)}
        </TextField>
        {F('Revision', 'current_revision')}
        {F('Customer name', 'company_name')}
        {F('Customer code', 'customer_code')}
        {F('Customer part no', 'customer_part_no')}
        {F('Product family', 'product_family')}
        {F('Category', 'product_category')}
        <TextField select label="Type" value={form.product_type || 'cable'} onChange={set('product_type')} size="small">
          {['cable', 'power_cord', 'harness', 'custom'].map((t) => <MenuItem key={t} value={t} sx={{ textTransform: 'capitalize' }}>{t}</MenuItem>)}
        </TextField>
        {F('Voltage rating', 'voltage_rating')}
        {F('Current rating', 'current_rating')}
        {F('Length (mm)', 'length_mm', 'number')}
        {F('Weight (g)', 'weight_g', 'number')}
        {F('Dimensions', 'dimensions')}
        {F('Packaging standard', 'packaging_standard')}
        {F('Target/hour', 'target_per_hour', 'number')}
        {F('Target/shift', 'target_per_shift', 'number')}
        {F('Cycle time (s)', 'cycle_time_sec', 'number')}
      </Box>
      <Box sx={{ mt: 2, textAlign: 'right' }}><Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></Box>
    </CardContent></Card>
  );
}

function CostingTab({ p, notify }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await costing.listCostingsForProduct(p.id)); } finally { setLoading(false); }
  }, [p.id]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try { await costing.createCosting(p.id, { product_name: p.product_name, customer_code: p.customer_code, revision: p.current_revision, target_margin_pct: 20 }); notify('Costing draft created'); load(); }
    catch (e) { notify(e.message || 'Failed', 'error'); }
  };
  const advance = async (c) => {
    const next = costing.nextStatus(c.status);
    if (!next) return;
    try { await costing.transitionStatus(c.id, next); notify(`Moved to ${next}`); load(); }
    catch (e) { notify(e.message || 'Failed', 'error'); }
  };
  const cColor = { draft: 'default', reviewed: 'info', approved: 'warning', released: 'success', superseded: 'default' };
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>Costing versions</Typography>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={create}>New costing</Button>
      </Stack>
      {loading ? <CircularProgress size={22} /> : rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No costings yet. Create a draft to start.</Typography>
      ) : (
        <Table size="small"><TableHead><TableRow>
          {['Costing #', 'V', 'Total cost', 'Sell price', 'Margin', 'Status', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>)}
        </TableRow></TableHead><TableBody>
          {rows.map((c) => (
            <TableRow key={c.id} hover>
              <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{c.costing_no}</TableCell>
              <TableCell>V{c.version_number}</TableCell>
              <TableCell>{inr(c.total_cost)}</TableCell>
              <TableCell>{inr(c.net_selling_price)}</TableCell>
              <TableCell>{Number(c.net_margin_pct || 0).toFixed(1)}%</TableCell>
              <TableCell><Chip size="small" color={cColor[c.status] || 'default'} label={c.status} sx={{ height: 20, textTransform: 'capitalize' }} /></TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                <Button size="small" onClick={() => setEditingId(c.id)}>Edit</Button>
                {costing.nextStatus(c.status) && <Button size="small" onClick={() => advance(c)}>→ {costing.nextStatus(c.status)}</Button>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody></Table>
      )}
      {editingId && <CostingEditor costingId={editingId} onClose={() => setEditingId(null)} onSaved={load} notify={notify} />}
    </CardContent></Card>
  );
}

function ProcessTab({ p, notify }) {
  const [steps, setSteps] = useState([]);
  useEffect(() => { plm.listProcess(p.id).then(setSteps); }, [p.id]);
  const add = () => setSteps((s) => [...s, { step_name: '', department: '', machine: '', standard_time_sec: '', manpower: '' }]);
  const upd = (i, k, v) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const del = (i) => setSteps((s) => s.filter((_, j) => j !== i));
  const save = async () => { try { await plm.saveProcess(p.id, steps.map((s) => ({ ...s, standard_time_sec: s.standard_time_sec || null, manpower: s.manpower || null }))); notify('Routing saved'); } catch (e) { notify(e.message, 'error'); } };
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>Production routing</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={add}>Add step</Button>
      </Stack>
      {steps.map((s, i) => (
        <Stack key={i} direction="row" spacing={1} sx={{ mb: 1 }} alignItems="center">
          <Typography variant="caption" sx={{ width: 18 }}>{i + 1}</Typography>
          <TextField size="small" placeholder="Step" value={s.step_name} onChange={(e) => upd(i, 'step_name', e.target.value)} sx={{ flex: 1 }} />
          <TextField size="small" placeholder="Dept" value={s.department} onChange={(e) => upd(i, 'department', e.target.value)} />
          <TextField size="small" placeholder="Machine" value={s.machine} onChange={(e) => upd(i, 'machine', e.target.value)} />
          <TextField size="small" placeholder="Time(s)" type="number" value={s.standard_time_sec} onChange={(e) => upd(i, 'standard_time_sec', e.target.value)} sx={{ width: 90 }} />
          <TextField size="small" placeholder="MP" type="number" value={s.manpower} onChange={(e) => upd(i, 'manpower', e.target.value)} sx={{ width: 70 }} />
          <IconButton size="small" color="error" onClick={() => del(i)}><DeleteOutline fontSize="small" /></IconButton>
        </Stack>
      ))}
      <Box sx={{ mt: 1, textAlign: 'right' }}><Button variant="contained" onClick={save}>Save routing</Button></Box>
    </CardContent></Card>
  );
}

const QP_STAGES = ['incoming', 'in_process', 'final', 'dispatch'];
function QualityPlanTab({ p, notify }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { plm.listQualityPlan(p.id).then(setRows); }, [p.id]);
  const add = () => setRows((s) => [...s, { stage: 'in_process', characteristic: '', specification: '', method: '', frequency: '', sample_size: '', reaction_plan: '' }]);
  const upd = (i, k, v) => setRows((s) => s.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const del = (i) => setRows((s) => s.filter((_, j) => j !== i));
  const save = async () => { try { await plm.saveQualityPlan(p.id, rows); notify('Quality plan saved'); } catch (e) { notify(e.message, 'error'); } };
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>Quality plan (control plan)</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={add}>Add check</Button>
      </Stack>
      {rows.map((r, i) => (
        <Stack key={i} direction="row" spacing={1} sx={{ mb: 1 }} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" select label="Stage" value={r.stage} onChange={(e) => upd(i, 'stage', e.target.value)} sx={{ width: 120 }}>
            {QP_STAGES.map((x) => <MenuItem key={x} value={x}>{x.replace('_', ' ')}</MenuItem>)}
          </TextField>
          <TextField size="small" placeholder="Characteristic" value={r.characteristic} onChange={(e) => upd(i, 'characteristic', e.target.value)} sx={{ flex: 1, minWidth: 140 }} />
          <TextField size="small" placeholder="Spec" value={r.specification} onChange={(e) => upd(i, 'specification', e.target.value)} sx={{ width: 130 }} />
          <TextField size="small" placeholder="Method" value={r.method} onChange={(e) => upd(i, 'method', e.target.value)} sx={{ width: 120 }} />
          <TextField size="small" placeholder="Freq" value={r.frequency} onChange={(e) => upd(i, 'frequency', e.target.value)} sx={{ width: 100 }} />
          <TextField size="small" placeholder="Sample" value={r.sample_size} onChange={(e) => upd(i, 'sample_size', e.target.value)} sx={{ width: 80 }} />
          <TextField size="small" placeholder="On fail" value={r.reaction_plan} onChange={(e) => upd(i, 'reaction_plan', e.target.value)} sx={{ width: 120 }} />
          <IconButton size="small" color="error" onClick={() => del(i)}><DeleteOutline fontSize="small" /></IconButton>
        </Stack>
      ))}
      <Box sx={{ mt: 1, textAlign: 'right' }}><Button variant="contained" onClick={save}>Save quality plan</Button></Box>
    </CardContent></Card>
  );
}

function DocumentsTab({ p, notify }) {
  const [docs, setDocs] = useState([]);
  const [docType, setDocType] = useState('customer_drawing');
  const [uploading, setUploading] = useState(false);
  const ref = useRef(null);
  const load = useCallback(() => plm.listProductDocuments(p.id).then(setDocs), [p.id]);
  useEffect(() => { load(); }, [load]);
  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const path = `products/${p.id}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, '_')}`;
      const { error } = await supabase.storage.from('documents').upload(path, file);
      if (error) throw error;
      const email = (await supabase.auth.getUser()).data?.user?.email || null;
      await supabase.from('product_document').insert({ product_id: p.id, doc_type: docType, file_name: file.name, storage_path: path, uploaded_by_email: email });
      notify('Uploaded'); load();
    } catch (e) { notify(e.message || 'Upload failed', 'error'); }
    finally { setUploading(false); if (ref.current) ref.current.value = ''; }
  };
  const download = async (d) => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(d.storage_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  };
  const remove = async (d) => { try { await supabase.storage.from('documents').remove([d.storage_path]); await supabase.from('product_document').delete().eq('id', d.id); load(); } catch (e) { notify(e.message, 'error'); } };
  const TYPES = ['customer_drawing', 'internal_drawing', 'bom', 'work_instruction', 'testing_sop', 'photo', 'approval', 'ppap', 'certificate'];
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>Documents</Typography>
        <TextField select size="small" label="Type" value={docType} onChange={(e) => setDocType(e.target.value)} sx={{ minWidth: 170 }}>
          {TYPES.map((t) => <MenuItem key={t} value={t}>{t.replace(/_/g, ' ')}</MenuItem>)}
        </TextField>
        <input ref={ref} type="file" hidden onChange={(e) => upload(e.target.files?.[0])} />
        <Button size="small" variant="contained" startIcon={<CloudUpload />} disabled={uploading} onClick={() => ref.current?.click()}>{uploading ? 'Uploading…' : 'Upload'}</Button>
      </Stack>
      {docs.length === 0 ? <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No documents.</Typography> : (
        <Stack spacing={1}>{docs.map((d) => (
          <Stack key={d.id} direction="row" spacing={1} alignItems="center" sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap fontWeight={600}>{d.file_name}</Typography>
              <Typography variant="caption" color="text.secondary">{(d.doc_type || '').replace(/_/g, ' ')} · {fmt(d.created_at)}</Typography>
            </Box>
            <IconButton size="small" onClick={() => download(d)}><CloudDownload fontSize="small" /></IconButton>
            <IconButton size="small" color="error" onClick={() => remove(d)}><DeleteOutline fontSize="small" /></IconButton>
          </Stack>
        ))}</Stack>
      )}
    </CardContent></Card>
  );
}

function RevisionsTab({ p }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { plm.listRevisions(p.id).then(setRows); }, [p.id]);
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
      <Typography variant="overline" color="text.secondary">Revision history</Typography>
      {rows.length === 0 ? <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No revisions recorded.</Typography> : (
        <Stack spacing={1} sx={{ mt: 1 }}>{rows.map((r) => (
          <Box key={r.id} sx={{ p: 1.25, borderRadius: 1, bgcolor: 'action.hover' }}>
            <Typography variant="body2" fontWeight={600}>Rev {r.revision} · {fmt(r.changed_at)} {r.changed_by_email ? `· ${r.changed_by_email}` : ''}</Typography>
            {r.change_reason && <Typography variant="caption" color="text.secondary">{r.change_reason}</Typography>}
          </Box>
        ))}</Stack>
      )}
    </CardContent></Card>
  );
}

function ActivityTab({ p }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { listAudit('product', p.id, 50).then(setRows); }, [p.id]);
  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
      <Typography variant="overline" color="text.secondary">Activity / change log</Typography>
      {rows.length === 0 ? <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No changes logged yet.</Typography> : (
        <Stack spacing={1} sx={{ mt: 1 }}>{rows.map((a) => {
          const changes = a.action === 'UPDATE' ? diffRows(a.old_value || {}, a.new_value || {}) : [];
          return (
            <Box key={a.id} sx={{ p: 1.25, borderRadius: 1, bgcolor: 'action.hover' }}>
              <Typography variant="body2" fontWeight={600}>
                {a.action === 'INSERT' ? 'Created' : a.action === 'DELETE' ? 'Deleted' : 'Updated'}{a.changed_by_email ? ` · ${a.changed_by_email}` : ''} · {fmt(a.changed_at)}
              </Typography>
              {changes.slice(0, 6).map((c) => (
                <Typography key={c.field} variant="caption" color="text.secondary" display="block"><b>{c.field}</b>: {String(c.from ?? '—')} → {String(c.to ?? '—')}</Typography>
              ))}
            </Box>
          );
        })}</Stack>
      )}
    </CardContent></Card>
  );
}
