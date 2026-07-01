// Campaign Wizard — Step 1: Basics (name, description, owner, category).
// Owner picker mirrors the "employees Autocomplete keyed by email" pattern
// used across the ERP (see TaskScheduler.js / rbacService.listEmployees) —
// owner_email is the source of truth on wa_campaigns, same as CRM's
// crm_pipeline.owner_email convention.
import React, { useEffect, useState } from 'react';
import { Box, Stack, TextField, Typography, Chip, Autocomplete, CircularProgress } from '@mui/material';
import { listEmployees } from '../../../services/rbacService';
import { usePermissions } from '../../../context/PermissionContext';
import { CAMPAIGN_CATEGORY_SUGGESTIONS } from '../wizardHelpers';

export default function StepBasics({ campaign, onChange }) {
  const { employee } = usePermissions() || {};
  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listEmployees()
      .then((rows) => { if (!cancelled) setEmployees(rows || []); })
      .catch(() => { if (!cancelled) setEmployees([]); })
      .finally(() => { if (!cancelled) setLoadingEmployees(false); });
    return () => { cancelled = true; };
  }, []);

  // Default the owner to the signed-in employee the first time this step
  // sees an unset owner_email (new campaign) — never overwrite an existing value.
  useEffect(() => {
    if (!campaign.owner_email && employee?.email) {
      onChange({ owner_email: employee.email });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.email]);

  const ownerOption = employees.find((e) => e.email === campaign.owner_email)
    || (campaign.owner_email ? { email: campaign.owner_email, full_name: campaign.owner_email } : null);

  return (
    <Box>
      <Typography variant="overline" color="text.secondary">Campaign basics</Typography>
      <Stack spacing={2.5} sx={{ mt: 1 }}>
        <TextField
          label="Campaign name" required fullWidth autoFocus
          value={campaign.name || ''}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Diwali Geyser Offer 2026"
        />
        <TextField
          label="Description" fullWidth multiline minRows={2}
          value={campaign.description || ''}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="What is this campaign for, and who is it targeting?"
        />
        <Autocomplete
          options={employees}
          loading={loadingEmployees}
          value={ownerOption}
          onChange={(_, v) => onChange({ owner_email: v?.email || null })}
          getOptionLabel={(o) => (o.full_name ? `${o.full_name} (${o.email})` : o.email || '')}
          isOptionEqualToValue={(a, b) => a.email === b.email}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Owner"
              placeholder="Search employees…"
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {loadingEmployees ? <CircularProgress size={16} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
        />
        <Box>
          <TextField
            label="Category" fullWidth
            value={campaign.category || ''}
            onChange={(e) => onChange({ category: e.target.value })}
            placeholder="Free text, or pick a suggestion below"
          />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
            {CAMPAIGN_CATEGORY_SUGGESTIONS.map((c) => (
              <Chip
                key={c}
                label={c}
                size="small"
                clickable
                color={campaign.category === c ? 'primary' : 'default'}
                variant={campaign.category === c ? 'filled' : 'outlined'}
                onClick={() => onChange({ category: c })}
              />
            ))}
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}
