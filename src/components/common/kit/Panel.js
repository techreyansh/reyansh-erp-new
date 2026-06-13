import React from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';

/**
 * Titled content panel with an optional subtitle and right-aligned action.
 * Used to wrap charts, lists, and any framed dashboard content.
 */
function Panel({ title, subtitle, children, height = 300, action, sx }) {
  return (
    <Paper
      variant="outlined"
      sx={{ borderRadius: 2.5, p: { xs: 1.5, sm: 2 }, height: '100%', display: 'flex', flexDirection: 'column', ...sx }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{title}</Typography>
          {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
        </Box>
        {action}
      </Stack>
      <Box sx={{ flex: 1, height }}>{children}</Box>
    </Paper>
  );
}

export default Panel;
