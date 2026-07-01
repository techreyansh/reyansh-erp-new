// Focused RTL tests for LiveCampaignMonitor — filters (campaign/status) are
// passed through to waMessagesService.listMessages, the row renders the
// expected cells, and it polls on an interval that's cleaned up on unmount.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../services/waMessagesService', () => {
  const mock = { listMessages: jest.fn() };
  return { __esModule: true, default: mock, ...mock };
});
jest.mock('../../services/waCampaignsService', () => {
  const mock = { listCampaigns: jest.fn() };
  return { __esModule: true, default: mock, ...mock };
});

import waMessagesService from '../../services/waMessagesService';
import waCampaignsService from '../../services/waCampaignsService';
import LiveCampaignMonitor from './LiveCampaignMonitor';

const CAMPAIGNS = [{ id: 'camp-1', name: 'Diwali Blast' }, { id: 'camp-2', name: 'Follow-up' }];
const MESSAGE = {
  id: 'm1', campaign_id: 'camp-1', recipient_number: '+919876543210', step_order: 0,
  body_text: 'Hello from Reyansh!', scheduled_for: '2026-07-01T10:00:00Z', status: 'delivered',
  delivered_at: '2026-07-01T10:00:05Z', read_at: null, retry_count: 1,
};

describe('LiveCampaignMonitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    waCampaignsService.listCampaigns.mockResolvedValue(CAMPAIGNS);
    waMessagesService.listMessages.mockResolvedValue([MESSAGE]);
  });

  test('renders a message row with campaign name, recipient, message preview, status and flags', async () => {
    render(<LiveCampaignMonitor />);
    expect(await screen.findByText('Diwali Blast')).toBeInTheDocument();
    expect(screen.getByText('+919876543210')).toBeInTheDocument();
    expect(screen.getByText(/Step 1: Hello from Reyansh!/)).toBeInTheDocument();
    expect(screen.getByText('delivered')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // retry count
  });

  test('changing the campaign filter re-queries listMessages with that campaignId', async () => {
    render(<LiveCampaignMonitor />);
    await screen.findByText('Diwali Blast');
    waMessagesService.listMessages.mockClear();
    fireEvent.mouseDown(screen.getByLabelText('Campaign'));
    fireEvent.click(await screen.findByRole('option', { name: 'Follow-up' }));

    await waitFor(() => expect(waMessagesService.listMessages).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp-2' })
    ));
  });

  test('changing the status filter re-queries listMessages with that status', async () => {
    render(<LiveCampaignMonitor />);
    await screen.findByText('Diwali Blast');
    waMessagesService.listMessages.mockClear();
    fireEvent.mouseDown(screen.getByLabelText('Status'));
    fireEvent.click(await screen.findByRole('option', { name: 'failed' }));

    await waitFor(() => expect(waMessagesService.listMessages).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    ));
  });

  test('polls listMessages again after the poll interval and stops polling after unmount', async () => {
    jest.useFakeTimers({ legacyFakeTimers: false });
    try {
      const { unmount } = render(<LiveCampaignMonitor />);
      await act(async () => { await Promise.resolve(); });
      const callsAfterMount = waMessagesService.listMessages.mock.calls.length;
      expect(callsAfterMount).toBeGreaterThanOrEqual(1);

      await act(async () => {
        jest.advanceTimersByTime(7000);
        await Promise.resolve();
      });
      expect(waMessagesService.listMessages.mock.calls.length).toBeGreaterThan(callsAfterMount);

      unmount();
      const callsAfterUnmount = waMessagesService.listMessages.mock.calls.length;
      await act(async () => {
        jest.advanceTimersByTime(30000);
        await Promise.resolve();
      });
      // No further polling once unmounted — the interval must have been cleared.
      expect(waMessagesService.listMessages.mock.calls.length).toBe(callsAfterUnmount);
    } finally {
      jest.useRealTimers();
    }
  });
});
