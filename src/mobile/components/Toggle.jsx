// Large labelled on/off toggle row — easy to hit one-handed.
import React from 'react';
import { Box, Switch, Typography } from '@mui/material';

export default function Toggle({ label, checked = false, onChange, helper }) {
  return (
    <Box
      onClick={() => onChange?.(!checked)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 56,
        px: 2,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <Box>
        <Typography sx={{ fontWeight: 600 }}>{label}</Typography>
        {helper && <Typography variant="caption" color="text.secondary">{helper}</Typography>}
      </Box>
      <Switch checked={checked} onChange={(e) => onChange?.(e.target.checked)} onClick={(e) => e.stopPropagation()} />
    </Box>
  );
}
