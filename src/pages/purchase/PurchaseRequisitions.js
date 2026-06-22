// Purchase Requisitions — demand-driven requests (raised from MRP shortfalls).
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Card, Chip, Table, TableHead, TableRow,
  TableCell, TableBody, CircularProgress, Alert, Snackbar, IconButton, Collapse, Button,
} from '@mui/material';
import ShoppingCartOutlined from '@mui/icons-material/ShoppingCartOutlined';
import KeyboardArrowDownRounded from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowRightRounded from '@mui/icons-material/KeyboardArrowRightRounded';
import pr from '../../services/purchaseRequisitionService';
import ReportExportButton from '../../components/common/ReportExportButton';

const STATUS = {
  draft: { label: 'Draft', color: 'default', next: 'submitted', nextLabel: 'Submit' },
  submitted: { label: 'Submitted', color: 'info', next: 'approved', nextLabel: 'Approve' },
  approved: { label: 'Approved', color: 'success', next: 'converted', nextLabel: 'Mark converted' },
  converted: { label: 'Converted to PO', color: 'primary', next: null },
  cancelled: { label: 'Cancelled', color: 'error', next: null },
};
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

function PrRow({ row, onChanged, setSnack }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const st = STATUS[row.status] || {};

  const toggle = async () => {
    const next = !open; setOpen(next);
    if (next && !detail) { try { setDetail(await pr.getRequisition(row.id)); } catch (e) { setSnack({ message: e.message, severity: 'error' }); } }
  };
  const advance = async () => {
    try { await pr.transitionStatus(row.id, st.next); onChanged(); }
    catch (e) { setSnack({ message: e.message, severity: 'error' }); }
  };

  return (
    <>
      <TableRow hover sx={{ '& > *': { borderBottom: open ? 'unset' : undefined } }}>
        <TableCell><IconButton size="small" onClick={toggle}>{open ? <KeyboardArrowDownRounded /> : <KeyboardArrowRightRounded />}</IconButton></TableCell>
        <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{row.pr_number}</TableCell>
        <TableCell><Chip size="small" label={st.label} color={st.color} variant={row.status === 'draft' ? 'outlined' : 'filled'} sx={{ fontWeight: 600 }} /></TableCell>
        <TableCell>{row.source}</TableCell>
        <TableCell align="right">{inr(row.total_estimated)}</TableCell>
        <TableCell><Typography variant="caption" color="text.secondary">{new Date(row.created_at).toLocaleDateString('en-IN')}</Typography></TableCell>
        <TableCell align="right">
          {st.next && <Button size="small" variant="outlined" onClick={advance} sx={{ borderRadius: 2 }}>{st.nextLabel}</Button>}
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={7} sx={{ py: 0, border: 0 }}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ m: 1.5 }}>
              {!detail ? <CircularProgress size={18} /> : (
                <Table size="small">
                  <TableHead><TableRow>{['Material', 'Code', 'Required', 'On hand', 'Order qty', 'Est rate', 'Est amount'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.68rem' }} align={['Material', 'Code'].includes(h) ? 'left' : 'right'}>{h}</TableCell>)}</TableRow></TableHead>
                  <TableBody>{detail.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell sx={{ fontWeight: 600 }}>{l.material_name}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{l.material_code || '—'}</TableCell>
                      <TableCell align="right">{Number(l.required_qty).toLocaleString('en-IN')} {l.uom}</TableCell>
                      <TableCell align="right">{l.on_hand == null ? '—' : Number(l.on_hand).toLocaleString('en-IN')}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{Number(l.order_qty).toLocaleString('en-IN')}</TableCell>
                      <TableCell align="right">{l.est_rate ? inr(l.est_rate) : '—'}</TableCell>
                      <TableCell align="right">{l.est_amount ? inr(l.est_amount) : '—'}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

export default function PurchaseRequisitions() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await pr.listRequisitions()); }
    catch (e) { setSnack({ message: e.message || 'Failed', severity: 'error' }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = rows.filter((r) => !['converted', 'cancelled'].includes(r.status));
  const buildReport = () => ({
    key: 'pr', title: 'Purchase Requisitions', subtitle: 'Reyansh International', generatedAt: new Date(),
    kpis: [{ label: 'Total PRs', value: rows.length }, { label: 'Open', value: open.length }, { label: 'Est. value (open)', value: inr(open.reduce((s, r) => s + Number(r.total_estimated || 0), 0)) }],
    sections: [{
      key: 'list', title: 'Requisitions',
      columns: [{ key: 'pr_number', label: 'PR No.' }, { key: 'status', label: 'Status' }, { key: 'source', label: 'Source' }, { key: 'total_estimated', label: 'Est. value' }],
      rows: rows.map((r) => ({ pr_number: r.pr_number, status: STATUS[r.status]?.label, source: r.source, total_estimated: r.total_estimated })),
      emptyText: 'No requisitions.',
    }],
  });

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <ShoppingCartOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Purchase Requisitions</Typography>
        <Box sx={{ flexGrow: 1 }} />
        <ReportExportButton buildReport={buildReport} label="Export" />
      </Stack>
      <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
        Raise requisitions from the <strong>Material Requirements (MRP)</strong> page — its “Raise Purchase Requisition” button turns current shortfalls into a draft PR here.
      </Alert>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        {loading ? <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack> : rows.length === 0 ? (
          <Box sx={{ p: 3 }}><Typography variant="body2" color="text.secondary">No requisitions yet.</Typography></Box>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead><TableRow>{['', 'PR No.', 'Status', 'Source', 'Est. value', 'Created', ''].map((h, i) => <TableCell key={i} sx={{ fontWeight: 700, fontSize: '0.72rem' }} align={h === 'Est. value' ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>{rows.map((r) => <PrRow key={r.id} row={r} onChanged={load} setSnack={setSnack} />)}</TableBody>
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
