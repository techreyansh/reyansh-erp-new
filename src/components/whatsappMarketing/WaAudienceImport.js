// WhatsApp Marketing — audience import widget. Self-contained: manual add,
// paste import (preview → apply), CSV/Excel bulk import (via the generic
// bulk-import framework), a read-only contact list, and 4 visibly-disabled
// "coming in V1.5" CRM source chips. Built to be dropped into Task 8's
// StepAudience.js as-is; accepts an optional `notify(message, severity)`
// prop (falls back to its own Snackbar if the parent doesn't supply one, the
// same convention as EmailAudience / EmailCampaignsModule).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, Chip, CircularProgress, TextField,
  Table, TableHead, TableRow, TableCell, TableBody, Tooltip, Alert, Divider, Collapse,
  InputAdornment, Snackbar, TableContainer,
} from '@mui/material';
import {
  PersonAddAlt1Rounded, ContentPasteRounded, SearchRounded, RefreshRounded,
  PeopleAltRounded, GroupsRounded, Diversity3Rounded, ListAltRounded, InfoOutlined,
  CheckCircleOutline, ErrorOutline, ChangeCircleOutlined, AddCircleOutline,
} from '@mui/icons-material';
import BulkImportButton from '../common/BulkImport/BulkImportButton';
import waContactsService from '../../services/waContactsService';
import { getDataset } from '../../services/bulkImport/registry';
import { analyzeRows, summarize } from '../../services/bulkImport/runner';

const DATASET_KEY = 'wa_contacts';
const dataset = getDataset(DATASET_KEY);

const EMPTY_MANUAL = { contactName: '', whatsappNumber: '', company: '', email: '', ownerEmail: '', tags: '' };

const COMING_SOON_SOURCES = [
  { key: 'crm_customers', label: 'CRM Customers', icon: <PeopleAltRounded fontSize="small" /> },
  { key: 'crm_prospects', label: 'CRM Prospects', icon: <GroupsRounded fontSize="small" /> },
  { key: 'client_groups', label: 'Client Groups', icon: <Diversity3Rounded fontSize="small" /> },
  { key: 'custom_lists', label: 'Custom Lists', icon: <ListAltRounded fontSize="small" /> },
];

const splitTags = (v) => String(v || '').split(/[|,]/).map((t) => t.trim()).filter(Boolean);

/** Map a parsePasteRows() row (camelCase) to the dataset's raw-cell shape (snake_case column keys), so the same preview/validate machinery used for CSV/Excel can preview pasted text too. */
function pasteRowToRaw(r) {
  return {
    company: r.company || '',
    contact_name: r.contactName || '',
    whatsapp_number: r.whatsappNumber || '',
    email: r.email || '',
    owner_email: '',
    tags: Array.isArray(r.tags) ? r.tags.join(', ') : '',
  };
}

const statusChip = (s) => {
  if (s === 'update') return <Chip size="small" color="info" icon={<ChangeCircleOutlined />} label="Update" sx={{ height: 22 }} />;
  if (s === 'new') return <Chip size="small" color="success" icon={<AddCircleOutline />} label="New" sx={{ height: 22 }} />;
  return <Chip size="small" color="error" icon={<ErrorOutline />} label="Skip" sx={{ height: 22 }} />;
};

export default function WaAudienceImport({ notify, dense = false }) {
  const [snack, setSnack] = useState(null);
  const say = useCallback((message, severity = 'success') => {
    if (notify) notify(message, severity);
    else setSnack({ message, severity });
  }, [notify]);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await waContactsService.listContacts({ search })) || []);
    } catch (e) {
      say(e?.message || 'Failed to load contacts', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, say]);

  useEffect(() => { load(); }, [load]);

  // ── manual add ─────────────────────────────────────────────────────────
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState(EMPTY_MANUAL);
  const [manualBusy, setManualBusy] = useState(false);

  const addManual = async () => {
    if (!manual.contactName.trim()) { say('Contact name is required', 'warning'); return; }
    if (!manual.whatsappNumber.trim()) { say('WhatsApp number is required', 'warning'); return; }
    setManualBusy(true);
    try {
      await waContactsService.upsertContact({
        contactName: manual.contactName.trim(),
        whatsappNumber: manual.whatsappNumber.trim(),
        company: manual.company.trim() || null,
        email: manual.email.trim() || null,
        ownerEmail: manual.ownerEmail.trim() || null,
        tags: splitTags(manual.tags),
        source: 'manual',
      });
      say('Contact added');
      setManual(EMPTY_MANUAL);
      load();
    } catch (e) {
      say(e?.message || 'Could not add contact', 'error');
    } finally {
      setManualBusy(false);
    }
  };

  // ── paste import (preview → apply) ────────────────────────────────────
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pastePreview, setPastePreview] = useState(null); // analyzed rows
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteError, setPasteError] = useState(null);

  const pasteSummary = useMemo(() => (pastePreview ? summarize(pastePreview) : null), [pastePreview]);
  const pasteValidCount = useMemo(() => (pastePreview || []).filter((a) => a.valid).length, [pastePreview]);

  const previewPaste = async () => {
    setPasteError(null); setPastePreview(null);
    const parsed = waContactsService.parsePasteRows(pasteText);
    if (!parsed.length) { setPasteError('Paste at least one line — e.g. "Ravi Sharma, 9876543210, Acme Cables".'); return; }
    setPasteBusy(true);
    try {
      const analyzed = await analyzeRows(dataset, parsed.map(pasteRowToRaw));
      setPastePreview(analyzed);
    } catch (e) {
      setPasteError(e?.message || 'Could not preview the pasted text.');
    } finally {
      setPasteBusy(false);
    }
  };

  const applyPaste = async () => {
    setPasteBusy(true); setPasteError(null);
    try {
      const res = await waContactsService.pasteImport(pasteText);
      say(`Imported ${res.created} new, ${res.updated} updated${res.errors?.length ? `, ${res.errors.length} failed` : ''}.`, res.errors?.length ? 'warning' : 'success');
      setPasteText(''); setPastePreview(null); setPasteOpen(false);
      load();
    } catch (e) {
      setPasteError(e?.message || 'Import failed.');
    } finally {
      setPasteBusy(false);
    }
  };

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2.5, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
          <TextField
            size="small" placeholder="Search name, number, company…" value={search}
            onChange={(e) => setSearch(e.target.value)} sx={{ flex: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> }}
          />
          <Button size="small" startIcon={<RefreshRounded />} onClick={load} sx={{ textTransform: 'none' }}>Refresh</Button>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap alignItems="center">
          <BulkImportButton
            dataset={DATASET_KEY}
            label="Import CSV / Excel"
            variant="contained"
            onApplied={(res) => {
              say(`Imported ${res.created} new, ${res.updated} updated${res.errors?.length ? `, ${res.errors.length} failed` : ''}.`, res.errors?.length ? 'warning' : 'success');
              load();
            }}
          />
          <Button
            variant="outlined" size="small" startIcon={<ContentPasteRounded />}
            onClick={() => { setPasteOpen((v) => !v); setManualOpen(false); }}
            sx={{ textTransform: 'none' }}
          >
            Paste import
          </Button>
          <Button
            variant="outlined" size="small" startIcon={<PersonAddAlt1Rounded />}
            onClick={() => { setManualOpen((v) => !v); setPasteOpen(false); }}
            sx={{ textTransform: 'none' }}
          >
            Add contact
          </Button>
        </Stack>

        {/* CRM / list sources — visibly present, disabled until V1.5 */}
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap alignItems="center">
          <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Add from:</Typography>
          {COMING_SOON_SOURCES.map((s) => (
            <Tooltip key={s.key} title="Coming in V1.5 — CRM integration" arrow>
              <span>
                <Chip icon={s.icon} label={s.label} disabled variant="outlined" size="small" />
              </span>
            </Tooltip>
          ))}
        </Stack>

        {/* Manual add mini-form */}
        <Collapse in={manualOpen} unmountOnExit>
          <Divider sx={{ my: 1.5 }} />
          <Stack spacing={1.5}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField label="Name" size="small" fullWidth value={manual.contactName} onChange={(e) => setManual((m) => ({ ...m, contactName: e.target.value }))} autoFocus />
              <TextField label="WhatsApp number" size="small" fullWidth value={manual.whatsappNumber} onChange={(e) => setManual((m) => ({ ...m, whatsappNumber: e.target.value }))} placeholder="9876543210" />
              <TextField label="Company" size="small" fullWidth value={manual.company} onChange={(e) => setManual((m) => ({ ...m, company: e.target.value }))} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField label="Email" size="small" fullWidth value={manual.email} onChange={(e) => setManual((m) => ({ ...m, email: e.target.value }))} />
              <TextField label="Owner email" size="small" fullWidth value={manual.ownerEmail} onChange={(e) => setManual((m) => ({ ...m, ownerEmail: e.target.value }))} />
              <TextField label="Tags" size="small" fullWidth value={manual.tags} onChange={(e) => setManual((m) => ({ ...m, tags: e.target.value }))} placeholder="vip, geyser" />
            </Stack>
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button size="small" onClick={() => { setManualOpen(false); setManual(EMPTY_MANUAL); }} sx={{ textTransform: 'none' }}>Cancel</Button>
              <Button
                size="small" variant="contained" disabled={manualBusy} onClick={addManual}
                startIcon={manualBusy ? <CircularProgress size={14} /> : <CheckCircleOutline />}
                sx={{ textTransform: 'none' }}
              >
                Save contact
              </Button>
            </Stack>
          </Stack>
        </Collapse>

        {/* Paste import mini-panel */}
        <Collapse in={pasteOpen} unmountOnExit>
          <Divider sx={{ my: 1.5 }} />
          <Stack spacing={1.5}>
            <Typography variant="caption" color="text.secondary">
              One contact per line — <b>name, number, company, email, tags</b> (tab or comma separated; tags <code>|</code>-separated). A bare number per line also works.
            </Typography>
            <TextField
              multiline minRows={4} fullWidth size="small" placeholder={'Ravi Sharma, 9876543210, Acme Cables, ravi@acme.com, vip|geyser'}
              value={pasteText} onChange={(e) => { setPasteText(e.target.value); setPastePreview(null); }}
            />
            {pasteError && <Alert severity="error" onClose={() => setPasteError(null)}>{pasteError}</Alert>}

            {!pastePreview ? (
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Button size="small" onClick={() => { setPasteOpen(false); setPasteText(''); setPastePreview(null); setPasteError(null); }} sx={{ textTransform: 'none' }}>Cancel</Button>
                <Button
                  size="small" variant="outlined" disabled={pasteBusy || !pasteText.trim()} onClick={previewPaste}
                  startIcon={pasteBusy ? <CircularProgress size={14} /> : <InfoOutlined />}
                  sx={{ textTransform: 'none' }}
                >
                  Preview
                </Button>
              </Stack>
            ) : (
              <>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`${pasteSummary.total} rows`} />
                  <Chip size="small" color="success" label={`${pasteSummary.new} new`} />
                  <Chip size="small" color="info" label={`${pasteSummary.update} update`} />
                  {pasteSummary.invalid > 0 && <Chip size="small" color="error" label={`${pasteSummary.invalid} skipped`} />}
                </Stack>
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 220 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700, width: 80 }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>WhatsApp number</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Issues</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pastePreview.map((a) => (
                        <TableRow key={a.i}>
                          <TableCell>{statusChip(a.status)}</TableCell>
                          <TableCell>{a.rec.contact_name || '—'}</TableCell>
                          <TableCell>{a.rec.whatsapp_number || '—'}</TableCell>
                          <TableCell>
                            <Typography variant="caption" color={a.errors.length ? 'error' : 'text.secondary'}>
                              {[...a.errors, ...a.warnings].join('; ') || (a.status === 'update' ? 'matches existing' : '')}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button size="small" onClick={() => setPastePreview(null)} sx={{ textTransform: 'none' }}>Back</Button>
                  <Button
                    size="small" variant="contained" disabled={pasteBusy || !pasteValidCount} onClick={applyPaste}
                    startIcon={pasteBusy ? <CircularProgress size={14} /> : <CheckCircleOutline />}
                    sx={{ textTransform: 'none' }}
                  >
                    Import {pasteValidCount ? `(${pasteValidCount})` : ''}
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        </Collapse>
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
        <Stack direction="row" justifyContent="space-between" sx={{ px: 2, py: 1.25 }}>
          <Typography variant="overline" sx={{ fontWeight: 800, color: 'text.secondary' }}>{rows.length} contacts</Typography>
        </Stack>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        ) : rows.length === 0 ? (
          <Box sx={{ p: 5, textAlign: 'center' }}>
            <Typography color="text.secondary">No contacts yet. Import a CSV, paste a list, or add one.</Typography>
          </Box>
        ) : (
          <Box sx={{ overflowX: 'auto', maxHeight: dense ? 320 : 480 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {['Name', 'WhatsApp number', 'Company', 'Tags', 'Source', 'Owner'].map((h) => (
                    <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id} hover>
                    <TableCell>{c.contact_name}</TableCell>
                    <TableCell>{c.whatsapp_number}</TableCell>
                    <TableCell>{c.company || '—'}</TableCell>
                    <TableCell>
                      {(c.tags || []).length
                        ? c.tags.map((t) => <Chip key={t} size="small" label={t} sx={{ mr: 0.5, mb: 0.5, height: 20 }} />)
                        : '—'}
                    </TableCell>
                    <TableCell><Chip size="small" variant="outlined" label={c.source} /></TableCell>
                    <TableCell>{c.owner_email || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>

      {!notify && (
        <Snackbar
          open={!!snack}
          autoHideDuration={5000}
          onClose={() => setSnack(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        >
          {snack ? (
            <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)} sx={{ maxWidth: 480 }}>
              {snack.message}
            </Alert>
          ) : undefined}
        </Snackbar>
      )}
    </Box>
  );
}
