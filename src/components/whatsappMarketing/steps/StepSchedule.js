// Campaign Wizard — Step 4: Schedule (start date/time, business-hours window,
// working-days-only). CARRY-FORWARD from Task 5's review: business_hours_end
// must be strictly greater than business_hours_start, or wa-scheduler's
// "next open hour" search runs forever without ever finding one to send in —
// validated here with a blocking inline error (see wizardHelpers.validateBusinessHours).
import React from 'react';
import { Box, Stack, TextField, MenuItem, Typography, FormControlLabel, Switch, Alert } from '@mui/material';
import { validateBusinessHours } from '../wizardHelpers';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function toLocalDatetimeInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function StepSchedule({ campaign, onChange }) {
  const businessHoursError = validateBusinessHours(campaign.business_hours_start, campaign.business_hours_end);

  return (
    <Box>
      <Typography variant="overline" color="text.secondary">Schedule</Typography>
      <Stack spacing={2.5} sx={{ mt: 1 }}>
        <TextField
          type="datetime-local"
          label="Campaign start"
          value={toLocalDatetimeInput(campaign.start_at)}
          onChange={(e) => onChange({ start_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
          InputLabelProps={{ shrink: true }}
          helperText="Leave blank to set it later, or set it now and use Schedule/Start Now on the Review step."
          sx={{ maxWidth: 320 }}
        />

        <Box>
          <Typography variant="body2" sx={{ mb: 1 }}>Business hours window (messages only send inside this window)</Typography>
          <Stack direction="row" spacing={2}>
            <TextField
              select label="Start hour" value={campaign.business_hours_start ?? 9}
              onChange={(e) => onChange({ business_hours_start: Number(e.target.value) })}
              sx={{ width: 160 }}
              error={!!businessHoursError}
            >
              {HOURS.map((h) => <MenuItem key={h} value={h}>{String(h).padStart(2, '0')}:00</MenuItem>)}
            </TextField>
            <TextField
              select label="End hour" value={campaign.business_hours_end ?? 18}
              onChange={(e) => onChange({ business_hours_end: Number(e.target.value) })}
              sx={{ width: 160 }}
              error={!!businessHoursError}
            >
              {HOURS.map((h) => <MenuItem key={h} value={h}>{String(h).padStart(2, '0')}:00</MenuItem>)}
            </TextField>
          </Stack>
          {businessHoursError && <Alert severity="error" sx={{ mt: 1.5 }}>{businessHoursError}</Alert>}
        </Box>

        <FormControlLabel
          control={(
            <Switch
              checked={campaign.working_days_only !== false}
              onChange={(e) => onChange({ working_days_only: e.target.checked })}
            />
          )}
          label="Working days only (skip weekends)"
        />
      </Stack>
    </Box>
  );
}
