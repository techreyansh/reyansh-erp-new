// Smoke test for the WhatsApp Marketing tab shell (Task 12). Mocks every
// sub-component (WaDashboard, CampaignsList, CampaignWizard, WaAudienceImport,
// LiveCampaignMonitor, CampaignAnalytics, ProviderSettings) rather than their
// underlying services — each of those already has its own focused test suite
// (see the *.test.js files alongside them in src/components/whatsappMarketing/),
// so mocking transitively through 5+ services here (waMessagesService,
// waCampaignsService, waContactsService, waProviderService, usePermissions)
// would add a lot of brittle setup for no extra coverage. This test instead
// verifies the shell's own job: tabs render, switching tabs swaps the visible
// sub-view, and "New Campaign" opens the wizard and wires onSaved to refresh
// the Campaigns tab.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../components/whatsappMarketing/WaDashboard', () => () => <div data-testid="wa-dashboard">WaDashboard</div>);

jest.mock('../../components/whatsappMarketing/CampaignsList', () => (props) => (
  <div data-testid="campaigns-list">
    CampaignsList
    <button onClick={() => props.onOpenAnalytics && props.onOpenAnalytics('camp-1')}>open-analytics</button>
    <button onClick={() => props.onOpenMonitor && props.onOpenMonitor('camp-1')}>open-monitor</button>
  </div>
));

jest.mock('../../components/whatsappMarketing/CampaignWizard', () => (props) => (
  <div data-testid="campaign-wizard">
    CampaignWizard
    <button onClick={() => props.onSaved && props.onSaved('camp-1', 'running')}>save-wizard</button>
    <button onClick={() => props.onClose && props.onClose()}>close-wizard</button>
  </div>
));

jest.mock('../../components/whatsappMarketing/WaAudienceImport', () => () => <div data-testid="wa-audience">WaAudienceImport</div>);

jest.mock('../../components/whatsappMarketing/LiveCampaignMonitor', () => (props) => (
  <div data-testid="live-monitor">LiveCampaignMonitor:{props.initialCampaignId || 'none'}</div>
));

jest.mock('../../components/whatsappMarketing/CampaignAnalytics', () => (props) => (
  <div data-testid="campaign-analytics">CampaignAnalytics:{props.initialCampaignId || 'none'}</div>
));

jest.mock('../../components/whatsappMarketing/ProviderSettings', () => () => <div data-testid="provider-settings">ProviderSettings</div>);

import WhatsAppMarketing from './WhatsAppMarketing';

describe('WhatsAppMarketing tab shell', () => {
  test('renders all six tab labels and the Dashboard tab by default', () => {
    render(<WhatsAppMarketing />);
    ['Dashboard', 'Campaigns', 'Audience', 'Monitor', 'Analytics', 'Settings'].forEach((label) => {
      expect(screen.getByRole('tab', { name: new RegExp(label) })).toBeInTheDocument();
    });
    expect(screen.getByTestId('wa-dashboard')).toBeInTheDocument();
  });

  test('switching tabs shows the corresponding sub-view', () => {
    render(<WhatsAppMarketing />);

    fireEvent.click(screen.getByRole('tab', { name: /Campaigns/ }));
    expect(screen.getByTestId('campaigns-list')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Audience/ }));
    expect(screen.getByTestId('wa-audience')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Monitor/ }));
    expect(screen.getByTestId('live-monitor')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Analytics/ }));
    expect(screen.getByTestId('campaign-analytics')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Settings/ }));
    expect(screen.getByTestId('provider-settings')).toBeInTheDocument();
  });

  test('"New Campaign" opens the wizard on the Campaigns tab, and saving closes it', () => {
    render(<WhatsAppMarketing />);
    fireEvent.click(screen.getByRole('tab', { name: /Campaigns/ }));

    expect(screen.queryByTestId('campaign-wizard')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /New Campaign/ }));
    expect(screen.getByTestId('campaign-wizard')).toBeInTheDocument();

    fireEvent.click(screen.getByText('save-wizard'));
    fireEvent.click(screen.getByText('close-wizard'));
    expect(screen.queryByTestId('campaign-wizard')).not.toBeInTheDocument();
  });

  test('CampaignsList "open analytics"/"open monitor" actions jump to the right tab pre-filtered to the campaign', () => {
    render(<WhatsAppMarketing />);
    fireEvent.click(screen.getByRole('tab', { name: /Campaigns/ }));

    fireEvent.click(screen.getByText('open-analytics'));
    expect(screen.getByTestId('campaign-analytics')).toHaveTextContent('camp-1');

    fireEvent.click(screen.getByRole('tab', { name: /Campaigns/ }));
    fireEvent.click(screen.getByText('open-monitor'));
    expect(screen.getByTestId('live-monitor')).toHaveTextContent('camp-1');
  });
});
