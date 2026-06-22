// MRP — material requirements rolled up from released orders' costings.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Grid, Card, CardContent, Chip, Table, TableHead,
  TableRow, TableCell, TableBody, CircularProgress, Alert, Snackbar,
} from '@mui/material';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import mrp from '../../services/mrpService';
import ReportExportButton from '../../components/common/ReportExportButton';

export default function MaterialRequirements() {
  const [data, setData] = useState({ materials: [], lineCount: 0 });
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await mrp.computeMrp()); }
    catch (e) { setSnack({ message: e.message || 'Failed', severity: 'error' }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const buildReport = () => ({
    key: 'mrp', title: 'Material Requirements (MRP)', subtitle: 'Reyansh International', generatedAt: new Date(),
    kpis: [{ label: 'Distinct Materials', value: data.materials.length }, { label: 'Order Lines', value: data.lineCount }],
    sections: [{
      key: 'mat', title: 'Material Requirements',
      columns: [{ key: 'name', label: 'Material' }, { key: 'code', label: 'Code' }, { key: 'qty', label: 'Required Qty' }, { key: 'uom', label: 'UOM' }],
      rows: data.materials.map((m) => ({ name: m.name, code: m.code, qty: m.qty, uom: m.uom })),
      emptyText: 'No material requirements.',
    }],
  });

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <Inventory2Outlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Material Requirements (MRP)</Typography>
        <Chip size="small" variant="outlined" label="from released orders" color="primary" />
        <Box sx={{ flexGrow: 1 }} />
        <ReportExportButton buildReport={buildReport} label="Export MRP" />
      </Stack>

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {[['Distinct materials', data.materials.length, 'primary'], ['Order lines costed', data.lineCount, 'secondary']].map(([label, val, color]) => (
          <Grid item xs={6} sm={3} key={label}>
            <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 700, fontSize: '0.6rem' }}>{label}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 800, color: `${color}.main` }}>{val}</Typography>
            </CardContent></Card>
          </Grid>
        ))}
      </Grid>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        {loading ? <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack> : data.materials.length === 0 ? (
          <Box sx={{ p: 3 }}><Alert severity="info">No requirements yet — release sales orders with costed line items (the costing's material lines drive MRP).</Alert></Box>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead><TableRow>{['Material', 'Code', 'Required qty', 'UOM'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>{data.materials.map((m, i) => (
                <TableRow key={i} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{m.name}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{m.code || '—'}</TableCell>
                  <TableCell>{m.qty.toLocaleString('en-IN')}</TableCell>
                  <TableCell>{m.uom || '—'}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </Box>
        )}
      </Card>

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
