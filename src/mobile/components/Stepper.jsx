// Big +/- quantity stepper with a numeric field — gloved-operator friendly.
import React from 'react';
import { Box, IconButton, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';

export default function Stepper({ label, value = 0, onChange, min = 0, max, step = 1 }) {
  const n = Number(value) || 0;
  const set = (next) => {
    let v = next;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    onChange?.(v);
  };
  return (
    <Box sx={{ textAlign: 'center' }}>
      {label && (
        <Typography variant="caption" sx={{ textTransform: 'uppercase', fontWeight: 700, color: 'text.secondary' }}>
          {label}
        </Typography>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, mt: 0.5 }}>
        <IconButton
          onClick={() => set(n - step)}
          aria-label="Decrease"
          sx={{ width: 56, height: 56, border: '1px solid', borderColor: 'divider' }}
        >
          <RemoveIcon />
        </IconButton>
        <TextField
          value={value}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.]/g, '');
            onChange?.(raw === '' ? '' : Number(raw));
          }}
          inputProps={{ inputMode: 'decimal', style: { textAlign: 'center', fontSize: 30, fontWeight: 700, width: 90 } }}
          variant="standard"
        />
        <IconButton
          onClick={() => set(n + step)}
          aria-label="Increase"
          sx={{ width: 56, height: 56, border: '1px solid', borderColor: 'divider' }}
        >
          <AddIcon />
        </IconButton>
      </Box>
    </Box>
  );
}
