// Audience manager: contacts table + CSV/XLSX import + pull-from-CRM + manual add.
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box, Paper, Stack, Typography, Button, Chip, IconButton, CircularProgress, TextField,
  Table, TableHead, TableRow, TableCell, TableBody, MenuItem, Tooltip, Dialog, DialogTitle,
  DialogContent, DialogActions, InputAdornment,
} from '@mui/material';
import {
  UploadFileRounded, GroupAddRounded, PersonAddAlt1Rounded, SearchRounded, RefreshRounded,
  BlockRounded, DeleteOutline,
} from '@mui/icons-material';
import * as XLSX from 'xlsx';
import campaignsService from '../../../services/campaignsService';
import { mapRow } from './contactImport';

const STATUS_COLOR = { active: 'success', unsubscribed: 'default', bounced: 'error', complained: 'warning' };

export default function EmailAudience({ notify }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ email: '', first_name: '', last_name: '', company: '', title: '', phone: '' });
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await campaignsService.listContacts({ search, status: statusFilter || null }));
    } catch (e) {
      notify(e.message || 'Failed to load contacts', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, notify]);

  useEffect(() => { load(); }, [load]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const mapped = raw.map(mapRow).filter((r) => r.email && r.email.includes('@'));
      if (!mapped.length) { notify('No rows with a valid email column found', 'warning'); return; }
      const res = await campaignsService.bulkImport(mapped, { name: file.name, filename: file.name });
      notify(`Imported ${res.imported}, skipped ${res.skipped}`, res.imported ? 'success' : 'warning');
      load();
    } catch (err) {
      notify(err.message || 'Import failed', 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const pullCrm = async () => {
    setBusy(true);
    try {
      const res = await campaignsService.pullFromCrm();
      notify(`Pulled ${res.imported} contacts from CRM leads`);
      load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const addManual = async () => {
    if (!manual.email.includes('@')) { notify('Enter a valid email', 'warning'); return; }
    try {
      await campaignsService.upsertContact({ ...manual, source: 'manual' });
      notify('Contact added');
      setManualOpen(false);
      setManual({ email: '', first_name: '', last_name: '', company: '', title: '', phone: '' });
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const unsubscribe = async (c) => {
    try { await campaignsService.setContactStatus(c.id, 'unsubscribed'); load(); }
    catch (e) { notify(e.message, 'error'); }
  };
  const remove = async (c) => {
    if (!window.confirm(`Delete ${c.email}?`)) return;
    try { await campaignsService.deleteContact(c.id); load(); }
    catch (e) { notify(e.message, 'error'); }
  };

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2.5, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
          <TextField
            size="small" placeholder="Search email, name, company…" value={search}
            onChange={(e) => setSearch(e.target.value)} sx={{ flex: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> }}
          />
          <TextField select size="small" label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ width: 160 }}>
            <MenuItem value="">All</MenuItem>
            {['active', 'unsubscribed', 'bounced', 'complained'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </TextField>
          <Button size="small" startIcon={<RefreshRounded />} onClick={load} sx={{ textTransform: 'none' }}>Refresh</Button>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
          <Button variant="contained" size="small" startIcon={<UploadFileRounded />} disabled={busy} onClick={() => fileRef.current?.click()} sx={{ textTransform: 'none' }}>
            Import CSV / Excel
          </Button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={onFile} />
          <Button variant="outlined" size="small" startIcon={<GroupAddRounded />} disabled={busy} onClick={pullCrm} sx={{ textTransform: 'none' }}>
            Pull from CRM leads
          </Button>
          <Button variant="outlined" size="small" startIcon={<PersonAddAlt1Rounded />} onClick={() => setManualOpen(true)} sx={{ textTransform: 'none' }}>
            Add contact
          </Button>
          {busy && <CircularProgress size={20} sx={{ alignSelf: 'center' }} />}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
        <Stack direction="row" justifyContent="space-between" sx={{ px: 2, py: 1.25 }}>
          <Typography variant="overline" sx={{ fontWeight: 800, color: 'text.secondary' }}>{rows.length} contacts</Typography>
        </Stack>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        ) : rows.length === 0 ? (
          <Box sx={{ p: 5, textAlign: 'center' }}>
            <Typography color="text.secondary">No contacts yet. Import a CSV, pull from CRM, or add one.</Typography>
          </Box>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {['Email', 'Name', 'Company', 'Source', 'Status', ''].map((h) => (
                    <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id} hover>
                    <TableCell>{c.email}</TableCell>
                    <TableCell>{c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</TableCell>
                    <TableCell>{c.company || '—'}</TableCell>
                    <TableCell><Chip size="small" variant="outlined" label={c.source} /></TableCell>
                    <TableCell><Chip size="small" label={c.status} color={STATUS_COLOR[c.status] || 'default'} /></TableCell>
                    <TableCell align="right">
                      {c.status === 'active' && (
                        <Tooltip title="Unsubscribe"><IconButton size="small" onClick={() => unsubscribe(c)}><BlockRounded fontSize="small" /></IconButton></Tooltip>
                      )}
                      <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => remove(c)}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>

      <Dialog open={manualOpen} onClose={() => setManualOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Add contact</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="Email" value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} fullWidth autoFocus />
            <Stack direction="row" spacing={2}>
              <TextField label="First name" value={manual.first_name} onChange={(e) => setManual({ ...manual, first_name: e.target.value })} fullWidth />
              <TextField label="Last name" value={manual.last_name} onChange={(e) => setManual({ ...manual, last_name: e.target.value })} fullWidth />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField label="Company" value={manual.company} onChange={(e) => setManual({ ...manual, company: e.target.value })} fullWidth />
              <TextField label="Title" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} fullWidth />
            </Stack>
            <TextField label="Phone" value={manual.phone} onChange={(e) => setManual({ ...manual, phone: e.target.value })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManualOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" onClick={addManual} sx={{ textTransform: 'none' }}>Add</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
