// Email Campaigns — module shell. Rendered by CRMModulePage when section === 'campaigns'.
// Tabs: Campaigns (list/builder) · Audience · Review queue · Senders (Gmail).
import React, { useState, useCallback } from 'react';
import {
  Container, Box, Paper, Tabs, Tab, Typography, Stack, Snackbar, Alert, Chip,
} from '@mui/material';
import {
  CampaignOutlined, GroupsOutlined, RateReviewOutlined, MarkEmailReadOutlined,
} from '@mui/icons-material';
import CampaignsList from './CampaignsList';
import CampaignBuilder from './CampaignBuilder';
import EmailAudience from './EmailAudience';
import EmailReviewQueue from './EmailReviewQueue';
import EmailSettings from './EmailSettings';

export default function EmailCampaignsModule() {
  const [tab, setTab] = useState(0);
  const [editingCampaignId, setEditingCampaignId] = useState(null);
  const [snack, setSnack] = useState(null);

  const notify = useCallback((message, severity = 'success') => {
    setSnack({ message, severity });
  }, []);

  return (
    <Container maxWidth="xl">
      <Box sx={{ py: 1 }}>
        <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 1.5, md: 2 }, mb: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Stack direction="row" spacing={1.25} alignItems="center">
              <MarkEmailReadOutlined color="primary" />
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
                  Email Campaigns
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  AI-personalized outreach sequences, sent from your Gmail
                </Typography>
              </Box>
            </Stack>
            <Chip size="small" color="primary" variant="outlined" label="CRM · Outreach" />
          </Stack>

          <Tabs
            value={tab}
            onChange={(_, v) => { setTab(v); setEditingCampaignId(null); }}
            variant="scrollable"
            scrollButtons="auto"
          >
            <Tab icon={<CampaignOutlined sx={{ fontSize: 18 }} />} iconPosition="start" label="Campaigns" />
            <Tab icon={<GroupsOutlined sx={{ fontSize: 18 }} />} iconPosition="start" label="Audience" />
            <Tab icon={<RateReviewOutlined sx={{ fontSize: 18 }} />} iconPosition="start" label="Review queue" />
            <Tab icon={<MarkEmailReadOutlined sx={{ fontSize: 18 }} />} iconPosition="start" label="Senders" />
          </Tabs>
        </Paper>

        {tab === 0 && (
          editingCampaignId ? (
            <CampaignBuilder
              campaignId={editingCampaignId}
              onBack={() => setEditingCampaignId(null)}
              notify={notify}
            />
          ) : (
            <CampaignsList
              onOpen={(id) => setEditingCampaignId(id)}
              notify={notify}
            />
          )
        )}
        {tab === 1 && <EmailAudience notify={notify} />}
        {tab === 2 && <EmailReviewQueue notify={notify} />}
        {tab === 3 && <EmailSettings notify={notify} />}
      </Box>

      <Snackbar
        open={!!snack}
        autoHideDuration={5000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {snack ? (
          <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(null)} sx={{ maxWidth: 480 }}>
            {snack.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Container>
  );
}
