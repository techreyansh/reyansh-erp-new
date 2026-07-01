// Campaign Wizard — Step 2: Audience.
//
// IMPORTANT distinction this component enforces: importing contacts (via
// WaAudienceImport, Task 7) writes rows into the global `wa_contacts` table —
// that's audience-wide, not campaign-specific. Enrolling is a SEPARATE action
// that links a subset of those contacts to THIS campaign via
// waCampaignsService.enrollContacts -> wa_enroll_contacts RPC -> wa_enrollments.
// A contact can exist in wa_contacts for years without ever being enrolled in
// any campaign, and the same contact can be enrolled in many campaigns.
//
// This step renders WaAudienceImport (import) above a checkbox contact-picker
// (enroll) so the two actions are visually and functionally distinct.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Checkbox, TextField, InputAdornment, Chip,
  CircularProgress, Table, TableHead, TableRow, TableCell, TableBody, Alert, Divider,
} from '@mui/material';
import { SearchRounded } from '@mui/icons-material';
import WaAudienceImport from '../WaAudienceImport';
import waContactsService from '../../../services/waContactsService';
import waCampaignsService from '../../../services/waCampaignsService';

export default function StepAudience({ campaignId, selectedContactIds, onSelectedChange, notify }) {
  const [contacts, setContacts] = useState([]);
  const [alreadyEnrolledIds, setAlreadyEnrolledIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [hydrated, setHydrated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [contactRows, enrollments] = await Promise.all([
        waContactsService.listContacts({ search }),
        campaignId ? waCampaignsService.listEnrollments(campaignId) : Promise.resolve([]),
      ]);
      setContacts(contactRows || []);
      const enrolledSet = new Set((enrollments || []).map((e) => e.contact_id));
      setAlreadyEnrolledIds(enrolledSet);
      // First load only: pre-check already-enrolled contacts so resuming a
      // draft campaign shows who's in it. Never re-run after that — the user
      // may deliberately deselect not-yet-enrolled contacts afterward.
      if (!hydrated) {
        onSelectedChange(new Set([...selectedContactIds, ...enrolledSet]));
        setHydrated(true);
      }
    } catch (e) {
      notify?.(e?.message || 'Failed to load audience', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, search, hydrated]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => {
    if (alreadyEnrolledIds.has(id)) return; // already enrolled — not reversible from this UI (no unenroll service method)
    const next = new Set(selectedContactIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectedChange(next);
  };

  const newlySelectedCount = useMemo(
    () => [...selectedContactIds].filter((id) => !alreadyEnrolledIds.has(id)).length,
    [selectedContactIds, alreadyEnrolledIds],
  );

  return (
    <Box>
      <Typography variant="overline" color="text.secondary">Import audience</Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
        Importing here adds contacts to your shared WhatsApp audience — it does not enroll them in this campaign yet.
      </Typography>
      <WaAudienceImport notify={notify} dense />

      <Divider sx={{ my: 3 }} />

      <Typography variant="overline" color="text.secondary">Enroll in this campaign</Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
        Check the contacts who should receive this campaign's messages. {alreadyEnrolledIds.size > 0
          ? `${alreadyEnrolledIds.size} already enrolled (locked — enrollment can't be undone from this screen).`
          : ''}
      </Typography>

      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, py: 1.25 }}>
          <TextField
            size="small" placeholder="Search contacts…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> }}
          />
          <Chip size="small" color="primary" label={`${newlySelectedCount} new to enroll`} />
        </Stack>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress /></Box>
        ) : contacts.length === 0 ? (
          <Alert severity="info" sx={{ m: 2 }}>No contacts yet — import some above.</Alert>
        ) : (
          <Box sx={{ overflowX: 'auto', maxHeight: 360 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>WhatsApp number</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Company</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {contacts.map((c) => {
                  const enrolled = alreadyEnrolledIds.has(c.id);
                  const checked = enrolled || selectedContactIds.has(c.id);
                  return (
                    <TableRow key={c.id} hover onClick={() => toggle(c.id)} sx={{ cursor: enrolled ? 'default' : 'pointer' }}>
                      <TableCell padding="checkbox">
                        <Checkbox checked={checked} disabled={enrolled} onClick={(e) => { e.stopPropagation(); toggle(c.id); }} />
                      </TableCell>
                      <TableCell>{c.contact_name}</TableCell>
                      <TableCell>{c.whatsapp_number}</TableCell>
                      <TableCell>{c.company || '—'}</TableCell>
                      <TableCell>
                        {enrolled
                          ? <Chip size="small" color="success" variant="outlined" label="Enrolled" />
                          : checked
                            ? <Chip size="small" color="primary" label="Will enroll" />
                            : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
