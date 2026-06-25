// Sticky bottom submit bar — the primary CTA for every capture screen.
import React from 'react';
import { Box, Button, CircularProgress } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

export default function SubmitBar({
  label = 'Submit',
  onSubmit,
  disabled = false,
  busy = false,
  helper,
}) {
  return (
    <Box
      sx={{
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        px: 2,
        py: 1.5,
        bgcolor: 'background.paper',
        borderTop: '1px solid',
        borderColor: 'divider',
        zIndex: 5,
      }}
    >
      {helper && (
        <Box sx={{ textAlign: 'center', mb: 1, fontSize: 13, color: 'text.secondary' }}>{helper}</Box>
      )}
      <Button
        onClick={onSubmit}
        disabled={disabled || busy}
        variant="contained"
        fullWidth
        startIcon={busy ? <CircularProgress size={20} color="inherit" /> : <CheckCircleIcon />}
        sx={{ height: 56, borderRadius: 2, fontSize: 18, fontWeight: 700 }}
      >
        {busy ? 'Saving…' : label}
      </Button>
    </Box>
  );
}
