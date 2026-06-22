// Costing line-item editor with a live margin calculator. Opened from a
// product's Costing tab. Lines grouped by section; material lines can pull a
// central rate; live summary recomputes via the pure costingEngine.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Dialog, AppBar, Toolbar, Typography, IconButton, Box, Button, TextField, MenuItem,
  Stack, Chip, Table, TableHead, TableRow, TableCell, TableBody, Divider, Tooltip,
  CircularProgress, Alert, Menu, useTheme, alpha,
} from '@mui/material';
import bomService, { bomToCostingLines } from '../../services/bomService';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import costing from '../../services/plmCostingService';
import { recompute, COST_SECTIONS } from '../../services/costingEngine';

const SECTION_LABEL = { material: 'Material', labour: 'Labour', machine: 'Machine', overhead: 'Overheads', financial: 'Financial' };
const inr = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function CostingEditor({ costingId, onClose, onSaved, notify }) {
  const theme = useTheme();
  const [version, setVersion] = useState(null);
  const [lines, setLines] = useState([]);
  const [rates, setRates] = useState([]);
  const [margin, setMargin] = useState(20);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bomAnchor, setBomAnchor] = useState(null);
  const [boms, setBoms] = useState([]);

  const openBom = async (e) => {
    setBomAnchor(e.currentTarget);
    if (!boms.length) { try { setBoms(await bomService.listBoms()); } catch { /* ignore */ } }
  };
  const importBom = (bom) => {
    setBomAnchor(null);
    const imported = bomToCostingLines(bom, rates);
    setLines((ls) => [...ls, ...imported.map((l, i) => ({ ...l, sequence: ls.length + i }))]);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ version: v, lines: l }, r] = await Promise.all([costing.getCosting(costingId), costing.listMaterialRates()]);
      setVersion(v); setLines(l); setRates(r); setMargin(Number(v.target_margin_pct) || 20);
    } finally { setLoading(false); }
  }, [costingId]);
  useEffect(() => { load(); }, [load]);

  const editable = version && (version.status === 'draft' || version.status === 'reviewed');

  const summary = useMemo(() => recompute(lines, { targetMarginPct: margin }), [lines, margin]);

  const addLine = (section) => setLines((ls) => [...ls, { section, category: '', material_code: '', qty: '', uom: '', rate: '', amount: '', is_percentage: false }]);
  const updLine = (idx, patch) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const delLine = (idx) => setLines((ls) => ls.filter((_, i) => i !== idx));

  const pickRate = (idx, code) => {
    const r = rates.find((x) => x.material_code === code);
    updLine(idx, { material_code: code, category: r?.material_name || code, rate: r ? r.rate : '', uom: r?.uom || '' });
  };

  const save = async () => {
    setSaving(true);
    try {
      // normalize: amount = qty*rate when both present and not a percentage line
      const norm = lines.map((l) => {
        const qty = Number(l.qty), rate = Number(l.rate);
        const amount = l.is_percentage ? Number(l.amount) || 0
          : (l.qty !== '' && l.rate !== '' ? +(qty * rate).toFixed(2) : Number(l.amount) || 0);
        return { ...l, qty: l.qty === '' ? null : qty, rate: l.rate === '' ? null : rate, amount };
      });
      await costing.saveCostingLines(costingId, norm, { targetMarginPct: margin });
      notify('Costing saved');
      onSaved?.();
      onClose();
    } catch (e) { notify(e.message || 'Save failed', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog fullScreen open onClose={onClose}>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary', borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Toolbar sx={{ gap: 1.5, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 180 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1 }}>{version?.costing_no || 'Costing'}</Typography>
            <Typography variant="caption" color="text.secondary">{version?.product_name} · V{version?.version_number} · {version?.status}</Typography>
          </Box>
          {!editable && version && <Chip size="small" color="default" label={`${version.status} — read-only`} />}
          {editable && <Button variant="outlined" onClick={openBom}>Import from BOM</Button>}
          {editable && <Button variant="contained" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save costing'}</Button>}
          <Menu anchorEl={bomAnchor} open={Boolean(bomAnchor)} onClose={() => setBomAnchor(null)}>
            {boms.length === 0
              ? <MenuItem disabled>No BOMs found</MenuItem>
              : boms.map((b) => (
                <MenuItem key={b.pk_id} onClick={() => importBom(b)}>{b.productDescription || b.productCode || `BOM ${b.pk_id}`}</MenuItem>
              ))}
          </Menu>
          <IconButton onClick={onClose} edge="end"><CloseIcon /></IconButton>
        </Toolbar>
      </AppBar>

      <Box sx={{ p: { xs: 1.5, md: 3 }, bgcolor: 'background.default', minHeight: '100%' }}>
        {loading ? (
          <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress /></Stack>
        ) : (
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 320px' } }}>
            <Box>
              {!editable && <Alert severity="info" sx={{ mb: 2 }}>This costing is {version.status}. Move it back to draft to edit (create a new version to revise a released costing).</Alert>}
              {COST_SECTIONS.map((section) => {
                const secLines = lines.map((l, i) => ({ l, i })).filter((x) => x.l.section === section);
                return (
                  <Box key={section} sx={{ mb: 2, border: `1px solid ${theme.palette.divider}`, borderRadius: 2, overflow: 'hidden' }}>
                    <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1, bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }}>{SECTION_LABEL[section]}</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, mr: 1 }}>{inr(summary[`${section}_cost`])}</Typography>
                      {editable && <Button size="small" startIcon={<AddIcon />} onClick={() => addLine(section)}>Add</Button>}
                    </Stack>
                    {secLines.length > 0 && (
                      <Table size="small">
                        <TableHead><TableRow>
                          {['Item', section === 'material' ? 'Material rate' : '', 'Qty', 'Rate', 'Amount', ''].filter(Boolean).map((h) => <TableCell key={h} sx={{ fontSize: '0.7rem', fontWeight: 700 }}>{h}</TableCell>)}
                        </TableRow></TableHead>
                        <TableBody>
                          {secLines.map(({ l, i }) => {
                            const amt = l.is_percentage ? null : (l.qty !== '' && l.rate !== '' ? Number(l.qty) * Number(l.rate) : Number(l.amount) || 0);
                            return (
                              <TableRow key={i}>
                                <TableCell><TextField size="small" variant="standard" placeholder="Item" value={l.category} disabled={!editable} onChange={(e) => updLine(i, { category: e.target.value })} /></TableCell>
                                {section === 'material' && (
                                  <TableCell>
                                    <TextField select size="small" variant="standard" value={l.material_code || ''} disabled={!editable} onChange={(e) => pickRate(i, e.target.value)} sx={{ minWidth: 120 }}>
                                      <MenuItem value="">—</MenuItem>
                                      {rates.map((r) => <MenuItem key={r.material_code} value={r.material_code}>{r.material_name} ({inr(r.rate)}/{r.uom})</MenuItem>)}
                                    </TextField>
                                  </TableCell>
                                )}
                                <TableCell><TextField size="small" variant="standard" type="number" value={l.qty} disabled={!editable} onChange={(e) => updLine(i, { qty: e.target.value })} sx={{ width: 70 }} /></TableCell>
                                <TableCell><TextField size="small" variant="standard" type="number" value={l.rate} disabled={!editable} onChange={(e) => updLine(i, { rate: e.target.value, material_code: '' })} sx={{ width: 80 }} /></TableCell>
                                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                  {l.qty !== '' && l.rate !== ''
                                    ? inr(amt)
                                    : <TextField size="small" variant="standard" type="number" placeholder="amt" value={l.amount} disabled={!editable} onChange={(e) => updLine(i, { amount: e.target.value })} sx={{ width: 80 }} />}
                                </TableCell>
                                <TableCell>{editable && <IconButton size="small" color="error" onClick={() => delLine(i)}><DeleteOutline fontSize="small" /></IconButton>}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </Box>
                );
              })}
            </Box>

            {/* Live margin panel */}
            <Box sx={{ position: { lg: 'sticky' }, top: 88, alignSelf: 'start' }}>
              <Box sx={{ p: 2, border: `1px solid ${theme.palette.divider}`, borderRadius: 2, bgcolor: 'background.paper' }}>
                <Typography variant="overline" color="text.secondary">Live margin</Typography>
                {COST_SECTIONS.map((s) => (
                  <Stack key={s} direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">{SECTION_LABEL[s]}</Typography>
                    <Typography variant="body2">{inr(summary[`${s}_cost`])}</Typography>
                  </Stack>
                ))}
                <Divider sx={{ my: 1 }} />
                <Stack direction="row" justifyContent="space-between"><Typography variant="body2" fontWeight={700}>Total cost</Typography><Typography variant="body2" fontWeight={700}>{inr(summary.total_cost)}</Typography></Stack>
                <TextField label="Target margin %" size="small" type="number" value={margin} disabled={!editable} onChange={(e) => setMargin(Number(e.target.value) || 0)} fullWidth sx={{ my: 1.5 }} />
                <Stack direction="row" justifyContent="space-between"><Typography variant="subtitle1" fontWeight={800}>Sell price</Typography><Typography variant="subtitle1" fontWeight={800} color="primary.main">{inr(summary.net_selling_price)}</Typography></Stack>
                <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}><Typography variant="caption" color="text.secondary">Contribution</Typography><Typography variant="caption">{summary.contribution_pct}%</Typography></Stack>
                <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Gross</Typography><Typography variant="caption">{summary.gross_margin_pct}%</Typography></Stack>
                <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Net</Typography><Typography variant="caption">{summary.net_margin_pct}%</Typography></Stack>
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    </Dialog>
  );
}
