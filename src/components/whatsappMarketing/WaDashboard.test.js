// Focused RTL tests for WaDashboard — renders the real wa_dashboard_counts()
// RPC shape (campaigns_by_status map + today/rate/pending scalars), not an
// assumed one. See supabase/migrations/20260701140000_whatsapp_marketing_schema.sql
// for the RPC this mirrors.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../services/waMessagesService', () => {
  const mock = { dashboardCounts: jest.fn() };
  return { __esModule: true, default: mock, ...mock };
});

import waMessagesService from '../../services/waMessagesService';
import WaDashboard from './WaDashboard';

const COUNTS = {
  campaigns_by_status: { draft: 2, scheduled: 1, running: 3, paused: 1, completed: 5, stopped: 1, failed: 0 },
  messages_sent_today: 42,
  messages_scheduled_today: 15,
  delivery_success_rate: 91.5,
  replies_received_today: 4,
  replies_received_total: 27,
  pending_messages: 8,
};

function tile(title) {
  let el = screen.getByText(title);
  while (el && !(el.className && String(el.className).includes('MuiCard-root'))) {
    el = el.parentElement;
  }
  return el;
}

describe('WaDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    waMessagesService.dashboardCounts.mockResolvedValue(COUNTS);
  });

  test('calls dashboardCounts exactly once and renders every required tile from the real RPC shape', async () => {
    render(<WaDashboard />);
    await screen.findByText('Active');
    expect(waMessagesService.dashboardCounts).toHaveBeenCalledTimes(1);

    expect(tile('Active')).toHaveTextContent('3'); // campaigns_by_status.running
    expect(tile('Scheduled')).toHaveTextContent('1');
    expect(tile('Completed')).toHaveTextContent('5');
    expect(tile('Paused')).toHaveTextContent('1');
    expect(tile('Failed')).toHaveTextContent('0');

    expect(tile('Sent Today')).toHaveTextContent('42');
    expect(tile('Scheduled Today')).toHaveTextContent('15');
    expect(tile('Delivery Success Rate')).toHaveTextContent('91.5%');
    expect(tile('Replies Received')).toHaveTextContent('27');
    expect(tile('Replies Received')).toHaveTextContent('4 today');
    expect(tile('Pending Messages')).toHaveTextContent('8');

    // draft/stopped campaigns aren't in the brief's required-tile list but are
    // shown as a small secondary strip rather than dropped silently.
    expect(screen.getByText('Draft: 2')).toBeInTheDocument();
    expect(screen.getByText('Stopped: 1')).toBeInTheDocument();
  });

  test('missing/zero counts render as 0 rather than throwing', async () => {
    waMessagesService.dashboardCounts.mockResolvedValue({ campaigns_by_status: {} });
    render(<WaDashboard />);
    await screen.findByText('Active');
    expect(tile('Active')).toHaveTextContent('0');
    expect(tile('Sent Today')).toHaveTextContent('0');
    expect(tile('Pending Messages')).toHaveTextContent('0');
  });

  test('surfaces a load error', async () => {
    waMessagesService.dashboardCounts.mockRejectedValue(new Error('rpc failed'));
    render(<WaDashboard />);
    await waitFor(() => expect(screen.getByText('rpc failed')).toBeInTheDocument());
  });
});
