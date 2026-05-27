import React from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';

/**
 * Inline or full-screen loading state. Use before auth/employee/permissions are ready.
 */
function LoadingScreen({ message = 'Loading…', minHeight = '40vh', fullScreen = false }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        minHeight: fullScreen ? '100vh' : minHeight,
        width: '100%',
      }}
      aria-live="polite"
      aria-busy="true"
      role="status"
    >
      <CircularProgress size={32} />
      {message ? (
        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>
      ) : null}
    </Box>
  );
}

export default LoadingScreen;
