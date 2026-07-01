// Focused RTL tests for HomeWaWidget — the Home dashboard widget added in
// Task 11. Mocks waMessagesService (providerStatus + dashboardCounts) and
// asserts the connected/offline/not-configured states plus the counts
// rendered from the real wa_dashboard_counts() RPC shape (see
// supabase/migrations/20260701140000_whatsapp_marketing_schema.sql).
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../services/waMessagesService', () => {
  const mock = { providerStatus: jest.fn(), dashboardCounts: jest.fn() };
  return { __esModule: true, default: mock, ...mock };
});

import waMessagesService from '../../services/waMessagesService';
import HomeWaWidget from './HomeWaWidget';

const COUNTS = {
  campaigns_by_status: { draft: 1, scheduled: 0, running: 4, paused: 0, completed: 2, stopped: 0, failed: 1 },
  messages_sent_today: 25,
  messages_scheduled_today: 10,
  delivery_success_rate: 88.2,
  replies_received_today: 3,
  replies_received_total: 9,
  pending_messages: 6,
};

describe('HomeWaWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders connected state with real counts', async () => {
    waMessagesService.providerStatus.mockResolvedValue({
      connected: true,
      provider_key: 'meta_cloud',
      sender_number: '+911234567890',
      mode: 'live',
      last_health_check_at: '2026-07-01T08:30:00.000Z',
      health_status: 'ok',
      health_reason: null,
    });
    waMessagesService.dashboardCounts.mockResolvedValue(COUNTS);

    render(<HomeWaWidget />);

    expect(await screen.findByText(/Connected/)).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument(); // active campaigns
    expect(screen.getByText('25')).toBeInTheDocument(); // sent today
    expect(screen.getByText('6')).toBeInTheDocument(); // pending
    expect(screen.getByText('1')).toBeInTheDocument(); // failed campaigns
    expect(screen.getByText(/meta_cloud/)).toBeInTheDocument();
  });

  test('renders offline state with health_reason when the active provider failed its last health check', async () => {
    waMessagesService.providerStatus.mockResolvedValue({
      connected: true,
      provider_key: 'meta_cloud',
      mode: 'live',
      last_health_check_at: '2026-07-01T08:30:00.000Z',
      health_status: 'error',
      health_reason: 'invalid access token',
    });
    waMessagesService.dashboardCounts.mockResolvedValue(COUNTS);

    render(<HomeWaWidget />);

    expect(await screen.findByText(/Offline/)).toBeInTheDocument();
    expect(screen.getByText(/invalid access token/)).toBeInTheDocument();
  });

  test('renders "Not configured yet" when there is no active provider row', async () => {
    waMessagesService.providerStatus.mockResolvedValue({ connected: false });
    waMessagesService.dashboardCounts.mockResolvedValue(COUNTS);

    render(<HomeWaWidget />);

    expect(await screen.findByText(/Not configured yet/)).toBeInTheDocument();
    expect(screen.queryByText('4')).not.toBeInTheDocument();
  });

  test('degrades cleanly (no throw) when the RPCs fail', async () => {
    waMessagesService.providerStatus.mockRejectedValue(new Error('rpc failed'));
    waMessagesService.dashboardCounts.mockRejectedValue(new Error('rpc failed'));

    render(<HomeWaWidget />);

    await waitFor(() => expect(screen.getByText(/Offline/)).toBeInTheDocument());
    expect(screen.getByText(/Status unavailable/)).toBeInTheDocument();
  });
});
