// Customer Portal admin (staff) — generate & manage per-customer portal links.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Card, Chip, Table, TableHead, TableRow, TableCell,
  TableBody, CircularProgress, Alert, Snackbar, Button, Switch, IconButton, Tooltip, Autocomplete, TextField,
} from '@mui/material';
import StorefrontOutlined from '@mui/icons-material/StorefrontOutlined';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import portalService from '../../services/portalService';
import { supabase } from '../../lib/supabaseClient';

export default function CustomerPortalAdmin() {
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [picked, setPicked] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [access, cl] = await Promise.all([
        portalService.listAccess(),
        supabase.from('clients2').select('"ClientCode","ClientName"').then((r) => r.data || []),
      ]);
      setRows(access);
      setClients(cl.filter((c) => c.ClientCode).map((c) => ({ code: c.ClientCode, name: c.ClientName || c.ClientCode })));
    } catch (e) { setSnack({ message: e.message || 'Failed', severity: 'error' }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await portalService.createAccess(picked.code, picked.name);
      setSnack({ message: `Portal link ready for ${picked.name}.`, severity: 'success' });
      setPicked(null); await load();
    } catch (e) { setSnack({ message: e.message, severity: 'error' }); }
    finally { setBusy(false); }
  };

  const copy = async (token) => {
    const url = portalService.portalUrl(token);
    try { await navigator.clipboard.writeText(url); setSnack({ message: 'Portal link copied.', severity: 'success' }); }
    catch { setSnack({ message: url, severity: 'info' }); }
  };

  const toggle = async (r) => {
    try { await portalService.setActive(r.id, !r.is_active); await load(); }
    catch (e) { setSnack({ message: e.message, severity: 'error' }); }
  };

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <StorefrontOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Customer Portal</Typography>
        <Chip size="small" variant="outlined" label="self-service links" color="primary" />
      </Stack>
      <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
        Generate a secure link per customer. Share it with them — they see their own orders, dispatch status, invoices &amp; balance (read-only, no login). Deactivate any time.
      </Alert>

      <Card variant="outlined" sx={{ borderRadius: 2, p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
          <Autocomplete
            sx={{ flexGrow: 1 }} size="small" options={clients} value={picked}
            getOptionLabel={(o) => `${o.name} (${o.code})`} isOptionEqualToValue={(a, b) => a.code === b.code}
            onChange={(e, v) => setPicked(v)}
            renderInput={(params) => <TextField {...params} label="Select a customer" placeholder="Search client…" />}
          />
          <Button variant="contained" onClick={create} disabled={!picked || busy} sx={{ borderRadius: 2, flexShrink: 0 }}>
            {busy ? 'Creating…' : 'Generate link'}
          </Button>
        </Stack>
      </Card>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        {loading ? <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack> : rows.length === 0 ? (
          <Box sx={{ p: 3 }}><Typography variant="body2" color="text.secondary">No portal links yet. Generate one above.</Typography></Box>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead><TableRow>{['Customer', 'Code', 'Active', 'Last viewed', 'Link'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>{rows.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{r.company_name || '—'}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{r.customer_code}</TableCell>
                  <TableCell><Switch size="small" checked={r.is_active} onChange={() => toggle(r)} /></TableCell>
                  <TableCell><Typography variant="caption" color="text.secondary">{r.last_accessed_at ? new Date(r.last_accessed_at).toLocaleString('en-IN') : 'never'}</Typography></TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="Copy link"><IconButton size="small" onClick={() => copy(r.token)}><ContentCopyRounded fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Open portal"><IconButton size="small" component="a" href={portalService.portalUrl(r.token)} target="_blank" rel="noopener noreferrer"><OpenInNewRounded fontSize="small" /></IconButton></Tooltip>
                    </Stack>
                  </TableCell>
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
