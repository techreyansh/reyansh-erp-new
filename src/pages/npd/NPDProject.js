import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Stack, Card, CardContent, Typography, Button, IconButton, Chip, Tabs, Tab, Divider,
  CircularProgress, Snackbar, Alert, Tooltip, Stepper, Step, StepLabel, Link, TextField, MenuItem,
  useTheme, alpha,
  Collapse, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import {
  ArrowBack as BackIcon, Refresh as RefreshIcon, ArrowForward as NextIcon, UploadFile as UploadIcon,
  Description as DocIcon, Info as InfoIcon,
  History as HistoryIcon,
} from '@mui/icons-material';
import npdService, { NPD_STAGES, NPD_STAGE_LABEL } from '../../services/npdService';
import * as plmProductService from '../../services/plmProductService';
import * as plmCostingService from '../../services/plmCostingService';
import ppcService from '../../services/ppcService';
import inventoryLedgerService from '../../services/inventoryLedgerService';
import mesService from '../../services/mesService';
import mesMasterService from '../../services/mesMasterService';
import RoutingOpEditor from '../mes/RoutingOpEditor';

const SECTIONS = ['Overview', 'Engineering', 'Samples & Quality', 'Activity', 'Approvals'];

const DOC_CATEGORIES = [
  { v: 'customer_drawing', l: 'Customer drawing' }, { v: 'internal_drawing', l: 'Internal drawing' },
  { v: 'bom', l: 'BOM' }, { v: 'costing', l: 'Costing' }, { v: 'inspection', l: 'Inspection report' },
  { v: 'test_report', l: 'Test report' }, { v: 'quality', l: 'Quality report' }, { v: 'photo', l: 'Photo' },
  { v: 'video', l: 'Video' }, { v: 'email', l: 'Customer email' }, { v: 'approval', l: 'Approval' },
  { v: 'ppap', l: 'PPAP' }, { v: 'tech_note', l: 'Technical note' }, { v: 'work_instruction', l: 'Work instruction' },
  { v: 'certificate', l: 'Certificate' }, { v: 'other', l: 'Other' },
];

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

const NPDProject = () => {
  const { id } = useParams();
  const theme = useTheme();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [project, setProject] = useState(null);
  const [history, setHistory] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);
  const [docCategory, setDocCategory] = useState('customer_drawing');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, h, d] = await Promise.all([
        npdService.getProject(id), npdService.getStageHistory(id), npdService.listDocuments(id),
      ]);
      setProject(p); setHistory(h); setDocs(d);
    } catch (e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const stageIdx = project ? NPD_STAGES.findIndex((s) => s.key === project.stage) : 0;
  const nextStage = NPD_STAGES[stageIdx + 1];

  const advance = async (toStage, force = false) => {
    try {
      const res = await npdService.moveStage(id, toStage, { expectedFrom: project.stage, force });
      if (res && res.ok === false) {
        setSnackbar({ open: true, message: res.message || 'Could not advance.', severity: res.conflict ? 'warning' : 'info' });
      } else { setSnackbar({ open: true, message: 'Stage updated.', severity: 'success' }); await load(); }
    } catch (e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
  };

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { await npdService.uploadDocument(id, file, { category: docCategory, docType: docCategory }); setSnackbar({ open: true, message: 'Document uploaded.', severity: 'success' }); await load(); }
    catch (err) { setSnackbar({ open: true, message: err.message, severity: 'error' }); }
    if (fileRef.current) fileRef.current.value = '';
  };

  const openDoc = async (d) => {
    try { const url = await npdService.documentUrl(d.storage_path); if (url) window.open(url, '_blank'); }
    catch (e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>;
  if (!project) return <Box sx={{ p: 3 }}><Alert severity="error">Project not found.</Alert></Box>;

  const Field = ({ label, value }) => (
    <Box><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="body2" sx={{ fontWeight: 600 }}>{value || '—'}</Typography></Box>
  );

  const Placeholder = ({ title, hint }) => (
    <Card sx={{ borderRadius: 2 }}><CardContent sx={{ textAlign: 'center', py: 6 }}>
      <InfoIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460, mx: 'auto', mt: 0.5 }}>{hint}</Typography>
    </CardContent></Card>
  );

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
        <Box sx={{ minWidth: 0 }}>
          <Button size="small" startIcon={<BackIcon />} onClick={() => navigate('/npd')} sx={{ mb: 0.5 }}>All projects</Button>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{project.product_name}</Typography>
            <Chip size="small" label={project.project_no} variant="outlined" />
            <Chip size="small" label={NPD_STAGE_LABEL[project.stage]} color="secondary" />
            {project.status !== 'active' && <Chip size="small" label={project.status} color={project.status === 'approved' ? 'success' : 'default'} />}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {project.company_name || project.customer_code || 'No customer linked'}{project.customer_part_no ? ` · part ${project.customer_part_no}` : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {nextStage && (
            <Button variant="contained" color="secondary" endIcon={<NextIcon />} onClick={() => advance(nextStage.key)}>
              Advance to {nextStage.label}
            </Button>
          )}
          <Tooltip title="Refresh"><IconButton onClick={load}><RefreshIcon /></IconButton></Tooltip>
        </Stack>
      </Stack>

      {/* Stage gate */}
      <Card sx={{ borderRadius: 2, mb: 2, overflowX: 'auto' }}>
        <CardContent>
          <Stepper activeStep={stageIdx} alternativeLabel sx={{ minWidth: 900 }}>
            {NPD_STAGES.map((s) => <Step key={s.key}><StepLabel>{s.label}</StepLabel></Step>)}
          </Stepper>
        </CardContent>
      </Card>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2 }}>
        {SECTIONS.map((s) => <Tab key={s} label={s} />)}
      </Tabs>

      {/* Overview cockpit */}
      {tab === 0 && (
        <Stack spacing={2}>
          <Card sx={{ borderRadius: 2, bgcolor: alpha(theme.palette.secondary.main, 0.05) }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">Current stage</Typography>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{NPD_STAGE_LABEL[project.stage]}</Typography>
              <Typography variant="body2" color="text.secondary">
                In this stage since {fmtDate(project.stage_entered_at)}. {nextStage ? `Next: ${nextStage.label}.` : 'Final stage.'}
              </Typography>
            </CardContent>
          </Card>
          <Card sx={{ borderRadius: 2 }}>
            <CardContent>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
                <Field label="Project no." value={project.project_no} />
                <Field label="Type" value={project.project_type} />
                <Field label="Priority" value={project.priority} />
                <Field label="Target date" value={fmtDate(project.target_date)} />
                <Field label="NPD engineer" value={project.npd_engineer_email} />
                <Field label="Salesperson" value={project.salesperson_email} />
                <Field label="CRM" value={project.crm_email} />
                <Field label="Customer code" value={project.customer_code} />
                <Field label="Internal part" value={project.internal_part_no} />
                <Field label="Product linked" value={project.product_id ? 'Yes' : 'Not yet'} />
                <Field label="Revision" value={project.revision} />
                <Field label="Created" value={fmtDate(project.created_at)} />
              </Box>
            </CardContent>
          </Card>
        </Stack>
      )}

      {/* Engineering — product gateway + Costing (Phase 2) */}
      {tab === 1 && <EngineeringTab project={project} onChanged={load} notify={setSnackbar} navigate={navigate} />}
      {/* Samples & Quality (Phase 3) */}
      {tab === 2 && <SamplesQualityTab project={project} notify={setSnackbar} />}

      {/* Activity — Timeline + Documents (Phase 1) */}
      {tab === 3 && (
        <Stack spacing={2}>
          <Card sx={{ borderRadius: 2 }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" gap={1}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Documents</Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField size="small" select label="Category" value={docCategory} onChange={(e) => setDocCategory(e.target.value)} sx={{ width: 180 }}>
                    {DOC_CATEGORIES.map((cat) => <MenuItem key={cat.v} value={cat.v}>{cat.l}</MenuItem>)}
                  </TextField>
                  <Button size="small" variant="outlined" startIcon={<UploadIcon />} onClick={() => fileRef.current?.click()}>Upload</Button>
                  <input ref={fileRef} type="file" hidden onChange={onUpload} />
                </Stack>
              </Stack>
              <Divider sx={{ mb: 1 }} />
              {docs.length === 0 ? <Typography variant="body2" color="text.secondary">No documents yet — pick a category and upload drawings, BOMs, test reports.</Typography> : (
                <Stack spacing={0.5}>
                  {docs.map((d) => {
                    const cat = DOC_CATEGORIES.find((c) => c.v === (d.category || d.doc_type));
                    return (
                      <Stack key={d.id} direction="row" spacing={1} alignItems="center" sx={{ opacity: d.is_current === false ? 0.55 : 1 }}>
                        <DocIcon fontSize="small" color="action" />
                        <Link component="button" variant="body2" onClick={() => openDoc(d)}>{d.file_name}</Link>
                        {cat && <Chip size="small" label={cat.l} sx={{ height: 18 }} />}
                        {d.version > 1 && <Chip size="small" variant="outlined" label={`v${d.version}`} sx={{ height: 18 }} />}
                        {d.is_current === false && <Chip size="small" variant="outlined" label="superseded" sx={{ height: 18 }} />}
                        <Typography variant="caption" color="text.secondary">{fmtDate(d.created_at)}</Typography>
                      </Stack>
                    );
                  })}
                </Stack>
              )}
            </CardContent>
          </Card>
          <Card sx={{ borderRadius: 2 }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Timeline</Typography>
              <Divider sx={{ mb: 1 }} />
              <Stack spacing={1}>
                {history.map((h) => (
                  <Stack key={h.id} direction="row" justifyContent="space-between" sx={{ p: 1, borderRadius: 1, bgcolor: alpha(theme.palette.text.primary, 0.03) }}>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {h.from_stage ? `${NPD_STAGE_LABEL[h.from_stage] || h.from_stage} → ` : ''}{NPD_STAGE_LABEL[h.to_stage] || h.to_stage}
                      </Typography>
                      {h.note && <Typography variant="caption" color="text.secondary">{h.note}</Typography>}
                    </Box>
                    <Typography variant="caption" color="text.secondary">{new Date(h.moved_at).toLocaleString('en-IN')} · {(h.moved_by_email || '').split('@')[0]}</Typography>
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      )}

      {/* Approvals & Production Release (Phase 3) */}
      {tab === 4 && <ApprovalsTab project={project} onChanged={load} notify={setSnackbar} />}

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
};

const fmtInr = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

function EngineeringTab({ project, onChanged, notify, navigate }) {
  const [product, setProduct] = useState(null);
  const [costings, setCostings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!project.product_id) { setProduct(null); setCostings([]); return; }
    setLoading(true);
    try {
      const [p, cs] = await Promise.all([
        plmProductService.getProduct(project.product_id),
        plmCostingService.listCostingsForProduct(project.product_id),
      ]);
      setProduct(p); setCostings(cs || []);
    } catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setLoading(false);
  }, [project.product_id, notify]);
  useEffect(() => { reload(); }, [reload]);

  const createProduct = async () => {
    setBusy(true);
    try {
      const p = await plmProductService.createProduct({
        product_name: project.product_name,
        customer_code: project.customer_code || null,
        company_name: project.company_name || null,
        customer_part_no: project.customer_part_no || null,
        product_type: 'custom',
        status: 'development',
      });
      await npdService.updateProject(project.id, { product_id: p.id });
      notify({ open: true, message: `Product ${p.product_code} created and linked.`, severity: 'success' });
      onChanged();
    } catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setBusy(false);
  };

  const startCosting = async () => {
    setBusy(true);
    try {
      await plmCostingService.createCosting(project.product_id, {
        product_name: product?.product_name || project.product_name,
        customer_code: project.customer_code || null,
      });
      notify({ open: true, message: 'Costing started.', severity: 'success' });
      await reload();
    } catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setBusy(false);
  };

  if (!project.product_id) {
    return (
      <Card sx={{ borderRadius: 2 }}>
        <CardContent sx={{ textAlign: 'center', py: 5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>No product linked yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460, mx: 'auto', my: 1.5 }}>
            Create the product to unlock Costing and BOM. It enters the Product Master as a <b>development</b> product, carrying this project's customer and part number.
          </Typography>
          <Button variant="contained" color="secondary" onClick={createProduct} disabled={busy}>
            {busy ? <CircularProgress size={20} /> : 'Create product for this project'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Stack spacing={2}>
      <Card sx={{ borderRadius: 2 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
            <Box>
              <Typography variant="overline" color="text.secondary">Linked product</Typography>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{product?.product_code} · {product?.product_name}</Typography>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                {product?.status && <Chip size="small" label={product.status} color={product.status === 'production' ? 'success' : 'default'} />}
                {product?.product_family && <Chip size="small" variant="outlined" label={product.product_family} />}
              </Stack>
            </Box>
            <Button size="small" onClick={() => navigate('/product-master')}>Open in Product Master</Button>
          </Stack>
        </CardContent>
      </Card>

      <Card sx={{ borderRadius: 2 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Costing</Typography>
            <Button size="small" onClick={startCosting} disabled={busy}>Start costing</Button>
          </Stack>
          <Divider sx={{ mb: 1 }} />
          {loading ? <CircularProgress size={22} /> : costings.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No costing yet — start one to capture material/labour/overhead and target margin.</Typography>
          ) : (
            <Stack spacing={1}>
              {costings.map((c) => (
                <Stack key={c.id} direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.costing_no} · v{c.version_number}</Typography>
                    <Chip size="small" label={c.status} sx={{ height: 18 }} />
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{fmtInr(c.total_cost)} cost</Typography>
                    <Typography variant="caption" color="text.secondary">SP {fmtInr(c.net_selling_price)} · margin {Number(c.net_margin_pct || c.target_margin_pct || 0)}%</Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      <UphCard product={product} reloadProduct={reload} notify={notify} />
      <BomEditor product={product} reloadProduct={reload} notify={notify} />
      <RoutingEditor product={product} notify={notify} />
      <ABSideConfigEditor product={product} notify={notify} />
      <QualityPlanEditor product={product} notify={notify} />
    </Stack>
  );
}

const SIDE_FIELDS = [
  { k: 'plug_type', l: 'Plug type' }, { k: 'pin_type', l: 'Pin type' },
  { k: 'terminal_type', l: 'Terminal type' }, { k: 'sleeve_type', l: 'Sleeve type' },
  { k: 'cycle_time_sec', l: 'Cycle (s)', num: true }, { k: 'quality_notes', l: 'Quality notes' },
];
function ABSideConfigEditor({ product, notify }) {
  const [sides, setSides] = useState({ A: {}, B: {} });
  const [busy, setBusy] = useState('');
  useEffect(() => {
    plmProductService.listSideConfig(product.id).then((rows) => {
      const m = { A: {}, B: {} };
      rows.forEach((r) => { m[r.side] = r; });
      setSides(m);
    }).catch(() => {});
  }, [product.id]);
  const set = (side, k, v) => setSides((s) => ({ ...s, [side]: { ...s[side], [k]: v } }));
  const save = async (side) => {
    setBusy(side);
    try { await plmProductService.saveSideConfig(product.id, side, sides[side]); notify({ open: true, message: `${side}-side saved.`, severity: 'success' }); }
    catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setBusy('');
  };
  return (
    <Card sx={{ borderRadius: 2 }}><CardContent>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>A / B-side configuration <Typography component="span" variant="caption" color="text.secondary">(plug end · open/terminal end)</Typography></Typography>
      <Divider sx={{ mb: 1.5 }} />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        {['A', 'B'].map((side) => (
          <Box key={side} sx={{ flex: 1, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{side}-side {side === 'A' ? '(plug)' : '(terminal / open end)'}</Typography>
              <Button size="small" variant="outlined" onClick={() => save(side)} disabled={busy === side}>{busy === side ? <CircularProgress size={16} /> : 'Save'}</Button>
            </Stack>
            <Stack spacing={1.5}>
              {SIDE_FIELDS.map((f) => (
                <TextField key={f.k} size="small" label={f.l} type={f.num ? 'number' : 'text'} value={sides[side][f.k] ?? ''} onChange={(e) => set(side, f.k, e.target.value)} fullWidth />
              ))}
            </Stack>
          </Box>
        ))}
      </Stack>
    </CardContent></Card>
  );
}

// Fields persisted per op. Empty string → null so the engine inherits at run time.
const ROUTING_NUM_FIELDS = [
  'standard_time_sec', 'cycle_time_sec', 'manpower', 'cavities', 'output_per_cycle',
  'scrap_pct', 'setup_time_sec', 'changeover_time_sec', 'parallel_machines',
  'min_operators', 'max_operators', 'oee',
];
const normaliseStep = (s) => {
  const out = { ...s };
  ROUTING_NUM_FIELDS.forEach((k) => { out[k] = s[k] === '' || s[k] === undefined ? null : Number(s[k]); });
  if (out.mold_id === '' || out.mold_id === undefined) out.mold_id = null;
  out.quality_check_required = !!s.quality_check_required;
  return out;
};

function RoutingEditor({ product, notify }) {
  const [steps, setSteps] = useState(null);
  const [ops, setOps] = useState([]);
  const [molds, setMolds] = useState([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('editor'); // 'editor' | 'history'

  const reloadSteps = useCallback(() => {
    plmProductService.listProcess(product.id).then(setSteps).catch(() => setSteps([]));
  }, [product.id]);
  useEffect(() => { reloadSteps(); }, [reloadSteps]);
  useEffect(() => { mesService.listOperations({ includeInactive: false }).then(setOps).catch(() => setOps([])); }, []);
  useEffect(() => { mesMasterService.listRows('molding_master').then(setMolds).catch(() => setMolds([])); }, []);

  const opFor = useCallback((s) => ops.find((o) => o.id === s.operation_id), [ops]);
  const upd = (i, k, v) => setSteps((s) => s.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => setSteps((s) => [...(s || []), { step_name: '', department: '', machine: '' }]);
  const addFromOp = (id) => {
    const o = ops.find((x) => x.id === id); if (!o) return;
    // NB: we seed identity only — std time / oee stay blank so they inherit from
    // the operation default (shown as placeholder), never as a fake editable number.
    setSteps((s) => [...(s || []), { step_name: o.name, department: o.category, machine: '', operation_id: o.id }]);
    setPick('');
  };
  const del = (i) => setSteps((s) => s.filter((_, j) => j !== i));
  const dup = (i) => setSteps((s) => { const c = [...s]; c.splice(i + 1, 0, { ...s[i] }); return c; });
  const move = (i, d) => setSteps((s) => { const j = i + d; if (j < 0 || j >= s.length) return s; const c = [...s]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const save = async () => {
    setBusy(true);
    try {
      await plmProductService.saveProcess(product.id, (steps || []).map(normaliseStep));
      notify({ open: true, message: 'Routing saved — new version recorded.', severity: 'success' });
      reloadSteps();
    } catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setBusy(false);
  };
  if (steps === null) return null;
  return (
    <Card sx={{ borderRadius: 2 }}><CardContent>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" gap={1}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Production routing <Typography component="span" variant="caption" color="text.secondary">(configurable · travels to production on release · silently versioned)</Typography></Typography>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
          <ToggleButton value="editor">Editor</ToggleButton>
          <ToggleButton value="history"><HistoryIcon fontSize="small" sx={{ mr: 0.5 }} />Revision history</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <Divider sx={{ mb: 1.5 }} />

      {view === 'history' ? (
        <RoutingHistory product={product} ops={ops} />
      ) : (
        <>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" gap={1} sx={{ mb: 1.5 }}>
            <TextField size="small" select label="Add operation" value={pick} onChange={(e) => addFromOp(e.target.value)} sx={{ width: 220 }}>
              {ops.map((o) => <MenuItem key={o.id} value={o.id}>{o.name} <Typography component="span" variant="caption" color="text.secondary">· {o.category}</Typography></MenuItem>)}
            </TextField>
            <Button size="small" onClick={add}>+ Blank</Button>
            <Box sx={{ flex: 1 }} />
            <Button size="small" variant="outlined" onClick={save} disabled={busy}>{busy ? <CircularProgress size={16} /> : 'Save routing'}</Button>
          </Stack>
          {steps.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No routing yet — pick operations (cutting → crimping → molding → testing → packing) to build the route. Blank fields inherit defaults at run time.</Typography>
          ) : (
            <Stack spacing={1}>
              {steps.map((r, i) => (
                <RoutingOpEditor
                  key={i}
                  step={r}
                  index={i}
                  total={steps.length}
                  op={opFor(r)}
                  molds={molds}
                  onChange={upd}
                  onMove={move}
                  onDup={dup}
                  onDel={del}
                />
              ))}
            </Stack>
          )}
        </>
      )}
    </CardContent></Card>
  );
}

// Read-only revision history: list every routing version, expand to see its steps.
// No approval workflow — silent versioning, view-only.
function RoutingHistory({ product, ops }) {
  const [versions, setVersions] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [versSteps, setVersSteps] = useState({});
  useEffect(() => { plmProductService.listRoutingVersions(product.id).then(setVersions).catch(() => setVersions([])); }, [product.id]);
  const toggle = async (v) => {
    if (openId === v.id) { setOpenId(null); return; }
    setOpenId(v.id);
    if (!versSteps[v.id]) {
      try {
        const rows = await plmProductService.listProcessForVersion(v.id);
        setVersSteps((m) => ({ ...m, [v.id]: rows }));
      } catch { setVersSteps((m) => ({ ...m, [v.id]: [] })); }
    }
  };
  const opName = (s) => ops.find((o) => o.id === s.operation_id)?.name || s.step_name || '—';
  if (versions === null) return <CircularProgress size={22} />;
  if (versions.length === 0) return <Typography variant="body2" color="text.secondary">No saved versions yet — save the routing to start the history.</Typography>;
  return (
    <Stack spacing={1}>
      {versions.map((v) => (
        <Box key={v.id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1, cursor: 'pointer' }} onClick={() => toggle(v)}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>v{v.version_number}</Typography>
            <Chip size="small" label={v.status || 'unknown'} color={v.status === 'active' ? 'success' : 'default'} sx={{ height: 18 }} />
            <Typography variant="caption" color="text.secondary">{fmtDate(v.effective_from || v.created_at)}</Typography>
            <Box sx={{ flex: 1 }} />
            <Link component="button" type="button" variant="caption">{openId === v.id ? 'hide steps' : 'view steps'}</Link>
          </Stack>
          <Collapse in={openId === v.id} unmountOnExit>
            <Divider />
            <Box sx={{ p: 1 }}>
              {(versSteps[v.id] || []).length === 0 ? (
                <Typography variant="caption" color="text.secondary">{versSteps[v.id] ? 'No steps in this version.' : 'Loading…'}</Typography>
              ) : (
                <Stack spacing={0.5}>
                  {versSteps[v.id].map((s, i) => (
                    <Stack key={s.id || i} direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Chip size="small" label={(s.sequence ?? i) + 1} sx={{ height: 18 }} />
                      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 140 }}>{opName(s)}</Typography>
                      {s.department && <Chip size="small" variant="outlined" label={s.department} sx={{ height: 18 }} />}
                      {s.machine && <Typography variant="caption" color="text.secondary">{s.machine}</Typography>}
                      {s.cycle_time_sec != null && <Typography variant="caption" color="text.secondary">· {s.cycle_time_sec}s cycle</Typography>}
                      {s.cavities != null && <Typography variant="caption" color="text.secondary">· {s.cavities} cav</Typography>}
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>
          </Collapse>
        </Box>
      ))}
    </Stack>
  );
}

const QP_STAGES = ['incoming', 'in_process', 'final', 'dispatch'];
const QP_COLS = [
  { k: 'characteristic', l: 'Characteristic', w: 150 }, { k: 'specification', l: 'Spec / tolerance', w: 140 },
  { k: 'method', l: 'Method / gauge', w: 130 }, { k: 'frequency', l: 'Frequency', w: 110 },
  { k: 'sample_size', l: 'Sample', w: 80 }, { k: 'reaction_plan', l: 'On fail', w: 130 },
];
function QualityPlanEditor({ product, notify }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { plmProductService.listQualityPlan(product.id).then(setRows).catch(() => setRows([])); }, [product.id]);
  const upd = (i, k, v) => setRows((s) => s.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => setRows((s) => [...(s || []), { stage: 'in_process', characteristic: '', specification: '', method: '', frequency: '', sample_size: '', reaction_plan: '' }]);
  const del = (i) => setRows((s) => s.filter((_, j) => j !== i));
  const save = async () => {
    setBusy(true);
    try { await plmProductService.saveQualityPlan(product.id, rows || []); notify({ open: true, message: 'Quality plan saved.', severity: 'success' }); }
    catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setBusy(false);
  };
  if (rows === null) return null;
  return (
    <Card sx={{ borderRadius: 2 }}><CardContent>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Quality plan <Typography component="span" variant="caption" color="text.secondary">(control plan — inspection points)</Typography></Typography>
        <Stack direction="row" spacing={1}><Button size="small" onClick={add}>+ Check</Button><Button size="small" variant="outlined" onClick={save} disabled={busy}>{busy ? <CircularProgress size={16} /> : 'Save'}</Button></Stack>
      </Stack>
      <Divider sx={{ mb: 1 }} />
      {rows.length === 0 ? <Typography variant="body2" color="text.secondary">No quality plan yet — add the checks (characteristic, spec, method, frequency).</Typography> : (
        <Stack spacing={1}>
          {rows.map((r, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <TextField size="small" select label="Stage" value={r.stage} onChange={(e) => upd(i, 'stage', e.target.value)} sx={{ width: 120 }}>
                {QP_STAGES.map((x) => <MenuItem key={x} value={x}>{x.replace('_', ' ')}</MenuItem>)}
              </TextField>
              {QP_COLS.map((c) => (
                <TextField key={c.k} size="small" label={c.l} value={r[c.k] ?? ''} onChange={(e) => upd(i, c.k, e.target.value)} sx={{ width: c.w }} />
              ))}
              <Button size="small" color="error" onClick={() => del(i)}>Remove</Button>
            </Stack>
          ))}
        </Stack>
      )}
    </CardContent></Card>
  );
}

const UPH_FIELDS = [
  { key: 'target_per_hour', label: 'Per hour' },
  { key: 'cycle_time_sec', label: 'Cycle time (sec)' },
  { key: 'operators_reqd', label: 'Operators' },
  { key: 'target_per_day', label: 'Per day' },
];
function UphCard({ product, reloadProduct, notify }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const f = {}; UPH_FIELDS.forEach(({ key }) => { f[key] = product[key] ?? ''; }); setForm(f);
  }, [product]);
  const save = async () => {
    setBusy(true);
    try {
      const patch = {}; UPH_FIELDS.forEach(({ key }) => { patch[key] = form[key] === '' ? null : Number(form[key]); });
      await plmProductService.updateProduct(product.id, patch);
      notify({ open: true, message: 'UPH / capacity saved.', severity: 'success' }); reloadProduct();
    } catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setBusy(false);
  };
  return (
    <Card sx={{ borderRadius: 2 }}><CardContent>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>UPH / capacity</Typography>
        <Button size="small" onClick={save} disabled={busy}>{busy ? <CircularProgress size={18} /> : 'Save'}</Button>
      </Stack>
      <Divider sx={{ mb: 1.5 }} />
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
        {UPH_FIELDS.map(({ key, label }) => (
          <TextField key={key} size="small" type="number" label={label} value={form[key] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} sx={{ width: 130 }} />
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Feeds production planning. Full capacity fields live in Product Master.</Typography>
    </CardContent></Card>
  );
}

function BomEditor({ product, reloadProduct, notify }) {
  const parentId = product?.ppc_item_id || null;
  const [bom, setBom] = useState([]);
  const [items, setItems] = useState([]);
  const [onHand, setOnHand] = useState({});
  const [buildQty, setBuildQty] = useState('1');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [row, setRow] = useState({ component_item_id: '', qty_per: '', scrap_pct: '' });

  const reload = useCallback(async () => {
    if (!parentId) { setBom([]); return; }
    setLoading(true);
    try {
      const [b, its, bals] = await Promise.all([
        ppcService.listBomForParent(parentId),
        ppcService.listItems({ includeInactive: false }),
        inventoryLedgerService.getBalances(),
      ]);
      setBom(b || []); setItems(its || []);
      const oh = {}; (bals || []).forEach((r) => { oh[r.item_id] = (oh[r.item_id] || 0) + Number(r.on_hand || 0); });
      setOnHand(oh);
    } catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setLoading(false);
  }, [parentId, notify]);
  useEffect(() => { reload(); }, [reload]);

  const setupBom = async () => {
    setBusy(true);
    try { await plmProductService.ensureItem(product.id); await reloadProduct(); notify({ open: true, message: 'BOM ready — add components.', severity: 'success' }); }
    catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setBusy(false);
  };
  const addLine = async () => {
    if (!row.component_item_id || !row.qty_per) { notify({ open: true, message: 'Pick a component and qty.', severity: 'warning' }); return; }
    setBusy(true);
    try {
      await ppcService.addBomLine({ parent_item_id: parentId, component_item_id: row.component_item_id, qty_per: Number(row.qty_per), scrap_pct: Number(row.scrap_pct) || 0 });
      setRow({ component_item_id: '', qty_per: '', scrap_pct: '' }); await reload();
    } catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setBusy(false);
  };
  const removeLine = async (id) => { try { await ppcService.deleteBomLine(id); await reload(); } catch (e) { notify({ open: true, message: e.message, severity: 'error' }); } };

  if (!parentId) {
    return (
      <Card sx={{ borderRadius: 2 }}><CardContent sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Bill of Materials</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ my: 1, maxWidth: 440, mx: 'auto' }}>
          Set up the BOM to list what this product consumes. It uses the production BOM engine (recursive, with scrap and MRP).
        </Typography>
        <Button variant="outlined" onClick={setupBom} disabled={busy}>{busy ? <CircularProgress size={20} /> : 'Set up BOM'}</Button>
      </CardContent></Card>
    );
  }

  return (
    <Card sx={{ borderRadius: 2 }}><CardContent>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Bill of Materials</Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }} alignItems="center">
        <TextField size="small" select label="Component" value={row.component_item_id} onChange={(e) => setRow({ ...row, component_item_id: e.target.value })} sx={{ minWidth: 220 }}>
          {items.map((it) => <MenuItem key={it.id} value={it.id}>{it.code} — {it.name}</MenuItem>)}
        </TextField>
        <TextField size="small" type="number" label="Qty / unit" value={row.qty_per} onChange={(e) => setRow({ ...row, qty_per: e.target.value })} sx={{ width: 110 }} />
        <TextField size="small" type="number" label="Scrap %" value={row.scrap_pct} onChange={(e) => setRow({ ...row, scrap_pct: e.target.value })} sx={{ width: 90 }} />
        <Button size="small" variant="outlined" onClick={addLine} disabled={busy}>Add</Button>
      </Stack>
      <Divider sx={{ mb: 1 }} />
      {loading ? <CircularProgress size={22} /> : bom.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No components yet — add what this product is made of.</Typography>
      ) : (
        <Stack spacing={0.5}>
          {bom.map((l) => (
            <Stack key={l.id} direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 90 }}>{l.component?.code}</Typography>
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>{l.component?.name}</Typography>
              <Typography variant="caption" color="text.secondary">{l.qty_per} {l.component?.uom}{Number(l.scrap_pct) ? ` · ${l.scrap_pct}% scrap` : ''}</Typography>
              <Button size="small" color="error" onClick={() => removeLine(l.id)}>Remove</Button>
            </Stack>
          ))}
        </Stack>
      )}

      {bom.length > 0 && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Material status <Typography component="span" variant="caption" color="text.secondary">(on-hand from the stock ledger)</Typography></Typography>
            <TextField size="small" type="number" label="Build qty" value={buildQty} onChange={(e) => setBuildQty(e.target.value)} sx={{ width: 110 }} />
          </Stack>
          <Stack spacing={0.5}>
            {bom.map((l) => {
              const req = Number(l.qty_per) * (1 + (Number(l.scrap_pct) || 0) / 100) * (Number(buildQty) || 0);
              const oh = onHand[l.component_item_id] || 0;
              const short = Math.max(0, req - oh);
              return (
                <Stack key={l.id + 'm'} direction="row" spacing={1} alignItems="center" sx={{ py: 0.25 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 90 }}>{l.component?.code}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
                    need {req.toLocaleString('en-IN', { maximumFractionDigits: 1 })} {l.component?.uom} · have {oh.toLocaleString('en-IN')}
                  </Typography>
                  <Chip size="small" label={short > 0 ? `short ${short.toLocaleString('en-IN', { maximumFractionDigits: 1 })}` : 'OK'} color={short > 0 ? 'error' : 'success'} sx={{ height: 18 }} />
                </Stack>
              );
            })}
          </Stack>
        </>
      )}
    </CardContent></Card>
  );
}

const SAMPLE_STATUS = ['planned', 'in_development', 'built', 'dispatched', 'approved', 'rejected'];
const QC_RESULT = ['pending', 'pass', 'fail'];
const FB_OUTCOME = ['pending', 'approved', 'approved_with_changes', 'rejected', 'resample'];
const RESULT_COLOR = { pass: 'success', fail: 'error', pending: 'default', approved: 'success', rejected: 'error', approved_with_changes: 'warning', resample: 'warning' };

function SamplesQualityTab({ project, notify }) {
  const [samples, setSamples] = useState([]);
  const [qcs, setQcs] = useState([]);
  const [fbs, setFbs] = useState([]);
  const [dsps, setDsps] = useState([]);
  const [s, setS] = useState({ sample_no: '', status: 'planned', sample_type: 'customer', received_date: '', condition: 'good' });
  const [q, setQ] = useState({ test_type: 'dimensional', parameter: '', spec_value: '', measured_value: '', result: 'pending' });
  const [f, setF] = useState({ outcome: 'pending', comments: '', sent_at: '' });
  const [dsp, setDsp] = useState({ dispatch_date: '', courier: '', tracking_no: '', quantity: '', receiver: '', feedback_due_date: '' });

  const reload = useCallback(async () => {
    try {
      const [sm, qc, fb, dp] = await Promise.all([
        npdService.listSamples(project.id), npdService.listQualityChecks(project.id), npdService.listFeedback(project.id), npdService.listDispatches(project.id),
      ]);
      setSamples(sm); setQcs(qc); setFbs(fb); setDsps(dp);
    } catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
  }, [project.id, notify]);
  useEffect(() => { reload(); }, [reload]);

  const wrap = (fn) => async () => { try { await fn(); await reload(); } catch (e) { notify({ open: true, message: e.message, severity: 'error' }); } };
  const addSample = wrap(async () => { if (!s.sample_no.trim()) return; await npdService.addSample(project.id, { ...s, received_date: s.received_date || null, revision: project.revision }); setS({ sample_no: '', status: 'planned', sample_type: 'customer', received_date: '', condition: 'good' }); });
  const addDsp = wrap(async () => { await npdService.addDispatch(project.id, { ...dsp, quantity: dsp.quantity ? Number(dsp.quantity) : null, dispatch_date: dsp.dispatch_date || null, feedback_due_date: dsp.feedback_due_date || null, revision: project.revision }); setDsp({ dispatch_date: '', courier: '', tracking_no: '', quantity: '', receiver: '', feedback_due_date: '' }); });
  const addQc = wrap(async () => { if (!q.parameter.trim()) return; await npdService.addQualityCheck(project.id, { ...q, revision: project.revision, checked_at: new Date().toISOString() }); setQ({ test_type: 'dimensional', parameter: '', spec_value: '', measured_value: '', result: 'pending' }); });
  const addFb = wrap(async () => { await npdService.addFeedback(project.id, { ...f, revision: project.revision, sent_at: f.sent_at || null }); setF({ outcome: 'pending', comments: '', sent_at: '' }); });

  return (
    <Stack spacing={2}>
      {/* Samples */}
      <Card sx={{ borderRadius: 2 }}><CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Samples <Typography component="span" variant="caption" color="text.secondary">(a customer can send several)</Typography></Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }} alignItems="center">
          <TextField size="small" label="Sample no." value={s.sample_no} onChange={(e) => setS({ ...s, sample_no: e.target.value })} sx={{ width: 130 }} />
          <TextField size="small" select label="Type" value={s.sample_type} onChange={(e) => setS({ ...s, sample_type: e.target.value })} sx={{ width: 120 }}>
            {['customer', 'our', 'competitor', 'reference'].map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}
          </TextField>
          <TextField size="small" type="date" label="Received" value={s.received_date} onChange={(e) => setS({ ...s, received_date: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ width: 140 }} />
          <TextField size="small" select label="Condition" value={s.condition} onChange={(e) => setS({ ...s, condition: e.target.value })} sx={{ width: 120 }}>
            {['good', 'damaged', 'partial'].map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}
          </TextField>
          <TextField size="small" select label="Status" value={s.status} onChange={(e) => setS({ ...s, status: e.target.value })} sx={{ width: 140 }}>
            {SAMPLE_STATUS.map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}
          </TextField>
          <Button size="small" variant="outlined" onClick={addSample}>Add</Button>
        </Stack>
        <Divider sx={{ mb: 1 }} />
        {samples.length === 0 ? <Typography variant="body2" color="text.secondary">No samples yet.</Typography> : samples.map((x) => (
          <Stack key={x.id} direction="row" spacing={1} alignItems="center" sx={{ py: 0.5, flexWrap: 'wrap' }}>
            <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 110 }}>{x.sample_no || '—'}</Typography>
            {x.sample_type && <Chip size="small" variant="outlined" label={x.sample_type} sx={{ height: 18 }} />}
            <Chip size="small" label={x.status} color={RESULT_COLOR[x.status] || 'default'} sx={{ height: 18 }} />
            {x.received_date && <Typography variant="caption" color="text.secondary">recd {fmtDate(x.received_date)}</Typography>}
            {x.condition && x.condition !== 'good' && <Chip size="small" color="warning" label={x.condition} sx={{ height: 18 }} />}
            <Typography variant="caption" color="text.secondary">rev {x.revision}</Typography>
          </Stack>
        ))}
      </CardContent></Card>

      {/* Sample dispatch */}
      <Card sx={{ borderRadius: 2 }}><CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Sample dispatch</Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }} alignItems="center">
          <TextField size="small" type="date" label="Dispatch" value={dsp.dispatch_date} onChange={(e) => setDsp({ ...dsp, dispatch_date: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ width: 140 }} />
          <TextField size="small" label="Courier" value={dsp.courier} onChange={(e) => setDsp({ ...dsp, courier: e.target.value })} sx={{ width: 120 }} />
          <TextField size="small" label="Tracking #" value={dsp.tracking_no} onChange={(e) => setDsp({ ...dsp, tracking_no: e.target.value })} sx={{ width: 130 }} />
          <TextField size="small" type="number" label="Qty" value={dsp.quantity} onChange={(e) => setDsp({ ...dsp, quantity: e.target.value })} sx={{ width: 80 }} />
          <TextField size="small" label="Receiver" value={dsp.receiver} onChange={(e) => setDsp({ ...dsp, receiver: e.target.value })} sx={{ width: 120 }} />
          <TextField size="small" type="date" label="Feedback due" value={dsp.feedback_due_date} onChange={(e) => setDsp({ ...dsp, feedback_due_date: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ width: 140 }} />
          <Button size="small" variant="outlined" onClick={addDsp}>Add</Button>
        </Stack>
        <Divider sx={{ mb: 1 }} />
        {dsps.length === 0 ? <Typography variant="body2" color="text.secondary">No dispatches yet.</Typography> : dsps.map((x) => {
          const overdue = x.feedback_due_date && x.feedback_status === 'pending' && new Date(x.feedback_due_date) < new Date();
          return (
            <Stack key={x.id} direction="row" spacing={1} alignItems="center" sx={{ py: 0.5, flexWrap: 'wrap' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{x.courier || 'courier'}{x.tracking_no ? ` · ${x.tracking_no}` : ''}</Typography>
              {x.quantity ? <Typography variant="caption" color="text.secondary">qty {x.quantity}</Typography> : null}
              {x.dispatch_date && <Typography variant="caption" color="text.secondary">sent {fmtDate(x.dispatch_date)}</Typography>}
              {x.receiver && <Typography variant="caption" color="text.secondary">→ {x.receiver}</Typography>}
              <Chip size="small" label={overdue ? 'feedback overdue' : x.feedback_status} color={overdue ? 'error' : x.feedback_status === 'received' ? 'success' : 'default'} sx={{ height: 18 }} />
              {x.feedback_due_date && <Typography variant="caption" color={overdue ? 'error.main' : 'text.secondary'}>due {fmtDate(x.feedback_due_date)}</Typography>}
            </Stack>
          );
        })}
      </CardContent></Card>

      {/* Quality checks */}
      <Card sx={{ borderRadius: 2 }}><CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Quality / inspection</Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }} alignItems="center">
          <TextField size="small" select label="Test" value={q.test_type} onChange={(e) => setQ({ ...q, test_type: e.target.value })} sx={{ width: 130 }}>
            {['dimensional', 'electrical', 'visual', 'other'].map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}
          </TextField>
          <TextField size="small" label="Parameter" value={q.parameter} onChange={(e) => setQ({ ...q, parameter: e.target.value })} sx={{ width: 150 }} />
          <TextField size="small" label="Spec" value={q.spec_value} onChange={(e) => setQ({ ...q, spec_value: e.target.value })} sx={{ width: 90 }} />
          <TextField size="small" label="Measured" value={q.measured_value} onChange={(e) => setQ({ ...q, measured_value: e.target.value })} sx={{ width: 90 }} />
          <TextField size="small" select label="Result" value={q.result} onChange={(e) => setQ({ ...q, result: e.target.value })} sx={{ width: 110 }}>
            {QC_RESULT.map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}
          </TextField>
          <Button size="small" variant="outlined" onClick={addQc}>Add</Button>
        </Stack>
        <Divider sx={{ mb: 1 }} />
        {qcs.length === 0 ? <Typography variant="body2" color="text.secondary">No checks yet.</Typography> : qcs.map((x) => (
          <Stack key={x.id} direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
            <Typography variant="body2" sx={{ minWidth: 100 }}>{x.test_type}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{x.parameter}</Typography>
            <Typography variant="caption" color="text.secondary">spec {x.spec_value || '—'} / meas {x.measured_value || '—'}</Typography>
            <Chip size="small" label={x.result} color={RESULT_COLOR[x.result]} sx={{ height: 18 }} />
          </Stack>
        ))}
      </CardContent></Card>

      {/* Customer feedback */}
      <Card sx={{ borderRadius: 2 }}><CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Customer feedback</Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }} alignItems="center">
          <TextField size="small" type="date" label="Sent" value={f.sent_at} onChange={(e) => setF({ ...f, sent_at: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ width: 150 }} />
          <TextField size="small" select label="Outcome" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} sx={{ width: 180 }}>
            {FB_OUTCOME.map((x) => <MenuItem key={x} value={x}>{x.replace(/_/g, ' ')}</MenuItem>)}
          </TextField>
          <TextField size="small" label="Comments" value={f.comments} onChange={(e) => setF({ ...f, comments: e.target.value })} sx={{ flex: 1, minWidth: 160 }} />
          <Button size="small" variant="outlined" onClick={addFb}>Add</Button>
        </Stack>
        <Divider sx={{ mb: 1 }} />
        {fbs.length === 0 ? <Typography variant="body2" color="text.secondary">No feedback yet.</Typography> : fbs.map((x) => (
          <Stack key={x.id} direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
            <Chip size="small" label={(x.outcome || '').replace(/_/g, ' ')} color={RESULT_COLOR[x.outcome] || 'default'} sx={{ height: 18 }} />
            {x.comments && <Typography variant="body2">{x.comments}</Typography>}
            {x.sent_at && <Typography variant="caption" color="text.secondary">sent {fmtDate(x.sent_at)}</Typography>}
          </Stack>
        ))}
      </CardContent></Card>
    </Stack>
  );
}

function ApprovalsTab({ project, onChanged, notify }) {
  const [busy, setBusy] = useState(false);
  const canRelease = project.stage === 'approved' || project.stage === 'production_release';
  const released = project.stage === 'production_release';
  const release = async () => {
    setBusy(true);
    try {
      const res = await npdService.releaseToProduction(project.id);
      if (res && res.ok === false) notify({ open: true, message: res.message, severity: 'warning' });
      else { notify({ open: true, message: 'Released to production — product flipped to Production.', severity: 'success' }); onChanged(); }
    } catch (e) { notify({ open: true, message: e.message, severity: 'error' }); }
    setBusy(false);
  };
  return (
    <Card sx={{ borderRadius: 2 }}><CardContent>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Approval & production release</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
        {released ? 'This project is released to production.'
          : canRelease ? 'Release flips the linked product to Production. Its BOM, costing, routing and quality plan all travel with it (they key to the product), so Production Planning gets the approved set — no re-entry.'
          : 'The project must reach the Approved stage (with a linked product) before production release.'}
      </Typography>
      <Button variant="contained" color="secondary" onClick={release} disabled={busy || !canRelease || !project.product_id || released}>
        {busy ? <CircularProgress size={20} /> : released ? 'Released' : 'Release to production'}
      </Button>
      {!project.product_id && <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>Link a product (Engineering tab) first.</Typography>}
    </CardContent></Card>
  );
}

export default NPDProject;
