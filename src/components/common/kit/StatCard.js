import React from 'react';
import { Box, Card, CardContent, Skeleton, Stack, Typography, alpha } from '@mui/material';

/**
 * Compact KPI card. Optional `onClick` makes it a drill-in affordance.
 *
 * @param {string} label   Uppercase caption (e.g. "Outstanding")
 * @param {*}      value   Big value (already formatted)
 * @param {string} [sub]   Small secondary line
 * @param {React.ElementType} icon  MUI icon component
 * @param {string} accent  Hex accent color
 * @param {boolean} [loading]
 * @param {function} [onClick]
 */
function StatCard({ label, value, sub, icon: Icon, accent = '#45ADE6', loading, onClick }) {
  return (
    <Card
      variant="outlined"
      onClick={onClick}
      sx={{
        borderRadius: 2.5,
        height: '100%',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        '&:hover': onClick
          ? { borderColor: alpha(accent, 0.5), boxShadow: `0 8px 20px -12px ${alpha(accent, 0.6)}` }
          : undefined,
      }}
    >
      <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}
            >
              {label}
            </Typography>
            {loading ? (
              <Skeleton variant="text" width={90} height={40} />
            ) : (
              <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
                {value}
              </Typography>
            )}
            {sub && !loading && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                {sub}
              </Typography>
            )}
          </Box>
          {Icon && (
            <Box sx={{ p: 1, borderRadius: 2, bgcolor: alpha(accent, 0.12), color: accent, display: 'flex' }}>
              <Icon />
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default StatCard;
