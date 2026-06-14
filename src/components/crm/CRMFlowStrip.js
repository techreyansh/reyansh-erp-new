import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Paper, Stack, Typography, alpha, useTheme, Button } from '@mui/material';
import {
  ContactMailOutlined,
  InsightsOutlined,
  TimelineOutlined,
  EventAvailableOutlined,
  TrendingUpOutlined,
  StorefrontOutlined,
  ChevronRightRounded,
  MenuBookOutlined,
  MarkEmailReadOutlined,
} from '@mui/icons-material';

// The CRM lifecycle, in order. Each stage maps to a /crm section.
export const CRM_STAGES = [
  { key: 'leads', label: 'Leads', desc: 'Capture & qualify', path: '/crm/leads', icon: ContactMailOutlined },
  { key: 'lead-scoring', label: 'Scoring', desc: 'Prioritise', path: '/crm/lead-scoring', icon: InsightsOutlined },
  { key: 'timeline', label: 'Activity', desc: 'Log calls/visits', path: '/crm/timeline', icon: TimelineOutlined },
  { key: 'follow-ups', label: 'Follow-ups', desc: 'Next action', path: '/crm/follow-ups', icon: EventAvailableOutlined },
  { key: 'deals', label: 'Deals', desc: 'Pipeline', path: '/crm/deals', icon: TrendingUpOutlined },
  { key: 'customers', label: 'Customers', desc: 'Won → account', path: '/crm/customers', icon: StorefrontOutlined },
  { key: 'campaigns', label: 'Campaigns', desc: 'Email outreach', path: '/crm/campaigns', icon: MarkEmailReadOutlined },
];

/**
 * Horizontal, clickable CRM lifecycle strip. Shows the whole flow as one unit
 * and lets the user jump to any stage. Highlights the current section.
 */
function CRMFlowStrip({ current, showGuideLink = true }) {
  const theme = useTheme();
  const navigate = useNavigate();

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 1.5, md: 2 }, mb: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.25 }}>
        <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: '0.08em', color: 'text.secondary' }}>
          CRM Flow — capture → convert → retain
        </Typography>
        {showGuideLink && (
          <Button size="small" startIcon={<MenuBookOutlined sx={{ fontSize: 16 }} />} onClick={() => navigate('/crm/guide')} sx={{ textTransform: 'none' }}>
            How to use
          </Button>
        )}
      </Stack>

      <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 0.5, overflowX: 'auto', pb: 0.5 }}>
        {CRM_STAGES.map((stage, i) => {
          const Icon = stage.icon;
          const active = current === stage.key;
          return (
            <React.Fragment key={stage.key}>
              <Box
                onClick={() => navigate(stage.path)}
                sx={{
                  flex: '1 1 0', minWidth: 120, cursor: 'pointer', borderRadius: 2, p: 1.25,
                  border: '1px solid',
                  borderColor: active ? 'primary.main' : 'divider',
                  bgcolor: active ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
                  transition: 'all 0.18s ease',
                  '&:hover': { borderColor: alpha(theme.palette.primary.main, 0.5), bgcolor: alpha(theme.palette.primary.main, 0.05) },
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ width: 30, height: 30, borderRadius: 1.25, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, active ? 0.18 : 0.1) }}>
                    <Icon sx={{ fontSize: 18, color: 'primary.main' }} />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="caption" sx={{ fontWeight: 800, display: 'block', color: active ? 'primary.main' : 'text.primary', lineHeight: 1.1 }}>
                      {i + 1}. {stage.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.66rem' }} noWrap>{stage.desc}</Typography>
                  </Box>
                </Stack>
              </Box>
              {i < CRM_STAGES.length - 1 && (
                <Stack alignItems="center" justifyContent="center" sx={{ flexShrink: 0 }}>
                  <ChevronRightRounded sx={{ color: 'text.disabled' }} />
                </Stack>
              )}
            </React.Fragment>
          );
        })}
      </Box>
    </Paper>
  );
}

export default CRMFlowStrip;
