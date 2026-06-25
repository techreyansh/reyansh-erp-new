// Multi-contact panel for a CRM account (CRM 360 P2). Lists unlimited contacts
// as cards with view/edit/delete/mark-primary + call/email/WhatsApp/LinkedIn
// quick actions. Reusable in Client360 and the prospect drawer. All CRUD via
// crmPipelineService (crm_account_contacts).
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Stack, Typography, Button, Card, CardContent, Chip, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  FormControlLabel, Switch, CircularProgress, Snackbar, Alert,
} from '@mui/material';
import {
  AddRounded, EditRounded, DeleteOutlineRounded, StarRounded, StarBorderRounded,
  PhoneRounded, EmailRounded, WhatsApp, LinkedIn,
} from '@mui/icons-material';
import crmPipelineService from '../../services/crmPipelineService';

const COMM = ['Phone', 'Email', 'WhatsApp'];
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const blankContact = () => ({ full_name: '', designation: '', department: '', phone: '', alt_phone: '', email: '', linkedin: '', birthday: '', preferred_comm: '', notes: '', is_decision_maker: false, is_primary: false });

export default function CompanyContacts({ accountId }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null); // null | contact-draft
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try { setContacts(await crmPipelineService.listContacts(accountId) || []); }
    catch { setContacts([]); }
    setLoading(false);
  }, [accountId]);
  useEffect(() => { load(); }, [load]);

  const setF = (k) => (e) => setEdit((d) => ({ ...d, [k]: e.target.value }));

  const save = async () => {
    if (!edit.full_name.trim()) { setSnack({ severity: 'error', message: 'Name is required.' }); return; }
    setBusy(true);
    try {
      const payload = { ...edit, birthday: edit.birthday || null };
      if (edit.id) await crmPipelineService.updateContact(edit.id, payload);
      else await crmPipelineService.addContact(accountId, payload);
      setEdit(null); await load();
      setSnack({ severity: 'success', message: 'Contact saved.' });
    } catch (e) { setSnack({ severity: 'error', message: e?.message || 'Save failed.' }); }
    finally { setBusy(false); }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete contact ${c.full_name || ''}?`)) return;
    try { await crmPipelineService.deleteContact(c.id); await load(); }
    catch (e) { setSnack({ severity: 'error', message: e?.message || 'Delete failed.' }); }
  };

  const markPrimary = async (c) => {
    try {
      const cur = contacts.find((x) => x.is_primary && x.id !== c.id);
      if (cur) await crmPipelineService.updateContact(cur.id, { is_primary: false });
      await crmPipelineService.updateContact(c.id, { is_primary: true });
      await load();
    } catch (e) { setSnack({ severity: 'error', message: e?.message || 'Could not set primary.' }); }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={22} /></Box>;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Contacts ({contacts.length})</Typography>
        <Button size="small" variant="outlined" startIcon={<AddRounded />} onClick={() => setEdit(blankContact())}>Add contact person</Button>
      </Stack>

      {contacts.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No contacts yet. Add the first one — keep every decision-maker here, not in your phone.</Typography>
      ) : (
        <Stack spacing={1}>
          {contacts.map((c) => (
            <Card key={c.id} variant="outlined">
              <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                      <Typography sx={{ fontWeight: 700 }} noWrap>{c.full_name || '—'}</Typography>
                      {c.is_primary && <Chip size="small" color="primary" label="Primary" sx={{ height: 18 }} />}
                      {c.is_decision_maker && <Chip size="small" color="success" variant="outlined" label="Decision maker" sx={{ height: 18 }} />}
                    </Stack>
                    {(c.designation || c.department) && (
                      <Typography variant="caption" color="text.secondary">{[c.designation, c.department].filter(Boolean).join(' · ')}</Typography>
                    )}
                    <Stack direction="row" spacing={1.5} sx={{ mt: 0.25 }} flexWrap="wrap">
                      {c.phone && <Typography variant="caption" color="text.secondary">{c.phone}</Typography>}
                      {c.email && <Typography variant="caption" color="text.secondary" noWrap>{c.email}</Typography>}
                    </Stack>
                  </Box>
                  <Stack direction="row" spacing={0.25} flexShrink={0}>
                    {c.phone && <Tooltip title="Call"><IconButton size="small" component="a" href={`tel:${c.phone}`}><PhoneRounded fontSize="small" /></IconButton></Tooltip>}
                    {c.email && <Tooltip title="Email"><IconButton size="small" component="a" href={`mailto:${c.email}`}><EmailRounded fontSize="small" /></IconButton></Tooltip>}
                    {c.phone && <Tooltip title="WhatsApp"><IconButton size="small" component="a" href={`https://wa.me/${digits(c.phone)}`} target="_blank" rel="noreferrer"><WhatsApp fontSize="small" sx={{ color: '#25D366' }} /></IconButton></Tooltip>}
                    {c.linkedin && <Tooltip title="LinkedIn"><IconButton size="small" component="a" href={c.linkedin} target="_blank" rel="noreferrer"><LinkedIn fontSize="small" sx={{ color: '#0A66C2' }} /></IconButton></Tooltip>}
                    <Tooltip title={c.is_primary ? 'Primary' : 'Mark primary'}><span><IconButton size="small" onClick={() => markPrimary(c)} disabled={c.is_primary}>{c.is_primary ? <StarRounded fontSize="small" color="primary" /> : <StarBorderRounded fontSize="small" />}</IconButton></span></Tooltip>
                    <Tooltip title="Edit"><IconButton size="small" onClick={() => setEdit({ ...blankContact(), ...c, birthday: c.birthday || '' })}><EditRounded fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton size="small" onClick={() => remove(c)}><DeleteOutlineRounded fontSize="small" /></IconButton></Tooltip>
                  </Stack>
                </Stack>
                {c.notes && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}>{c.notes}</Typography>}
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <Dialog open={!!edit} onClose={() => !busy && setEdit(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{edit?.id ? 'Edit contact' : 'Add contact person'}</DialogTitle>
        <DialogContent dividers>
          {edit && (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <TextField label="Name" value={edit.full_name} onChange={setF('full_name')} required fullWidth />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Designation" value={edit.designation} onChange={setF('designation')} fullWidth />
                <TextField label="Department" value={edit.department} onChange={setF('department')} fullWidth />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Mobile" value={edit.phone} onChange={setF('phone')} fullWidth />
                <TextField label="Alternate number" value={edit.alt_phone} onChange={setF('alt_phone')} fullWidth />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Email" type="email" value={edit.email} onChange={setF('email')} fullWidth />
                <TextField label="LinkedIn" value={edit.linkedin} onChange={setF('linkedin')} fullWidth />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Birthday" type="date" InputLabelProps={{ shrink: true }} value={edit.birthday} onChange={setF('birthday')} fullWidth />
                <TextField select label="Preferred contact" value={edit.preferred_comm} onChange={setF('preferred_comm')} fullWidth>
                  <MenuItem value="">—</MenuItem>
                  {COMM.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                </TextField>
              </Stack>
              <TextField label="Notes" value={edit.notes} onChange={setF('notes')} fullWidth multiline minRows={2} />
              <Stack direction="row" spacing={2}>
                <FormControlLabel control={<Switch checked={!!edit.is_decision_maker} onChange={(e) => setEdit((d) => ({ ...d, is_decision_maker: e.target.checked }))} />} label="Decision maker" />
                <FormControlLabel control={<Switch checked={!!edit.is_primary} onChange={(e) => setEdit((d) => ({ ...d, is_primary: e.target.checked }))} />} label="Primary contact" />
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEdit(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)}>{snack.message}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
