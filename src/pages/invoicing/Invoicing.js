// Invoicing — generate GST tax invoices from sales orders; they flow straight
// into the existing Payments/Collections (AR) screen via finance_invoices.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Card, Chip, Table, TableHead, TableRow, TableCell,
  TableBody, CircularProgress, Alert, Snackbar, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, FormControlLabel, Switch, MenuItem, Divider, Grid,
} from '@mui/material';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import invoiceService from '../../services/invoiceService';
import { DEFAULT_GST_RATE } from '../../config/company';
import ReportExportButton from '../../components/common/ReportExportButton';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS = { issued: 'info', paid: 'success', partial: 'warning', cancelled: 'error', draft: 'default' };
const GST_RATES = [0, 5, 12, 18, 28];

function CreateDialog({ open, order, onClose, onCreated, setSnack }) {
  const [gstRate, setGstRate] = useState(DEFAULT_GST_RATE);
  const [interState, setInterState] = useState(false);
  const [termsDays, setTermsDays] = useState(30);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setGstRate(DEFAULT_GST_RATE); setInterState(false); setTermsDays(30); setInvoiceDate(new Date().toISOString().slice(0, 10)); } }, [open]);

  const submit = async () => {
    setBusy(true);
    try {
      const inv = await invoiceService.createFromSalesOrder(order.id, { gstRate, interState, termsDays, invoiceDate });
      setSnack({ message: `Invoice ${inv.invoice_number} created (${inr(inv.amount)}).`, severity: 'success' });
      onCreated();
    } catch (e) { setSnack({ message: e.message || 'Could not create invoice', severity: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Create tax invoice — {order?.so_number}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">{order?.company_name}{order?.po_number ? ` · PO ${order.po_number}` : ''}</Typography>
          <TextField select label="GST rate" value={gstRate} onChange={(e) => setGstRate(Number(e.target.value))} size="small" fullWidth>
            {GST_RATES.map((r) => <MenuItem key={r} value={r}>{r}%</MenuItem>)}
          </TextField>
          <FormControlLabel control={<Switch checked={interState} onChange={(e) => setInterState(e.target.checked)} />}
            label={<Typography variant="body2">Inter-state (IGST){!interState ? ' — intra: CGST + SGST' : ''}</Typography>} />
          <TextField label="Invoice date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} size="small" fullWidth InputLabelProps={{ shrink: true }} />
          <TextField label="Payment terms (days)" type="number" value={termsDays} onChange={(e) => setTermsDays(e.target.value)} size="small" fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create invoice'}</Button>
      </DialogActions>
    </Dialog>
  );
}

function InvoiceDetail({ id, onClose, setSnack }) {
  const [inv, setInv] = useState(null);
  useEffect(() => { (async () => { try { setInv(await invoiceService.getInvoice(id)); } catch (e) { setSnack({ message: e.message, severity: 'error' }); } })(); }, [id, setSnack]);

  const buildReport = () => {
    if (!inv) return { key: 'inv', title: 'Invoice', sections: [] };
    return {
      key: `invoice-${inv.invoice_number}`, title: `Tax Invoice ${inv.invoice_number}`,
      subtitle: `${inv.seller.name}${inv.seller.gstin ? ` · GSTIN ${inv.seller.gstin}` : ''}`, generatedAt: new Date(inv.invoice_date),
      kpis: [
        { label: 'Bill To', value: inv.customer_name || '—' },
        { label: 'Customer GSTIN', value: inv.customer_gstin || '—' },
        { label: 'Place of Supply', value: inv.place_of_supply || '—' },
        { label: 'Grand Total', value: inr(inv.amount) },
      ],
      sections: [{
        key: 'lines', title: `Line items (${inv.inter_state ? 'IGST' : 'CGST + SGST'})`,
        columns: [
          { key: 'product_name', label: 'Item' }, { key: 'hsn', label: 'HSN' }, { key: 'qty', label: 'Qty' },
          { key: 'rate', label: 'Rate' }, { key: 'taxable_value', label: 'Taxable' },
          { key: 'tax', label: inv.inter_state ? 'IGST' : 'CGST+SGST' }, { key: 'amount', label: 'Amount' },
        ],
        rows: inv.lines.map((l) => ({
          product_name: l.product_name, hsn: l.hsn || '—', qty: l.qty, rate: inr(l.rate), taxable_value: inr(l.taxable_value),
          tax: inv.inter_state ? inr(l.igst) : inr(l.cgst + l.sgst), amount: inr(l.amount),
        })),
        emptyText: 'No lines.',
      }],
    };
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        Tax Invoice {inv?.invoice_number}
        <Chip size="small" label={inv?.inter_state ? 'IGST' : 'CGST+SGST'} color="primary" variant="outlined" />
        <Box sx={{ flexGrow: 1 }} />
        {inv && <ReportExportButton buildReport={buildReport} label="Print / PDF" />}
      </DialogTitle>
      <DialogContent dividers>
        {!inv ? <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack> : (
          <Box>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">FROM</Typography>
                <Typography sx={{ fontWeight: 700 }}>{inv.seller.name}</Typography>
                {inv.seller.gstin && <Typography variant="body2">GSTIN: {inv.seller.gstin}</Typography>}
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">BILL TO</Typography>
                <Typography sx={{ fontWeight: 700 }}>{inv.customer_name || '—'}</Typography>
                {inv.customer_gstin && <Typography variant="body2">GSTIN: {inv.customer_gstin}</Typography>}
                {inv.place_of_supply && <Typography variant="body2">Place of supply: {inv.place_of_supply}</Typography>}
              </Grid>
            </Grid>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead><TableRow>{['Item', 'HSN', 'Qty', 'Rate', 'Taxable', inv.inter_state ? 'IGST' : 'CGST', inv.inter_state ? '' : 'SGST', 'Amount'].filter((h) => h !== '').map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.7rem' }} align={['Item', 'HSN'].includes(h) ? 'left' : 'right'}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>{inv.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell sx={{ fontWeight: 600 }}>{l.product_name}</TableCell>
                    <TableCell>{l.hsn || '—'}</TableCell>
                    <TableCell align="right">{l.qty} {l.uom}</TableCell>
                    <TableCell align="right">{inr(l.rate)}</TableCell>
                    <TableCell align="right">{inr(l.taxable_value)}</TableCell>
                    {inv.inter_state ? <TableCell align="right">{inr(l.igst)}</TableCell> : <><TableCell align="right">{inr(l.cgst)}</TableCell><TableCell align="right">{inr(l.sgst)}</TableCell></>}
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{inr(l.amount)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </Box>
            <Divider sx={{ my: 1.5 }} />
            <Stack spacing={0.5} sx={{ ml: 'auto', maxWidth: 280 }}>
              {[['Taxable value', inv.taxable_value], inv.inter_state ? ['IGST', inv.igst] : ['CGST', inv.cgst], ...(inv.inter_state ? [] : [['SGST', inv.sgst]]), ['Round off', inv.round_off]].map(([k, v]) => (
                <Stack key={k} direction="row" justifyContent="space-between"><Typography variant="body2" color="text.secondary">{k}</Typography><Typography variant="body2">{inr(v)}</Typography></Stack>
              ))}
              <Divider />
              <Stack direction="row" justifyContent="space-between"><Typography sx={{ fontWeight: 800 }}>Grand Total</Typography><Typography sx={{ fontWeight: 800 }}>{inr(inv.amount)}</Typography></Stack>
              <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Due {inv.due_date}</Typography><Typography variant="caption" color="text.secondary">Balance {inr(inv.balance)}</Typography></Stack>
            </Stack>
          </Box>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

export default function Invoicing() {
  const [orders, setOrders] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState(null);
  const [create, setCreate] = useState(null);
  const [detailId, setDetailId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, i] = await Promise.all([invoiceService.listEligibleOrders(), invoiceService.listInvoices()]);
      setOrders(o); setInvoices(i);
    } catch (e) { setSnack({ message: e.message || 'Failed', severity: 'error' }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const onCreated = () => { setCreate(null); load(); };
  const uninvoiced = orders.filter((o) => !o.invoiced_number);

  const buildReport = () => ({
    key: 'invoices', title: 'Tax Invoices', subtitle: 'Reyansh International', generatedAt: new Date(),
    kpis: [{ label: 'Invoices', value: invoices.length }, { label: 'Billed value', value: inr(invoices.reduce((s, r) => s + Number(r.amount || 0), 0)) }, { label: 'Outstanding', value: inr(invoices.reduce((s, r) => s + Number(r.balance || 0), 0)) }],
    sections: [{
      key: 'l', title: 'Invoices',
      columns: [{ key: 'invoice_number', label: 'Invoice' }, { key: 'customer_name', label: 'Customer' }, { key: 'invoice_date', label: 'Date' }, { key: 'amount', label: 'Amount' }, { key: 'balance', label: 'Balance' }, { key: 'status', label: 'Status' }],
      rows: invoices.map((r) => ({ invoice_number: r.invoice_number, customer_name: r.customer_name, invoice_date: r.invoice_date, amount: r.amount, balance: r.balance, status: r.status })),
      emptyText: 'No invoices.',
    }],
  });

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <ReceiptLongOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Invoicing</Typography>
        <Chip size="small" variant="outlined" label="GST tax invoice" color="primary" />
        <Box sx={{ flexGrow: 1 }} />
        <ReportExportButton buildReport={buildReport} label="Export" />
      </Stack>
      <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
        Invoices created here post straight into <strong>Payments / Collections</strong> (accounts receivable). Set your GSTIN &amp; state in <code>src/config/company.js</code> for full tax-invoice headers.
      </Alert>

      {loading ? <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack> : (
        <Stack spacing={2}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <Box sx={{ px: 2, py: 1.25, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Ready to invoice</Typography>
              <Chip size="small" label={uninvoiced.length} color={uninvoiced.length ? 'primary' : 'default'} sx={{ fontWeight: 700 }} />
            </Box>
            {uninvoiced.length === 0 ? <Box sx={{ p: 3 }}><Typography variant="body2" color="text.secondary">No un-invoiced sales orders. Release/dispatch a sales order and it will appear here.</Typography></Box> : (
              <Table size="small">
                <TableHead><TableRow>{['SO No.', 'Customer', 'PO', 'Value', 'Status', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>{uninvoiced.map((o) => (
                  <TableRow key={o.id} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{o.so_number}</TableCell>
                    <TableCell>{o.company_name}</TableCell>
                    <TableCell>{o.po_number || '—'}</TableCell>
                    <TableCell>{inr(o.total_value)}</TableCell>
                    <TableCell><Chip size="small" label={o.status} variant="outlined" /></TableCell>
                    <TableCell align="right"><Button size="small" variant="contained" onClick={() => setCreate(o)} sx={{ borderRadius: 2 }}>Create invoice</Button></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </Card>

          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <Box sx={{ px: 2, py: 1.25, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Invoices</Typography>
              <Chip size="small" label={invoices.length} sx={{ fontWeight: 700 }} />
            </Box>
            {invoices.length === 0 ? <Box sx={{ p: 3 }}><Typography variant="body2" color="text.secondary">No invoices yet.</Typography></Box> : (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead><TableRow>{['Invoice', 'Customer', 'Date', 'Taxable', 'Tax', 'Total', 'Balance', 'Status', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }} align={['Taxable', 'Tax', 'Total', 'Balance'].includes(h) ? 'right' : 'left'}>{h}</TableCell>)}</TableRow></TableHead>
                  <TableBody>{invoices.map((r) => (
                    <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => setDetailId(r.id)}>
                      <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.invoice_number}</TableCell>
                      <TableCell>{r.customer_name}</TableCell>
                      <TableCell><Typography variant="caption">{r.invoice_date}</Typography></TableCell>
                      <TableCell align="right">{inr(r.taxable_value)}</TableCell>
                      <TableCell align="right">{inr((Number(r.cgst) || 0) + (Number(r.sgst) || 0) + (Number(r.igst) || 0))}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{inr(r.amount)}</TableCell>
                      <TableCell align="right">{inr(r.balance)}</TableCell>
                      <TableCell><Chip size="small" label={r.status} color={STATUS[r.status] || 'default'} variant={r.status === 'paid' ? 'filled' : 'outlined'} /></TableCell>
                      <TableCell align="right"><Button size="small" onClick={(e) => { e.stopPropagation(); setDetailId(r.id); }}>View</Button></TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </Box>
            )}
          </Card>
        </Stack>
      )}

      <CreateDialog open={!!create} order={create} onClose={() => setCreate(null)} onCreated={onCreated} setSnack={setSnack} />
      {detailId && <InvoiceDetail id={detailId} onClose={() => setDetailId(null)} setSnack={setSnack} />}

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
