import React from 'react';
import { Button, Chip, Paper, Stack, Typography, alpha } from '@mui/material';
import {
  ArrowForwardRounded,
  ErrorOutlineRounded,
  InfoOutlined,
  WarningAmberRounded,
} from '@mui/icons-material';
import { SEMANTIC } from './format';

/** Severity → color + label + icon. */
export const SEVERITY = {
  critical: { color: SEMANTIC.critical, label: 'Critical', Icon: ErrorOutlineRounded },
  warning: { color: SEMANTIC.warning, label: 'Attention', Icon: WarningAmberRounded },
  info: { color: SEMANTIC.info, label: 'Info', Icon: InfoOutlined },
};

/** Order insights by severity for rendering. */
export function sortBySeverity(items = []) {
  const rank = { critical: 0, warning: 1, info: 2 };
  return [...items].sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
}

/**
 * The core "what should I do next?" card.
 *
 * @param {object}   item     { severity, title, detail, cta, path }
 * @param {function} onAction called with item.path when the CTA is clicked
 */
function AttentionCard({ item, onAction }) {
  const sev = SEVERITY[item.severity] || SEVERITY.info;
  const { Icon } = sev;
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 2.5,
        borderLeft: `4px solid ${sev.color}`,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        transition: 'box-shadow 0.2s ease, transform 0.2s ease',
        '&:hover': {
          boxShadow: `0 10px 24px -12px ${alpha(sev.color, 0.5)}`,
          transform: 'translateY(-2px)',
        },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Icon sx={{ fontSize: 20, color: sev.color }} />
        <Chip
          label={sev.label}
          size="small"
          sx={{ height: 20, fontWeight: 700, fontSize: '0.65rem', color: sev.color, bgcolor: alpha(sev.color, 0.12) }}
        />
      </Stack>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.3, mb: 0.5 }}>
        {item.title}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.45, flex: 1 }}>
        {item.detail}
      </Typography>
      {item.cta && (
        <Button
          size="small"
          endIcon={<ArrowForwardRounded sx={{ fontSize: 16 }} />}
          onClick={() => onAction?.(item.path)}
          sx={{
            alignSelf: 'flex-start',
            mt: 1.25,
            color: sev.color,
            fontWeight: 700,
            '&:hover': { bgcolor: alpha(sev.color, 0.08) },
          }}
        >
          {item.cta}
        </Button>
      )}
    </Paper>
  );
}

export default AttentionCard;
