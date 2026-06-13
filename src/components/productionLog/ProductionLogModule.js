import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  AutoAwesomeOutlined,
  CloudUploadOutlined,
  DeleteOutline,
  DescriptionOutlined,
  GridOnOutlined,
  ImageOutlined,
  InfoOutlined,
  SaveOutlined,
  TableChartOutlined,
} from '@mui/icons-material';
import { prepareFile, extractFromFiles, analyzeRows, saveExtraction } from '../../services/productionLogService';
import { StatCard } from '../common/kit';

const ACCEPT = '.xlsx,.xls,.csv,image/*';
const DEPARTMENTS = ['assembly', 'cable', 'molding', 'other'];

let _uid = 0;
const nextId = () => { _uid += 1; return `f${_uid}`; };

const ProductionLogModule = () => {
  const theme = useTheme();
  const fileRef = useRef(null);

  const [files, setFiles] = useState([]); // prepared files + id
  const [department, setDepartment] = useState('assembly');
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // 'extract' | 'analyze' | 'save'
  const [extraction, setExtraction] = useState(null); // {entries, departments, warnings}
  const [analysis, setAnalysis] = useState(null);
  const [saved, setSaved] = useState(null);

  const addFiles = useCallback(async (fileList) => {
    setError(null);
    const arr = Array.from(fileList || []);
    const prepared = [];
    const errs = [];
    for (const file of arr) {
      try {
        const p = await prepareFile(file);
        if (p) prepared.push({ ...p, id: nextId(), size: file.size });
        else errs.push(`${file.name}: unsupported type`);
      } catch (e) {
        errs.push(`${file.name}: ${e.message}`);
      }
    }
    if (errs.length) setError(errs.join(' · '));
    if (prepared.length) {
      setFiles((prev) => [...prev, ...prepared]);
      setExtraction(null);
      setAnalysis(null);
      setSaved(null);
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer?.files);
  }, [addFiles]);

  const removeFile = (id) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const runExtract = async () => {
    setBusy('extract'); setError(null); setAnalysis(null); setSaved(null);
    try {
      const result = await extractFromFiles(files, department);
      setExtraction(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const runAnalyze = async () => {
    if (!extraction?.entries?.length) return;
    setBusy('analyze'); setError(null);
    try {
      const result = await analyzeRows(extraction.entries);
      setAnalysis(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const runSave = async () => {
    if (!extraction?.entries?.length) return;
    setBusy('save'); setError(null);
    try {
      const res = await saveExtraction({
        entries: extraction.entries,
        sourceName: files.map((f) => f.name).join(', ').slice(0, 200),
        sourceKind: files.some((f) => f.kind === 'image') ? 'image' : 'excel',
        department,
        raw: { warnings: extraction.warnings },
      });
      setSaved(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const entries = extraction?.entries || [];
  const totalTarget = entries.reduce((a, e) => a + (+e.target || 0), 0);
  const totalAchieved = entries.reduce((a, e) => a + (+e.achieved || 0), 0);
  const achievementPct = totalTarget > 0 ? Math.round((totalAchieved / totalTarget) * 100) : 0;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 8 }}>
      {/* Hero */}
      <Box sx={{ background: `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, transparent 100%)`, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Container maxWidth="xl" sx={{ py: { xs: 3, md: 4 }, px: { xs: 2, sm: 3 } }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ width: 44, height: 44, borderRadius: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, 0.1) }}>
              <GridOnOutlined sx={{ color: 'primary.main' }} />
            </Box>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1 }}>Production Log</Typography>
              <Typography variant="body1" color="text.secondary">Upload hourly sheets — Excel, CSV, or photos — and let AI read, normalize, and analyze them.</Typography>
            </Box>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ px: { xs: 2, sm: 3 }, mt: 3 }}>
        <Alert severity="info" icon={<InfoOutlined />} sx={{ mb: 3, borderRadius: 2.5 }}>
          AI reading runs in a Supabase Edge Function (your Anthropic key stays server-side). If extraction says the service isn't reachable, deploy it:
          <code style={{ margin: '0 4px' }}>supabase functions deploy extract-production-log</code> and set <code>ANTHROPIC_API_KEY</code>.
        </Alert>

        {error && <Alert severity="error" sx={{ mb: 3, borderRadius: 2.5 }} onClose={() => setError(null)}>{error}</Alert>}
        {saved && <Alert severity="success" sx={{ mb: 3, borderRadius: 2.5 }} onClose={() => setSaved(null)}>Saved {saved.inserted} rows to the database.</Alert>}

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
          <input ref={fileRef} type="file" accept={ACCEPT} hidden multiple onChange={(e) => addFiles(e.target.files)} />
          <CloudUploadOutlined sx={{ fontSize: 44, color: 'primary.main', mb: 1 }} />
          <Typography variant="h6" fontWeight={700}>{dragOver ? 'Drop to add' : 'Drag & drop sheets or photos'}</Typography>
          <Typography variant="body2" color="text.secondary">multiple files OK · Excel, CSV, or photos of production sheets</Typography>
        </Paper>

        {/* File list */}
        {files.length > 0 && (
          <Paper variant="outlined" sx={{ borderRadius: 2.5, p: 2, mb: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle1" fontWeight={700}>{files.length} file{files.length > 1 ? 's' : ''} ready</Typography>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <TextField select size="small" label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} sx={{ minWidth: 150 }}>
                  {DEPARTMENTS.map((d) => <MenuItem key={d} value={d} sx={{ textTransform: 'capitalize' }}>{d}</MenuItem>)}
                </TextField>
                <Button variant="contained" startIcon={busy === 'extract' ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeOutlined />} disabled={!!busy} onClick={runExtract}>
                  {busy === 'extract' ? 'Reading…' : 'Extract with AI'}
                </Button>
              </Stack>
            </Stack>
            <Grid container spacing={1.5}>
              {files.map((f) => (
                <Grid item xs={6} sm={4} md={3} key={f.id}>
                  <Paper variant="outlined" sx={{ p: 1, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                    {f.kind === 'image' ? (
                      <Box component="img" src={f.dataUrl} alt="" sx={{ width: 44, height: 44, borderRadius: 1, objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <Box sx={{ width: 44, height: 44, borderRadius: 1, bgcolor: alpha(theme.palette.primary.main, 0.08), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <DescriptionOutlined sx={{ color: 'primary.main' }} />
                      </Box>
                    )}
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="caption" fontWeight={600} noWrap sx={{ display: 'block' }}>{f.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {f.kind === 'image' ? <><ImageOutlined sx={{ fontSize: 12, verticalAlign: 'middle' }} /> photo</> : <><TableChartOutlined sx={{ fontSize: 12, verticalAlign: 'middle' }} /> {(f.rows?.length || 0)} rows</>}
                      </Typography>
                    </Box>
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}><DeleteOutline fontSize="small" /></IconButton>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Paper>
        )}

        {/* Extraction result */}
        {extraction && (
          <>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={6} md={3}><StatCard label="Rows extracted" value={entries.length} sub="line × hour" icon={TableChartOutlined} accent="#1E7DBE" /></Grid>
              <Grid item xs={6} md={3}><StatCard label="Total Target" value={Math.round(totalTarget).toLocaleString('en-IN')} icon={GridOnOutlined} accent="#7C3AED" /></Grid>
              <Grid item xs={6} md={3}><StatCard label="Total Achieved" value={Math.round(totalAchieved).toLocaleString('en-IN')} icon={GridOnOutlined} accent="#45ADE6" /></Grid>
              <Grid item xs={6} md={3}><StatCard label="Achievement" value={`${achievementPct}%`} icon={AutoAwesomeOutlined} accent={achievementPct >= 90 ? '#059669' : achievementPct >= 70 ? '#D97706' : '#DC2626'} /></Grid>
            </Grid>

            {extraction.warnings?.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2, borderRadius: 2.5 }}>
                {extraction.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </Alert>
            )}

            <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden', mb: 3 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight={700}>Normalized rows</Typography>
                <Stack direction="row" spacing={1}>
                  <Button variant="outlined" startIcon={busy === 'analyze' ? <CircularProgress size={16} /> : <AutoAwesomeOutlined />} disabled={!!busy} onClick={runAnalyze}>
                    {busy === 'analyze' ? 'Analyzing…' : 'Analyze'}
                  </Button>
                  <Button variant="contained" startIcon={busy === 'save' ? <CircularProgress size={16} color="inherit" /> : <SaveOutlined />} disabled={!!busy} onClick={runSave}>
                    {busy === 'save' ? 'Saving…' : 'Save to database'}
                  </Button>
                </Stack>
              </Stack>
              <Divider />
              <TableContainer sx={{ maxHeight: 460 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow sx={{ '& th': { bgcolor: 'grey.100', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'text.secondary' } }}>
                      {['Date', 'Line', 'Model', 'MP', 'Slot', 'Target', 'Achieved', 'Down (min)', 'Reason'].map((h) => <TableCell key={h}>{h}</TableCell>)}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {entries.map((e, i) => {
                      const behind = (+e.achieved || 0) < (+e.target || 0);
                      return (
                        <TableRow key={i} hover>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{e.log_date}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{e.line_no}</TableCell>
                          <TableCell>{e.model}</TableCell>
                          <TableCell>{e.manpower}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{e.time_slot}</TableCell>
                          <TableCell>{e.target}</TableCell>
                          <TableCell sx={{ color: behind ? 'error.main' : 'success.main', fontWeight: 700 }}>{e.achieved}</TableCell>
                          <TableCell>{e.downtime_minutes || ''}</TableCell>
                          <TableCell>{e.reason ? <Chip size="small" label={e.reason} sx={{ fontWeight: 600, bgcolor: alpha('#DC2626', 0.1), color: '#DC2626' }} /> : ''}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </>
        )}

        {/* Analysis */}
        {analysis && (
          <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 2, md: 3 }, mb: 3 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
              <AutoAwesomeOutlined sx={{ color: 'primary.main' }} />
              <Typography variant="h6" fontWeight={800}>AI Analysis</Typography>
            </Stack>

            {analysis.summary && (
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2, bgcolor: alpha(theme.palette.primary.main, 0.03) }}>
                <Typography variant="body1">{analysis.summary}</Typography>
              </Paper>
            )}

            <Grid container spacing={2}>
              {analysis.root_causes?.length > 0 && (
                <Grid item xs={12} md={6}>
                  <Typography variant="overline" fontWeight={800}>Root causes</Typography>
                  <Stack spacing={1} sx={{ mt: 1 }}>
                    {analysis.root_causes.map((rc, i) => (
                      <Paper key={i} variant="outlined" sx={{ p: 1.5, borderRadius: 2, borderLeft: '4px solid #DC2626' }}>
                        <Typography variant="subtitle2" fontWeight={700}>{rc.title} {rc.lost_units ? <Chip size="small" label={`-${Math.round(rc.lost_units)} units`} sx={{ ml: 0.5, height: 18, fontWeight: 700, bgcolor: alpha('#DC2626', 0.1), color: '#DC2626' }} /> : null}</Typography>
                        <Typography variant="caption" color="text.secondary">{rc.line_no} {rc.time_slot} — {rc.detail}</Typography>
                      </Paper>
                    ))}
                  </Stack>
                </Grid>
              )}
              {analysis.downtime?.length > 0 && (
                <Grid item xs={12} md={6}>
                  <Typography variant="overline" fontWeight={800}>Downtime by reason</Typography>
                  <Stack spacing={1} sx={{ mt: 1 }}>
                    {analysis.downtime.map((d, i) => (
                      <Stack key={i} direction="row" justifyContent="space-between" sx={{ p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="body2" fontWeight={600}>{d.reason}</Typography>
                        <Typography variant="body2" color="text.secondary">{Math.round(d.total_minutes)} min · {d.occurrences}×</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Grid>
              )}
              {analysis.comparisons?.length > 0 && (
                <Grid item xs={12} md={6}>
                  <Typography variant="overline" fontWeight={800}>Line / shift comparison</Typography>
                  <Stack spacing={1} sx={{ mt: 1 }}>
                    {analysis.comparisons.map((c, i) => (
                      <Box key={i}>
                        <Typography variant="subtitle2" fontWeight={700}>{c.label}</Typography>
                        <Typography variant="caption" color="text.secondary">{c.detail}</Typography>
                      </Box>
                    ))}
                  </Stack>
                </Grid>
              )}
              {analysis.recommendations?.length > 0 && (
                <Grid item xs={12} md={6}>
                  <Typography variant="overline" fontWeight={800}>Recommended actions</Typography>
                  <Stack spacing={0.75} sx={{ mt: 1 }}>
                    {analysis.recommendations.map((r, i) => (
                      <Stack key={i} direction="row" spacing={1}>
                        <Typography variant="body2" color="primary.main" fontWeight={800}>{i + 1}.</Typography>
                        <Typography variant="body2">{r}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Grid>
              )}
            </Grid>
          </Paper>
        )}
      </Container>
    </Box>
  );
};

export default ProductionLogModule;
