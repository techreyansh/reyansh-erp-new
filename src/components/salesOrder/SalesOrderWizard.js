// Sales Order wizard — 6 steps: Customer → PO details → Products (from the PLM
// master, released-costing auto-fetch) → Validation → Review → Release.
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Dialog, AppBar, Toolbar, Typography, IconButton, Box, Button, Stepper, Step, StepLabel,
  TextField, MenuItem, Stack, Grid, Card, CardContent, Chip, Table, TableHead, TableRow,
  TableCell, TableBody, Divider, Alert, Autocomplete, CircularProgress, useTheme, alpha,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import CloudUpload from '@mui/icons-material/CloudUpload';
import CheckCircle from '@mui/icons-material/CheckCircle';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import { listClients, listProspects } from '../../services/crmPipelineService';
import plm from '../../services/plmProductService';
import costing from '../../services/plmCostingService';
import so from '../../services/salesOrderService';

const STEPS = ['Customer', 'PO details', 'Products', 'Validation', 'Review', 'Release'];
const inr = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function SalesOrderWizard({ onClose, onCreated, notify }) {
  const theme = useTheme();
  const [step, setStep] = useState(0);
  const [accounts, setAccounts] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const poRef = useRef(null);

  const [customer, setCustomer] = useState(null);
  const [po, setPo] = useState({ po_number: '', po_date: todayStr(), po_revision: '', po_validity: '', customer_ref: '', buyer_name: '', contact: '', payment_terms: '', special_instructions: '', expected_delivery_date: '', priority: 'medium' });
  const [poFile, setPoFile] = useState(null);
  const [lines, setLines] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [cl, pr, pd] = await Promise.all([listClients().catch(() => []), listProspects().catch(() => []), plm.listProducts().catch(() => [])]);
        setAccounts([...cl, ...pr]); setProducts(pd);
      } finally { setLoading(false); }
    })();
  }, []);

  const addLine = async (product) => {
    if (!product) return;
    let unit_price = 0, revision = product.current_revision || '', costing_version_id = null, hasCosting = false;
    try {
      const c = await costing.getLatestReleased(product.id);
      if (c) { unit_price = Number(c.net_selling_price) || 0; costing_version_id = c.id; hasCosting = true; }
    } catch { /* ignore */ }
    setLines((ls) => [...ls, {
      product_id: product.id, product_code: product.product_code, product_name: product.product_name,
      customer_part_no: product.customer_part_no || '', revision, qty: 1, uom: 'pc', unit_price,
      costing_version_id, hasCosting, required_delivery_date: '', remarks: '',
    }]);
  };
  const updLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const delLine = (i) => setLines((ls) => ls.filter((_, j) => j !== i));

  const totals = useMemo(() => ({
    qty: lines.reduce((a, l) => a + (Number(l.qty) || 0), 0),
    value: lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0),
  }), [lines]);

  const issues = useMemo(() => {
    const out = [];
    if (!customer) out.push({ level: 'error', msg: 'No customer selected' });
    if (!po.po_number) out.push({ level: 'warn', msg: 'Customer PO number missing' });
    if (!poFile) out.push({ level: 'warn', msg: 'Customer PO PDF not attached' });
    if (lines.length === 0) out.push({ level: 'error', msg: 'No products added' });
    lines.forEach((l) => {
      if (!l.hasCosting) out.push({ level: 'warn', msg: `${l.product_name}: no released costing — price entered manually` });
      if (!(Number(l.qty) > 0)) out.push({ level: 'error', msg: `${l.product_name}: quantity must be > 0` });
      if (!(Number(l.unit_price) > 0)) out.push({ level: 'warn', msg: `${l.product_name}: unit price is 0` });
    });
    return out;
  }, [customer, po, poFile, lines]);
  const hasBlockers = issues.some((i) => i.level === 'error');

  const canNext = useMemo(() => {
    if (step === 0) return !!customer;
    if (step === 2) return lines.length > 0;
    if (step === 3) return !hasBlockers;
    return true;
  }, [step, customer, lines, hasBlockers]);

  const submit = useCallback(async (release) => {
    setSaving(true);
    try {
      const header = {
        customer_code: customer?.customer_code || null, company_name: customer?.company_name || null,
        po_number: po.po_number || null, po_date: po.po_date || null, po_revision: po.po_revision || null,
        po_validity: po.po_validity || null, customer_ref: po.customer_ref || null, buyer_name: po.buyer_name || null,
        contact: po.contact || null, payment_terms: po.payment_terms || null, special_instructions: po.special_instructions || null,
        expected_delivery_date: po.expected_delivery_date || null, priority: po.priority,
        margin_est_pct: null,
      };
      const order = await so.createOrder({ header, lines, status: release ? 'released' : 'draft' });
      if (poFile) { try { await so.uploadOrderDocument(order.id, poFile, 'po'); } catch { /* non-fatal */ } }
      notify(`Order ${order.so_number} ${release ? 'released' : 'saved as draft'}`);
      onCreated?.(order);
      onClose();
    } catch (e) { notify(e.message || 'Failed to create order', 'error'); }
    finally { setSaving(false); }
  }, [customer, po, lines, poFile, notify, onCreated, onClose]);

  return (
    <Dialog fullScreen open onClose={onClose}>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary', borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Toolbar>
          <Typography variant="h6" sx={{ fontWeight: 800, flex: 1 }}>New Sales Order</Typography>
          <IconButton onClick={onClose}><CloseIcon /></IconButton>
        </Toolbar>
        <Box sx={{ px: 3, pb: 1.5 }}>
          <Stepper activeStep={step} alternativeLabel>
            {STEPS.map((s) => <Step key={s}><StepLabel>{s}</StepLabel></Step>)}
          </Stepper>
        </Box>
      </AppBar>

      <Box sx={{ p: { xs: 1.5, md: 3 }, bgcolor: 'background.default', minHeight: '100%', maxWidth: 1000, mx: 'auto' }}>
        {loading ? <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress /></Stack> : (
          <>
            {/* STEP 1 — Customer */}
            {step === 0 && (
              <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
                <Typography variant="overline" color="text.secondary">Select customer</Typography>
                <Autocomplete
                  options={accounts} getOptionLabel={(o) => `${o.company_name}${o.customer_code ? ` (${o.customer_code})` : ''}`}
                  value={customer} onChange={(_, v) => setCustomer(v)} sx={{ mt: 1, maxWidth: 480 }}
                  renderInput={(params) => <TextField {...params} label="Customer" placeholder="Search…" />}
                />
                {customer && (
                  <Grid container spacing={1.5} sx={{ mt: 1 }}>
                    {[['Status', customer.account_type || customer.kind || '—'], ['Credit limit', customer.credit_limit ? inr(customer.credit_limit) : '—'],
                      ['Total business', customer.total_value ? inr(customer.total_value) : '—'], ['Salesperson', customer.owner_email || 'Unassigned'],
                      ['Last contact', customer.last_contact_date || '—']].map(([k, v]) => (
                      <Grid item xs={6} sm={4} key={k}>
                        <Box sx={{ p: 1.25, borderRadius: 1, bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                          <Typography variant="caption" color="text.secondary">{k}</Typography>
                          <Typography variant="body2" fontWeight={600}>{String(v)}</Typography>
                        </Box>
                      </Grid>
                    ))}
                  </Grid>
                )}
              </CardContent></Card>
            )}

            {/* STEP 2 — PO details */}
            {step === 1 && (
              <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
                <Typography variant="overline" color="text.secondary">Purchase order details</Typography>
                <Box sx={{ display: 'grid', gap: 2, mt: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' } }}>
                  {[['Customer PO number', 'po_number'], ['Customer ref', 'customer_ref'], ['Buyer name', 'buyer_name'], ['Contact', 'contact'], ['Payment terms', 'payment_terms']].map(([label, k]) => (
                    <TextField key={k} size="small" label={label} value={po[k]} onChange={(e) => setPo((p) => ({ ...p, [k]: e.target.value }))} />
                  ))}
                  <TextField size="small" type="date" label="PO date" InputLabelProps={{ shrink: true }} value={po.po_date} onChange={(e) => setPo((p) => ({ ...p, po_date: e.target.value }))} />
                  <TextField size="small" type="date" label="Expected delivery" InputLabelProps={{ shrink: true }} value={po.expected_delivery_date} onChange={(e) => setPo((p) => ({ ...p, expected_delivery_date: e.target.value }))} />
                  <TextField size="small" type="date" label="PO validity" InputLabelProps={{ shrink: true }} value={po.po_validity} onChange={(e) => setPo((p) => ({ ...p, po_validity: e.target.value }))} />
                  <TextField size="small" label="PO revision" value={po.po_revision} onChange={(e) => setPo((p) => ({ ...p, po_revision: e.target.value }))} />
                  <TextField select size="small" label="Priority" value={po.priority} onChange={(e) => setPo((p) => ({ ...p, priority: e.target.value }))}>
                    {['critical', 'high', 'medium', 'low'].map((x) => <MenuItem key={x} value={x} sx={{ textTransform: 'capitalize' }}>{x}</MenuItem>)}
                  </TextField>
                </Box>
                <TextField size="small" label="Special instructions" value={po.special_instructions} onChange={(e) => setPo((p) => ({ ...p, special_instructions: e.target.value }))} fullWidth multiline minRows={2} sx={{ mt: 2 }} />
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
                  <input ref={poRef} type="file" hidden onChange={(e) => setPoFile(e.target.files?.[0] || null)} />
                  <Button variant="outlined" startIcon={<CloudUpload />} onClick={() => poRef.current?.click()}>Attach PO PDF</Button>
                  {poFile && <Chip label={poFile.name} onDelete={() => setPoFile(null)} />}
                </Stack>
              </CardContent></Card>
            )}

            {/* STEP 3 — Products */}
            {step === 2 && (
              <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
                <Typography variant="overline" color="text.secondary">Line items (from Product Master)</Typography>
                <Autocomplete
                  options={products} getOptionLabel={(o) => `${o.product_name} (${o.product_code})`}
                  value={null} onChange={(_, v) => { addLine(v); }} blurOnSelect clearOnBlur
                  sx={{ mt: 1, maxWidth: 480 }}
                  renderInput={(params) => <TextField {...params} label="Add product" placeholder="Search the product master…" InputProps={{ ...params.InputProps, startAdornment: <AddIcon sx={{ ml: 1, color: 'text.disabled' }} /> }} />}
                />
                {products.length === 0 && <Alert severity="info" sx={{ mt: 1 }}>No products in the master yet — create them in Product Master first.</Alert>}
                {lines.length > 0 && (
                  <Table size="small" sx={{ mt: 2 }}>
                    <TableHead><TableRow>{['Product', 'Rev', 'Qty', 'UOM', 'Unit price', 'Req. date', 'Value', ''].map((h) => <TableCell key={h} sx={{ fontSize: '0.7rem', fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                    <TableBody>
                      {lines.map((l, i) => (
                        <TableRow key={i}>
                          <TableCell>{l.product_name}{!l.hasCosting && <Chip size="small" label="no costing" color="warning" sx={{ ml: 0.5, height: 16, fontSize: 9 }} />}</TableCell>
                          <TableCell>{l.revision || '—'}</TableCell>
                          <TableCell><TextField size="small" variant="standard" type="number" value={l.qty} onChange={(e) => updLine(i, { qty: e.target.value })} sx={{ width: 64 }} /></TableCell>
                          <TableCell><TextField size="small" variant="standard" value={l.uom} onChange={(e) => updLine(i, { uom: e.target.value })} sx={{ width: 50 }} /></TableCell>
                          <TableCell><TextField size="small" variant="standard" type="number" value={l.unit_price} onChange={(e) => updLine(i, { unit_price: e.target.value })} sx={{ width: 90 }} /></TableCell>
                          <TableCell><TextField size="small" variant="standard" type="date" value={l.required_delivery_date} onChange={(e) => updLine(i, { required_delivery_date: e.target.value })} /></TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{inr((Number(l.qty) || 0) * (Number(l.unit_price) || 0))}</TableCell>
                          <TableCell><IconButton size="small" color="error" onClick={() => delLine(i)}><DeleteOutline fontSize="small" /></IconButton></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent></Card>
            )}

            {/* STEP 4 — Validation */}
            {step === 3 && (
              <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
                <Typography variant="overline" color="text.secondary">Validation</Typography>
                {issues.length === 0 ? (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2, color: 'success.main' }}><CheckCircle /> <Typography>All checks passed.</Typography></Stack>
                ) : (
                  <Stack spacing={1} sx={{ mt: 1 }}>
                    {issues.map((it, i) => (
                      <Alert key={i} severity={it.level === 'error' ? 'error' : 'warning'} icon={it.level === 'error' ? <ErrorOutline /> : undefined}>{it.msg}</Alert>
                    ))}
                  </Stack>
                )}
                {hasBlockers && <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>Resolve the errors above before proceeding.</Typography>}
              </CardContent></Card>
            )}

            {/* STEP 5 — Review */}
            {step === 4 && (
              <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent>
                <Typography variant="overline" color="text.secondary">Review</Typography>
                <Grid container spacing={1.5} sx={{ mt: 0.5, mb: 2 }}>
                  {[['Customer', customer?.company_name], ['PO', po.po_number || '—'], ['Priority', po.priority], ['Lines', lines.length], ['Total qty', totals.qty], ['Total value', inr(totals.value)]].map(([k, v]) => (
                    <Grid item xs={6} sm={4} key={k}><Box sx={{ p: 1.25, borderRadius: 1, bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                      <Typography variant="caption" color="text.secondary">{k}</Typography><Typography variant="body2" fontWeight={700}>{String(v)}</Typography>
                    </Box></Grid>
                  ))}
                </Grid>
                <Table size="small"><TableHead><TableRow>{['Product', 'Qty', 'Price', 'Value'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>)}</TableRow></TableHead>
                  <TableBody>{lines.map((l, i) => <TableRow key={i}><TableCell>{l.product_name}</TableCell><TableCell>{l.qty} {l.uom}</TableCell><TableCell>{inr(l.unit_price)}</TableCell><TableCell>{inr((Number(l.qty) || 0) * (Number(l.unit_price) || 0))}</TableCell></TableRow>)}</TableBody>
                </Table>
              </CardContent></Card>
            )}

            {/* STEP 6 — Release */}
            {step === 5 && (
              <Card variant="outlined" sx={{ borderRadius: 2 }}><CardContent sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="h6" fontWeight={800}>{customer?.company_name} · {inr(totals.value)}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{lines.length} line(s) · {totals.qty} units{po.po_number ? ` · PO ${po.po_number}` : ''}</Typography>
                {hasBlockers && <Alert severity="error" sx={{ mt: 2, textAlign: 'left' }}>There are blocking issues — go back to Validation.</Alert>}
                <Stack direction="row" spacing={1.5} justifyContent="center" sx={{ mt: 3 }}>
                  <Button variant="outlined" onClick={() => submit(false)} disabled={saving || hasBlockers}>Save as draft</Button>
                  <Button variant="contained" onClick={() => submit(true)} disabled={saving || hasBlockers}>{saving ? 'Working…' : 'Release order ▶'}</Button>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>Released orders trigger downstream planning.</Typography>
              </CardContent></Card>
            )}

            {/* nav */}
            <Stack direction="row" justifyContent="space-between" sx={{ mt: 2 }}>
              <Button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</Button>
              {step < STEPS.length - 1 && <Button variant="contained" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Next</Button>}
            </Stack>
          </>
        )}
      </Box>
    </Dialog>
  );
}
