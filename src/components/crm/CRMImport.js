import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Grid,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  CloudUploadOutlined,
  ContactMailOutlined,
  GroupsOutlined,
  InfoOutlined,
  PersonAddAlt1Outlined,
  StorefrontOutlined,
} from '@mui/icons-material';
import { parseCrmWorkbook, analyzeAgainstErp, importProspects, importCustomers } from '../../services/crmImportService';
import { StatCard } from '../common/kit';

const ACCEPT = '.xlsx,.xls';

const CRMImport = () => {
  const theme = useTheme();
  const fileRef = useRef(null);

  const [fileName, setFileName] = useState('');
  const [data, setData] = useState(null); // { leads, customers, existingCount }
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // 'parse' | 'leads' | 'customers'
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState({ leads: null, customers: null });

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) { setError('Please upload the CRM Excel file (.xlsx).'); return; }
    setError(null); setBusy('parse'); setData(null); setResult({ leads: null, customers: null });
    try {
      const parsed = await parseCrmWorkbook(file);
      if (!parsed.leads.length && !parsed.customers.length) {
        setError('No Lead Master / Customer Master rows found. Is this the Reyansh CRM Tracker file?');
        setBusy(null); return;
      }
      const analyzed = await analyzeAgainstErp(parsed);
      setData(analyzed);
      setFileName(file.name);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }, []);

  const onDrop = useCallback((e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer?.files?.[0]); }, [handleFile]);

  const newLeads = useMemo(() => (data?.leads || []).filter((l) => !l.exists), [data]);
  const newCustomers = useMemo(() => (data?.customers || []).filter((c) => !c.exists), [data]);

  const runImport = async (kind) => {
    setBusy(kind); setError(null); setProgress({ done: 0, total: 0 });
    const onProg = (done, total) => setProgress({ done, total });
    try {
      if (kind === 'leads') {
        const r = await importProspects(newLeads, onProg);
        setResult((p) => ({ ...p, leads: r }));
      } else {
        const r = await importCustomers(newCustomers, onProg);
        setResult((p) => ({ ...p, customers: r }));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const PreviewTable = ({ title, rows, extraCol }) => (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ p: 1.5 }}>{title} ({rows.length})</Typography>
      <Divider />
      <TableContainer sx={{ maxHeight: 360 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow sx={{ '& th': { bgcolor: 'grey.100', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'text.secondary', whiteSpace: 'nowrap' } }}>
              <TableCell>Company</TableCell>
              <TableCell>{extraCol}</TableCell>
              <TableCell>Contact</TableCell>
              <TableCell>In ERP?</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i} hover sx={{ opacity: r.exists ? 0.55 : 1 }}>
                <TableCell sx={{ fontWeight: 600 }}>{r.clientName}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{extraCol === 'Segment' ? (r._segment || '—') : (r._leadStatus || r.city || '—')}</TableCell>
                <TableCell>{r.contacts?.[0]?.name || '—'}</TableCell>
                <TableCell>
                  {r.exists
                    ? <Chip size="small" label="Exists" sx={{ height: 20, bgcolor: alpha('#475569', 0.12), color: '#475569', fontWeight: 600 }} />
                    : <Chip size="small" label="New" sx={{ height: 20, bgcolor: alpha('#059669', 0.14), color: '#059669', fontWeight: 700 }} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 8 }}>
      <Box sx={{ background: `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, transparent 100%)`, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Container maxWidth="xl" sx={{ py: { xs: 3, md: 4 }, px: { xs: 2, sm: 3 } }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ width: 44, height: 44, borderRadius: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, 0.1) }}>
              <ContactMailOutlined sx={{ color: 'primary.main' }} />
            </Box>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1 }}>CRM Import</Typography>
              <Typography variant="body1" color="text.secondary">Bring your CRM tracker (Lead Master + Customer Master) into the ERP.</Typography>
            </Box>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ px: { xs: 2, sm: 3 }, mt: 3 }}>
        <Alert severity="info" icon={<InfoOutlined />} sx={{ mb: 3, borderRadius: 2.5 }}>
          Upload your <strong>Reyansh CRM Tracker .xlsx</strong>. Leads → <strong>Prospects</strong>, Customers → <strong>Clients</strong>. Companies already in the ERP are matched by name and skipped (no duplicates). Activities, pipeline & payments come in a later phase.
        </Alert>

        {error && <Alert severity="error" sx={{ mb: 3, borderRadius: 2.5 }} onClose={() => setError(null)}>{error}</Alert>}

        {(result.leads || result.customers) && (
          <Alert severity="success" sx={{ mb: 3, borderRadius: 2.5 }}>
            {result.leads && `Imported ${result.leads.ok} prospects${result.leads.failed ? ` (${result.leads.failed} failed)` : ''}. `}
            {result.customers && `Imported ${result.customers.ok} clients${result.customers.failed ? ` (${result.customers.failed} failed)` : ''}.`}
          </Alert>
        )}

        {/* Upload zone */}
        <Paper
          variant="outlined"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          sx={{
            p: { xs: 3, md: 4 }, mb: 3, borderRadius: 3, borderStyle: 'dashed', borderWidth: 2,
            borderColor: dragOver ? 'primary.main' : 'divider',
            bgcolor: dragOver ? alpha(theme.palette.primary.main, 0.04) : 'transparent',
            textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s ease',
            '&:hover': { borderColor: alpha(theme.palette.primary.main, 0.5) },
          }}
        >
          <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => handleFile(e.target.files?.[0])} />
          {busy === 'parse' ? <CircularProgress size={40} /> : <CloudUploadOutlined sx={{ fontSize: 44, color: 'primary.main', mb: 1 }} />}
          <Typography variant="h6" fontWeight={700}>{busy === 'parse' ? 'Reading…' : dragOver ? 'Drop to read' : 'Drag & drop your CRM tracker'}</Typography>
          <Typography variant="body2" color="text.secondary">{fileName || 'Excel (.xlsx) — the Reyansh CRM Tracker file'}</Typography>
        </Paper>

        {data && (
          <>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={6} md={3}><StatCard label="Leads in file" value={data.leads.length} sub={`${newLeads.length} new`} icon={GroupsOutlined} accent="#1E7DBE" /></Grid>
              <Grid item xs={6} md={3}><StatCard label="Customers in file" value={data.customers.length} sub={`${newCustomers.length} new`} icon={StorefrontOutlined} accent="#45ADE6" /></Grid>
              <Grid item xs={6} md={3}><StatCard label="Already in ERP" value={(data.leads.length - newLeads.length) + (data.customers.length - newCustomers.length)} sub="matched by name" icon={InfoOutlined} accent="#475569" /></Grid>
              <Grid item xs={6} md={3}><StatCard label="ERP records" value={data.existingCount} sub="current accounts" icon={ContactMailOutlined} accent="#7C3AED" /></Grid>
            </Grid>

            {busy && progress.total > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">Importing {progress.done}/{progress.total}…</Typography>
                <LinearProgress variant="determinate" value={(progress.done / progress.total) * 100} sx={{ borderRadius: 1, height: 6 }} />
              </Box>
            )}

            <Stack direction="row" spacing={1.5} sx={{ mb: 3 }} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                startIcon={busy === 'leads' ? <CircularProgress size={16} color="inherit" /> : <PersonAddAlt1Outlined />}
                disabled={!!busy || !newLeads.length || !!result.leads}
                onClick={() => runImport('leads')}
              >
                {result.leads ? 'Prospects imported' : `Import ${newLeads.length} new prospects`}
              </Button>
              <Button
                variant="contained"
                startIcon={busy === 'customers' ? <CircularProgress size={16} color="inherit" /> : <StorefrontOutlined />}
                disabled={!!busy || !newCustomers.length || !!result.customers}
                onClick={() => runImport('customers')}
              >
                {result.customers ? 'Clients imported' : `Import ${newCustomers.length} new clients`}
              </Button>
            </Stack>

            <Grid container spacing={2}>
              <Grid item xs={12} lg={6}><PreviewTable title="Leads → Prospects" rows={data.leads} extraCol="Status" /></Grid>
              <Grid item xs={12} lg={6}><PreviewTable title="Customers → Clients" rows={data.customers} extraCol="Segment" /></Grid>
            </Grid>

            {(result.leads?.errors?.length || result.customers?.errors?.length) ? (
              <Alert severity="warning" sx={{ mt: 3, borderRadius: 2.5 }}>
                <Typography variant="subtitle2" fontWeight={700}>Some rows failed:</Typography>
                {[...(result.leads?.errors || []), ...(result.customers?.errors || [])].slice(0, 10).map((e, i) => <div key={i}>{e}</div>)}
              </Alert>
            ) : null}
          </>
        )}
      </Container>
    </Box>
  );
};

export default CRMImport;
