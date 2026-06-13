import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid,
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
  AutoAwesomeOutlined,
  CloudUploadOutlined,
  InfoOutlined,
  CheckCircleOutlineRounded,
} from '@mui/icons-material';
import { preparePoFile, extractPurchaseOrder } from '../../services/poExtractionService';

const ACCEPT = '.pdf,.xlsx,.xls,.csv,image/*';

/** AI Purchase-Order upload → extract → preview → apply to the Sales Order form. */
const AIPurchaseOrderUpload = ({ onApply }) => {
  const theme = useTheme();
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [po, setPo] = useState(null);
  const [applied, setApplied] = useState(false);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setError(null); setBusy(true); setPo(null); setApplied(false);
    try {
      const prepared = await preparePoFile(file);
      if (!prepared) { setError('Unsupported file. Upload a PDF, image, or Excel/CSV.'); setBusy(false); return; }
      const result = await extractPurchaseOrder([prepared]);
      if (!result) { setError('Could not read this purchase order.'); }
      else { setPo(result); setFileName(file.name); }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const onDrop = useCallback((e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer?.files?.[0]); }, [handleFile]);

  const apply = () => { onApply?.(po); setApplied(true); };

  const items = po?.line_items || [];

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 2, md: 2.5 }, mb: 3 }}>
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.5 }}>
        <Box sx={{ width: 36, height: 36, borderRadius: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, 0.12) }}>
          <AutoAwesomeOutlined sx={{ color: 'primary.main' }} />
        </Box>
        <Box>
          <Typography variant="subtitle1" fontWeight={800}>AI Purchase-Order Capture</Typography>
          <Typography variant="caption" color="text.secondary">Upload a PO (PDF, scan/photo, or Excel) — AI reads it and fills the form below.</Typography>
        </Box>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {applied && <Alert severity="success" icon={<CheckCircleOutlineRounded />} sx={{ mb: 2, borderRadius: 2 }}>Applied to the Sales Order form below — review and submit.</Alert>}

      {!po && (
        <Box
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !busy && fileRef.current?.click()}
          sx={{
            p: { xs: 3, md: 4 }, borderRadius: 2.5, borderStyle: 'dashed', borderWidth: 2,
            border: '2px dashed', borderColor: dragOver ? 'primary.main' : 'divider',
            bgcolor: dragOver ? alpha(theme.palette.primary.main, 0.04) : 'transparent',
            textAlign: 'center', cursor: busy ? 'default' : 'pointer', transition: 'all 0.2s ease',
            '&:hover': { borderColor: alpha(theme.palette.primary.main, 0.5) },
          }}
        >
          <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => handleFile(e.target.files?.[0])} />
          {busy ? <CircularProgress size={36} /> : <CloudUploadOutlined sx={{ fontSize: 40, color: 'primary.main', mb: 0.5 }} />}
          <Typography variant="subtitle1" fontWeight={700}>{busy ? 'Reading the PO…' : dragOver ? 'Drop to read' : 'Drag & drop a purchase order'}</Typography>
          <Typography variant="body2" color="text.secondary">PDF · image/scan · Excel/CSV</Typography>
        </Box>
      )}

      {po && (
        <>
          <Grid container spacing={1.5} sx={{ mb: 2 }}>
            {[
              ['Buyer', po.buyer_name], ['PO #', po.po_number], ['PO Date', po.po_date],
              ['Delivery', po.delivery_date], ['Payment Terms', po.payment_terms], ['Currency', po.currency],
            ].map(([label, val]) => (
              <Grid item xs={6} md={4} key={label}>
                <Box sx={{ p: 1.25, borderRadius: 1.5, border: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', fontSize: '0.62rem', display: 'block' }}>{label}</Typography>
                  <Typography variant="body2" fontWeight={600} noWrap>{val || '—'}</Typography>
                </Box>
              </Grid>
            ))}
          </Grid>

          <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>Line items ({items.length})</Typography>
          <TableContainer sx={{ maxHeight: 280, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow sx={{ '& th': { bgcolor: 'grey.100', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'text.secondary', whiteSpace: 'nowrap' } }}>
                  <TableCell>Description</TableCell>
                  <TableCell>Code</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell>Unit</TableCell>
                  <TableCell align="right">Rate</TableCell>
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((li, i) => (
                  <TableRow key={i} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{li.description}</TableCell>
                    <TableCell>{li.product_code || '—'}</TableCell>
                    <TableCell align="right">{li.quantity}</TableCell>
                    <TableCell>{li.unit}</TableCell>
                    <TableCell align="right">{li.unit_price ? `₹${li.unit_price}` : '—'}</TableCell>
                    <TableCell align="right">{li.amount ? `₹${li.amount}` : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {po.warnings?.length > 0 && (
            <Alert severity="warning" sx={{ mt: 2, borderRadius: 2 }}>
              {po.warnings.map((w, i) => <div key={i}>{w}</div>)}
            </Alert>
          )}

          <Divider sx={{ my: 2 }} />
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button variant="contained" startIcon={<CheckCircleOutlineRounded />} onClick={apply} disabled={applied}>
              {applied ? 'Applied' : 'Apply to Sales Order form'}
            </Button>
            <Button variant="text" onClick={() => { setPo(null); setApplied(false); setFileName(''); }}>Upload another</Button>
            {po.total_amount ? <Chip label={`PO Total ₹${po.total_amount.toLocaleString('en-IN')}`} sx={{ fontWeight: 700, ml: 'auto' }} /> : null}
          </Stack>
        </>
      )}

      <Alert severity="info" icon={<InfoOutlined />} sx={{ mt: 2, borderRadius: 2 }}>
        Runs via a Supabase Edge Function (your Anthropic key stays server-side). If it says "not reachable", deploy <code>extract-purchase-order</code> and set <code>ANTHROPIC_API_KEY</code>.
      </Alert>
    </Paper>
  );
};

export default AIPurchaseOrderUpload;
