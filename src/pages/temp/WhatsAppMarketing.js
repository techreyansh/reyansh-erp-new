// WhatsApp Marketing — tab-shell entry page. Rendered at /temp/whatsapp-marketing
// (Temporary nav group). Mirrors the tab-shell pattern of
// src/components/crm/email/EmailCampaignsModule.js: a single Paper header with
// a Tabs bar, one sub-view rendered per tab, and a shared notify()/Snackbar.
//
// Tabs: Dashboard | Campaigns | Audience | Monitor | Analytics | Settings.
//
// Cross-tab navigation: CampaignsList's "Analytics"/"Live monitor" row actions
// (onOpenAnalytics/onOpenMonitor) jump to the Monitor/Analytics tab pre-filtered
// to that campaign. Because LiveCampaignMonitor/CampaignAnalytics only read
// their `initialCampaignId` prop once (on mount, via useState initializer),
// each carries a `key` derived from the requested campaign id so picking a
// *different* campaign while already on that tab forces a clean remount
// instead of being silently ignored.
import React, { useCallback, useState } from 'react';
import {
  Container, Box, Paper, Tabs, Tab, Typography, Stack, Snackbar, Alert, Chip, Button,
} from '@mui/material';
import {
  SpaceDashboardOutlined, CampaignOutlined, GroupsOutlined,
  MonitorHeartOutlined, InsightsOutlined, SettingsOutlined, AddRounded, WhatsApp,
} from '@mui/icons-material';
import WaDashboard from '../../components/whatsappMarketing/WaDashboard';
import CampaignsList from '../../components/whatsappMarketing/CampaignsList';
import CampaignWizard from '../../components/whatsappMarketing/CampaignWizard';
import WaAudienceImport from '../../components/whatsappMarketing/WaAudienceImport';
import LiveCampaignMonitor from '../../components/whatsappMarketing/LiveCampaignMonitor';
import CampaignAnalytics from '../../components/whatsappMarketing/CampaignAnalytics';
import ProviderSettings from '../../components/whatsappMarketing/ProviderSettings';

const TABS = [
  { label: 'Dashboard', icon: <SpaceDashboardOutlined sx={{ fontSize: 18 }} /> },
  { label: 'Campaigns', icon: <CampaignOutlined sx={{ fontSize: 18 }} /> },
  { label: 'Audience', icon: <GroupsOutlined sx={{ fontSize: 18 }} /> },
  { label: 'Monitor', icon: <MonitorHeartOutlined sx={{ fontSize: 18 }} /> },
  { label: 'Analytics', icon: <InsightsOutlined sx={{ fontSize: 18 }} /> },
  { label: 'Settings', icon: <SettingsOutlined sx={{ fontSize: 18 }} /> },
];

export default function WhatsAppMarketing() {
  const [tab, setTab] = useState(0);
  const [snack, setSnack] = useState(null);

  const notify = useCallback((message, severity = 'success') => {
    setSnack({ message, severity });
  }, []);

  // ── Campaigns tab: list + new/edit wizard ───────────────────────────────
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardCampaignId, setWizardCampaignId] = useState(null);
  const [campaignsRefreshKey, setCampaignsRefreshKey] = useState(0);

  const openNewCampaign = () => { setWizardCampaignId(null); setWizardOpen(true); };
  const closeWizard = () => setWizardOpen(false);
  const handleWizardSaved = (campaignId, finalStatus) => {
    notify(finalStatus === 'running' ? 'Campaign launched.' : 'Campaign saved.');
    setCampaignsRefreshKey((k) => k + 1);
  };

  // ── Monitor / Analytics tabs: optionally pre-filtered to one campaign ───
  const [monitorCampaignId, setMonitorCampaignId] = useState('');
  const [analyticsCampaignId, setAnalyticsCampaignId] = useState('');

  const openMonitorFor = (campaignId) => { setMonitorCampaignId(campaignId || ''); setTab(3); };
  const openAnalyticsFor = (campaignId) => { setAnalyticsCampaignId(campaignId || ''); setTab(4); };

  return (
    <Container maxWidth="xl">
      <Box sx={{ py: 1 }}>
        <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 1.5, md: 2 }, mb: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }} flexWrap="wrap" rowGap={1}>
            <Stack direction="row" spacing={1.25} alignItems="center">
              <WhatsApp color="success" />
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
                  WhatsApp Marketing
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Bulk outreach + drip campaigns over WhatsApp Business
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" color="success" variant="outlined" label="Temporary" />
              {tab === 1 && (
                <Button
                  variant="contained" size="small" startIcon={<AddRounded />}
                  onClick={openNewCampaign} sx={{ textTransform: 'none' }}
                >
                  New Campaign
                </Button>
              )}
            </Stack>
          </Stack>

          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            scrollButtons="auto"
          >
            {TABS.map((t) => (
              <Tab key={t.label} icon={t.icon} iconPosition="start" label={t.label} />
            ))}
          </Tabs>
        </Paper>

        {tab === 0 && <WaDashboard />}
        {tab === 1 && (
          <CampaignsList
            key={campaignsRefreshKey}
            notify={notify}
            onOpenAnalytics={openAnalyticsFor}
            onOpenMonitor={openMonitorFor}
          />
        )}
        {tab === 2 && <WaAudienceImport notify={notify} />}
        {tab === 3 && <LiveCampaignMonitor key={monitorCampaignId || 'all'} initialCampaignId={monitorCampaignId} />}
        {tab === 4 && <CampaignAnalytics key={analyticsCampaignId || 'first'} initialCampaignId={analyticsCampaignId} />}
        {tab === 5 && <ProviderSettings notify={notify} />}
      </Box>

      {wizardOpen && (
        <CampaignWizard
          campaignId={wizardCampaignId}
          onClose={closeWizard}
          onSaved={handleWizardSaved}
          notify={notify}
        />
      )}

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
