// Big touch number pad — gloved-operator friendly, one-handed at 360–430px.
import React from 'react';
import { Box, Button, Typography, IconButton } from '@mui/material';
import BackspaceIcon from '@mui/icons-material/Backspace';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

export default function NumPad({ value = '', onChange, label, allowDecimal = true }) {
  const press = (k) => {
    if (k === 'del') {
      onChange(String(value).slice(0, -1));
      return;
    }
    if (k === '.') {
      if (!allowDecimal || String(value).includes('.')) return;
      onChange((String(value) || '0') + '.');
      return;
    }
    onChange(String(value) + k);
  };

  return (
    <Box sx={{ width: '100%' }}>
      {label && (
        <Typography variant="caption" sx={{ textTransform: 'uppercase', fontWeight: 700, color: 'text.secondary' }}>
          {label}
        </Typography>
      )}
      <Box
        sx={{
          textAlign: 'center',
          fontSize: 40,
          fontWeight: 800,
          minHeight: 56,
          py: 1,
          letterSpacing: '0.04em',
          color: 'text.primary',
        }}
        aria-live="polite"
      >
        {value || '0'}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
        {KEYS.map((k) =>
          k === 'del' ? (
            <IconButton
              key={k}
              onClick={() => press(k)}
              aria-label="Delete"
              sx={{ height: 64, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}
            >
              <BackspaceIcon />
            </IconButton>
          ) : (
            <Button
              key={k}
              onClick={() => press(k)}
              disabled={k === '.' && !allowDecimal}
              sx={{ height: 64, fontSize: 26, fontWeight: 700, borderRadius: 2 }}
              variant="outlined"
            >
              {k}
            </Button>
          )
        )}
      </Box>
    </Box>
  );
}
