import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Stack, Card, CardContent, Typography, Button, IconButton, Chip, Tabs, Tab, Divider,
  CircularProgress, Snackbar, Alert, Tooltip, Stepper, Step, StepLabel, Link, useTheme, alpha,
} from '@mui/material';
import {
  ArrowBack as BackIcon, Refresh as RefreshIcon, ArrowForward as NextIcon, UploadFile as UploadIcon,
  Description as DocIcon, Info as InfoIcon,
} from '@mui/icons-material';
import npdService, { NPD_STAGES, NPD_STAGE_LABEL } from '../../services/npdService';

const SECTIONS = ['Overview', 'Engineering', 'Samples & Quality', 'Activity', 'Approvals'];

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
    try { await npdService.uploadDocument(id, file); setSnackbar({ open: true, message: 'Document uploaded.', severity: 'success' }); await load(); }
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

      {/* Engineering (Phase 2) */}
      {tab === 1 && (
        <Placeholder title="Engineering — BOM, Costing, UPH, Material (Phase 2)"
          hint={project.product_id
            ? 'This project has a linked product. The BOM, Costing and Material tabs wire to it in Phase 2.'
            : 'Create/link a product to start its BOM and Costing. The product master, costing engine and BOM explosion already exist; Phase 2 connects them here.'} />
      )}
      {/* Samples & Quality (Phase 3) */}
      {tab === 2 && (
        <Placeholder title="Samples & Quality (Phase 3)" hint="Sample development tracking, inspection/test reports, and customer feedback land here in Phase 3." />
      )}

      {/* Activity — Timeline + Documents (Phase 1) */}
      {tab === 3 && (
        <Stack spacing={2}>
          <Card sx={{ borderRadius: 2 }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Documents</Typography>
                <Button size="small" startIcon={<UploadIcon />} onClick={() => fileRef.current?.click()}>Upload</Button>
                <input ref={fileRef} type="file" hidden onChange={onUpload} />
              </Stack>
              <Divider sx={{ mb: 1 }} />
              {docs.length === 0 ? <Typography variant="body2" color="text.secondary">No documents yet — upload drawings, samples, specs.</Typography> : (
                <Stack spacing={0.5}>
                  {docs.map((d) => (
                    <Stack key={d.id} direction="row" spacing={1} alignItems="center">
                      <DocIcon fontSize="small" color="action" />
                      <Link component="button" variant="body2" onClick={() => openDoc(d)}>{d.file_name}</Link>
                      {d.doc_type && d.doc_type !== 'other' && <Chip size="small" label={d.doc_type} sx={{ height: 18 }} />}
                      <Typography variant="caption" color="text.secondary">{fmtDate(d.created_at)}</Typography>
                    </Stack>
                  ))}
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

      {/* Approvals (Phase 3) */}
      {tab === 4 && (
        <Placeholder title="Approvals & Production Release (Phase 3)" hint="Customer approval capture and the one-click Production Release (flips the product to Production + snapshots BOM/costing) land here in Phase 3." />
      )}

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
};

export default NPDProject;
