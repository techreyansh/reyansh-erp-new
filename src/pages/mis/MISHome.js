import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Chip, Paper, Stack, Typography, alpha, useTheme } from '@mui/material';
import { GroupsOutlined, ArrowForwardRounded } from '@mui/icons-material';

/**
 * MIS landing — extensible shell. One live workflow (EM Executive Meeting);
 * more MIS workflows will slot in here over time.
 */
const WORKFLOWS = [
  {
    key: 'em',
    label: 'EM Executive Meeting',
    description: 'Weekly accountability scorecards — roster, pillars, say/do and review-and-lock.',
    path: '/mis/executive-meeting',
    icon: <GroupsOutlined />,
    live: true,
  },
];

export default function MISHome() {
  const theme = useTheme();
  const navigate = useNavigate();

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', width: '100%' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
          MIS
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Management Information System — accountability workflows
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(280px, 1fr))' } }}>
        {WORKFLOWS.map((w) => (
          <Paper
            key={w.key}
            variant="outlined"
            onClick={() => navigate(w.path)}
            sx={{
              borderRadius: 2.5,
              p: 2,
              cursor: 'pointer',
              transition: 'border-color 0.18s ease, box-shadow 0.18s ease',
              '&:hover': {
                borderColor: alpha(theme.palette.primary.main, 0.5),
                boxShadow: `0 8px 20px -12px ${alpha(theme.palette.primary.main, 0.6)}`,
              },
            }}
          >
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
              <Box
                sx={{
                  p: 1,
                  borderRadius: 2,
                  bgcolor: alpha(theme.palette.primary.main, 0.12),
                  color: 'primary.main',
                  display: 'flex',
                }}
              >
                {w.icon}
              </Box>
              <Chip label="Live" size="small" color="success" variant="outlined" sx={{ fontWeight: 700 }} />
            </Stack>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 1.5 }}>{w.label}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{w.description}</Typography>
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 1.5, color: 'primary.main' }}>
              <Typography variant="caption" sx={{ fontWeight: 700 }}>Open</Typography>
              <ArrowForwardRounded sx={{ fontSize: 16 }} />
            </Stack>
          </Paper>
        ))}

        <Paper
          variant="outlined"
          sx={{
            borderRadius: 2.5,
            p: 2,
            borderStyle: 'dashed',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            minHeight: 160,
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
            More workflows coming
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            Additional MIS reviews will appear here.
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
}
