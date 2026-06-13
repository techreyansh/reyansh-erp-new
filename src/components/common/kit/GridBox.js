import React from 'react';
import { Box } from '@mui/material';

/** Responsive auto-fill grid; each child sizes to >= `min` px. */
function GridBox({ min = 260, children, sx }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', sm: `repeat(auto-fill, minmax(${min}px, 1fr))` },
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export default GridBox;
