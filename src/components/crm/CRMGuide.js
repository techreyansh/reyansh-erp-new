import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Chip,
  Container,
  Grid,
  Paper,
  Stack,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  ContactMailOutlined,
  InsightsOutlined,
  TimelineOutlined,
  EventAvailableOutlined,
  TrendingUpOutlined,
  StorefrontOutlined,
  ArrowForwardRounded,
  ArrowDownwardRounded,
  CheckCircleRounded,
  CancelRounded,
  MenuBookOutlined,
  LightbulbOutlined,
} from '@mui/icons-material';
import CRMFlowStrip from './CRMFlowStrip';

const NODES = [
  { label: 'New Lead', desc: 'Enquiry comes in — add the company once', icon: ContactMailOutlined, path: '/crm/leads' },
  { label: 'Score & Qualify', desc: 'Rate budget, urgency, authority', icon: InsightsOutlined, path: '/crm/lead-scoring' },
  { label: 'Log Activity', desc: 'Record every call / email / visit', icon: TimelineOutlined, path: '/crm/timeline' },
  { label: 'Follow-up', desc: 'Set the next action + due date', icon: EventAvailableOutlined, path: '/crm/follow-ups' },
  { label: 'Deal / Pipeline', desc: 'Quotation, value, probability, stage', icon: TrendingUpOutlined, path: '/crm/deals' },
];

const STEPS = [
  { n: 1, title: 'New enquiry → add the Lead first', body: 'Every company is added once under Leads. Fill company, contact, owner, source and status. This is the single source of truth — everything else links to it.' },
  { n: 2, title: 'Score & qualify', body: 'Use Lead Scoring to rate budget, urgency, requirement clarity and decision authority. High scores = focus here.' },
  { n: 3, title: 'Log every interaction', body: 'After each call, email or visit, add a row in Activity. The lead’s “last contact” updates automatically.' },
  { n: 4, title: 'Set the next action', body: 'In Follow-ups, record the next commitment and a due date. Clear overdue/due-today items every morning.' },
  { n: 5, title: 'Open a deal', body: 'When it’s a real opportunity, add it to Deals (Pipeline) with product, value, probability and stage. Weighted value is computed for you.' },
  { n: 6, title: 'Close the loop', body: 'Deal Won → it becomes a Customer (account, orders, payments). Deal Lost → capture the reason so the team learns.' },
];

const ROUTINE = [
  { when: 'Every day', what: 'Open Follow-ups, clear every due/overdue row, log outcomes in Activity.' },
  { when: 'Every call / visit', what: 'Add an Activity row — it auto-updates the lead and the follow-up.' },
  { when: 'New enquiry', what: 'Add the Lead first, then anything else.' },
  { when: 'Deal won', what: 'Mark Won → the account moves to Customers.' },
  { when: 'Weekly', what: 'Review the CRM Dashboard with the team — pipeline, conversion, leaderboard.' },
];

const LEGEND = [
  { color: '#1E7DBE', label: 'New / Info', meaning: 'New lead, neutral state' },
  { color: '#059669', label: 'Hot / Won', meaning: 'Qualified, active, won' },
  { color: '#D97706', label: 'Due today', meaning: 'Action needed today' },
  { color: '#C0392B', label: 'Overdue / Risk', meaning: 'Past due, at-risk, lost' },
];

function Node({ node, onClick }) {
  const theme = useTheme();
  const Icon = node.icon;
  return (
    <Box
      onClick={onClick}
      sx={{
        flex: '1 1 0', minWidth: 150, cursor: 'pointer', borderRadius: 2, p: 1.5,
        border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper',
        transition: 'all 0.18s ease',
        '&:hover': { borderColor: alpha(theme.palette.primary.main, 0.5), boxShadow: `0 8px 20px -12px ${alpha(theme.palette.primary.main, 0.5)}` },
      }}
    >
      <Box sx={{ width: 34, height: 34, borderRadius: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, 0.1), mb: 1 }}>
        <Icon sx={{ fontSize: 20, color: 'primary.main' }} />
      </Box>
      <Typography variant="subtitle2" fontWeight={800}>{node.label}</Typography>
      <Typography variant="caption" color="text.secondary">{node.desc}</Typography>
    </Box>
  );
}

function CRMGuide() {
  const theme = useTheme();
  const navigate = useNavigate();

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 8 }}>
      <Box sx={{ background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 60%, ${theme.palette.primary.light} 120%)`, color: '#fff', px: { xs: 2, sm: 3 }, py: { xs: 3, md: 4 } }}>
        <Container maxWidth="xl" disableGutters>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ width: 44, height: 44, borderRadius: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(255,255,255,0.2)' }}>
              <MenuBookOutlined />
            </Box>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1 }}>CRM Playbook</Typography>
              <Typography variant="body1" sx={{ opacity: 0.9 }}>How the CRM works, end to end — for onboarding the team.</Typography>
            </Box>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ px: { xs: 2, sm: 3 }, mt: 3 }}>
        <CRMFlowStrip current="guide" showGuideLink={false} />

        {/* Golden rule */}
        <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2.5, borderLeft: `4px solid ${theme.palette.primary.main}`, bgcolor: alpha(theme.palette.primary.main, 0.04), display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
          <LightbulbOutlined sx={{ color: 'primary.main', mt: 0.25 }} />
          <Box>
            <Typography variant="subtitle1" fontWeight={800}>The golden rule</Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>New company? Add it as a Lead first.</strong> Enter data once — every other view (activity, follow-ups, deals, customers) links back to that one record. Never create the same company twice.
            </Typography>
          </Box>
        </Paper>

        {/* Visual flowchart */}
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, mb: 3, borderRadius: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 2 }}>The lifecycle</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, overflowX: 'auto', pb: 1 }}>
            {NODES.map((node, i) => (
              <React.Fragment key={node.label}>
                <Node node={node} onClick={() => navigate(node.path)} />
                {i < NODES.length - 1 && <ArrowForwardRounded sx={{ color: 'text.disabled', flexShrink: 0 }} />}
              </React.Fragment>
            ))}
          </Box>

          {/* Branch: Won / Lost */}
          <Stack alignItems="center" sx={{ my: 1 }}>
            <ArrowDownwardRounded sx={{ color: 'text.disabled' }} />
            <Typography variant="caption" color="text.secondary" fontWeight={700}>Deal outcome</Typography>
          </Stack>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Box onClick={() => navigate('/crm/customers')} sx={{ cursor: 'pointer', p: 1.75, borderRadius: 2, border: '1px solid', borderColor: alpha('#059669', 0.4), bgcolor: alpha('#059669', 0.06), display: 'flex', gap: 1.25, alignItems: 'center' }}>
                <CheckCircleRounded sx={{ color: '#059669' }} />
                <Box>
                  <Typography variant="subtitle2" fontWeight={800}>Won → Customer</Typography>
                  <Typography variant="caption" color="text.secondary">Becomes an account — orders, payments, retention.</Typography>
                </Box>
              </Box>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ p: 1.75, borderRadius: 2, border: '1px solid', borderColor: alpha('#C0392B', 0.4), bgcolor: alpha('#C0392B', 0.06), display: 'flex', gap: 1.25, alignItems: 'center' }}>
                <CancelRounded sx={{ color: '#C0392B' }} />
                <Box>
                  <Typography variant="subtitle2" fontWeight={800}>Lost → Capture the reason</Typography>
                  <Typography variant="caption" color="text.secondary">Record why & which competitor, so the team learns.</Typography>
                </Box>
              </Box>
            </Grid>
          </Grid>
        </Paper>

        {/* Step by step */}
        <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.5 }}>Step-by-step</Typography>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {STEPS.map((s) => (
            <Grid item xs={12} sm={6} md={4} key={s.n}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, height: '100%' }}>
                <Box sx={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'primary.main', color: '#fff', fontWeight: 800, fontSize: '0.85rem', mb: 1 }}>
                  {s.n}
                </Box>
                <Typography variant="subtitle2" fontWeight={800}>{s.title}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{s.body}</Typography>
              </Paper>
            </Grid>
          ))}
        </Grid>

        {/* Routine + Legend */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={7}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, height: '100%' }}>
              <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.5 }}>Daily / weekly routine</Typography>
              <Stack divider={<Box sx={{ height: '1px', bgcolor: 'divider' }} />} spacing={1.25}>
                {ROUTINE.map((r) => (
                  <Stack key={r.when} direction="row" spacing={2} alignItems="flex-start">
                    <Chip label={r.when} size="small" sx={{ fontWeight: 700, minWidth: 120, justifyContent: 'flex-start' }} />
                    <Typography variant="body2" color="text.secondary">{r.what}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Paper>
          </Grid>
          <Grid item xs={12} md={5}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, height: '100%' }}>
              <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.5 }}>Status colours</Typography>
              <Stack spacing={1.25}>
                {LEGEND.map((l) => (
                  <Stack key={l.label} direction="row" spacing={1.25} alignItems="center">
                    <Box sx={{ width: 14, height: 14, borderRadius: '4px', bgcolor: l.color, flexShrink: 0 }} />
                    <Typography variant="body2" fontWeight={700} sx={{ minWidth: 110 }}>{l.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{l.meaning}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Paper>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}

export default CRMGuide;
