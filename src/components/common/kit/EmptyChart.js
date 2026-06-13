import React from 'react';
import { Stack, Typography } from '@mui/material';

/** Centered placeholder for an empty chart/panel body. */
function EmptyChart({ label = 'No data yet' }) {
  return (
    <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', color: 'text.disabled' }}>
      <Typography variant="body2">{label}</Typography>
    </Stack>
  );
}

export default EmptyChart;
