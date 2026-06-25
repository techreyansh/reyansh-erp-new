// Documents for a CRM account (CRM 360 P4). Upload (categorised) to the shared
// 'documents' bucket, list, download via signed URL, delete. Reusable.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Stack, Typography, Button, Card, CardContent, Chip, IconButton, Tooltip,
  TextField, MenuItem, CircularProgress, Snackbar, Alert, LinearProgress,
} from '@mui/material';
import {
  UploadFileRounded, DownloadRounded, DeleteOutlineRounded, DescriptionRounded,
} from '@mui/icons-material';
import crmPipelineService from '../../services/crmPipelineService';

const DOC_TYPES = ['GST Certificate', 'PAN', 'Purchase Order', 'Agreement', 'NDA', 'Drawing', 'Other'];
const dt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

export default function CompanyDocuments({ accountId }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [docType, setDocType] = useState('GST Certificate');
  const [uploading, setUploading] = useState(false);
  const [snack, setSnack] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try { setDocs(await crmPipelineService.listDocuments(accountId) || []); }
    catch { setDocs([]); }
    setLoading(false);
  }, [accountId]);
  useEffect(() => { load(); }, [load]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await crmPipelineService.uploadDocument(accountId, file, docType);
      await load();
      setSnack({ severity: 'success', message: `${file.name} uploaded.` });
    } catch (err) { setSnack({ severity: 'error', message: err?.message || 'Upload failed.' }); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const download = async (d) => {
    try {
      const url = await crmPipelineService.getDocumentUrl(d.storage_path);
      if (url) window.open(url, '_blank', 'noopener');
      else setSnack({ severity: 'error', message: 'Could not get the file link.' });
    } catch (e) { setSnack({ severity: 'error', message: e?.message || 'Download failed.' }); }
  };

  const remove = async (d) => {
    if (!window.confirm(`Delete ${d.file_name || 'this document'}?`)) return;
    try { await crmPipelineService.deleteDocument(d.id, d.storage_path); await load(); }
    catch (e) { setSnack({ severity: 'error', message: e?.message || 'Delete failed.' }); }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={22} /></Box>;

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1 }}>Documents ({docs.length})</Typography>
        <TextField select size="small" label="Type" value={docType} onChange={(e) => setDocType(e.target.value)} sx={{ minWidth: 160 }}>
          {DOC_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
        </TextField>
        <Button size="small" variant="contained" startIcon={<UploadFileRounded />} disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? 'Uploading…' : 'Upload'}
        </Button>
        <input ref={fileRef} type="file" hidden onChange={onFile} />
      </Stack>
      {uploading && <LinearProgress sx={{ mb: 1 }} />}

      {docs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No documents yet — upload GST/PAN, POs, agreements, NDAs, drawings.</Typography>
      ) : (
        <Stack spacing={1}>
          {docs.map((d) => (
            <Card key={d.id} variant="outlined">
              <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <DescriptionRounded color="action" fontSize="small" />
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{d.file_name || '—'}</Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {d.doc_type && <Chip size="small" variant="outlined" label={d.doc_type} sx={{ height: 18 }} />}
                      <Typography variant="caption" color="text.secondary">{dt(d.created_at)}{d.uploaded_by_email ? ` · ${d.uploaded_by_email}` : ''}</Typography>
                    </Stack>
                  </Box>
                  <Tooltip title="Download"><IconButton size="small" onClick={() => download(d)}><DownloadRounded fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Delete"><IconButton size="small" onClick={() => remove(d)}><DeleteOutlineRounded fontSize="small" /></IconButton></Tooltip>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
