// Focused RTL tests for CampaignAnalytics — tiles reflect the combined shape
// of waMessagesService.campaignAnalytics() (message-derived stats) and
// waCampaignsService.listEnrollments() (true enrollment totals/completion %),
// and no fabricated avg-response-time metric is rendered (Task 9 decision).
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../services/waMessagesService', () => {
  const mock = { campaignAnalytics: jest.fn() };
  return { __esModule: true, default: mock, ...mock };
});
jest.mock('../../services/waCampaignsService', () => {
  const mock = { listCampaigns: jest.fn(), listEnrollments: jest.fn() };
  return { __esModule: true, default: mock, ...mock };
});

import waMessagesService from '../../services/waMessagesService';
import waCampaignsService from '../../services/waCampaignsService';
import CampaignAnalytics from './CampaignAnalytics';

const CAMPAIGNS = [{ id: 'camp-1', name: 'Diwali Blast' }];
const ANALYTICS = {
  totalContacts: 3, totalMessages: 5, sent: 4, delivered: 3, read: 2, failed: 1,
  replies: 2, deliveryRate: 75, readRate: 50, completionRate: 60,
};
const ENROLLMENTS = [
  { id: 'e1', status: 'completed' },
  { id: 'e2', status: 'completed' },
  { id: 'e3', status: 'active' },
  { id: 'e4', status: 'failed' },
];

// KPICard's title and value live in sibling Boxes, not nested — walk up to
// the nearest MUI Card root so we can assert on the whole tile's text.
function tile(title) {
  let el = screen.getByText(title);
  while (el && !(el.className && String(el.className).includes('MuiCard-root'))) {
    el = el.parentElement;
  }
  return el;
}

describe('CampaignAnalytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    waCampaignsService.listCampaigns.mockResolvedValue(CAMPAIGNS);
    waCampaignsService.listEnrollments.mockResolvedValue(ENROLLMENTS);
    waMessagesService.campaignAnalytics.mockResolvedValue(ANALYTICS);
  });

  test('auto-selects the first campaign and renders its tiles from the real data shape', async () => {
    render(<CampaignAnalytics />);
    await waitFor(() => expect(waMessagesService.campaignAnalytics).toHaveBeenCalledWith('camp-1'));

    await screen.findByText('Messages Sent');
    expect(tile('Messages Sent')).toHaveTextContent('4');
    expect(tile('Delivery Rate')).toHaveTextContent('75%');
    expect(tile('Read Rate')).toHaveTextContent('50%');
    expect(tile('Replies')).toHaveTextContent('2');
    expect(tile('Failures')).toHaveTextContent('1');
  });

  test('Total Contacts Enrolled and Completion % are computed from listEnrollments, not from campaignAnalytics.totalContacts/completionRate', async () => {
    render(<CampaignAnalytics />);
    await screen.findByText('Total Contacts Enrolled');

    // 4 enrollments total (not campaignAnalytics.totalContacts === 3).
    expect(tile('Total Contacts Enrolled')).toHaveTextContent('4');

    // 2 of 4 enrollments are 'completed' -> 50% (not campaignAnalytics.completionRate === 60).
    const completionTile = tile('Completion %');
    expect(completionTile).toHaveTextContent('50%');
    expect(completionTile).toHaveTextContent('2 of 4 enrollments completed');
  });

  test('does not render a fabricated avg response time metric tile', async () => {
    render(<CampaignAnalytics />);
    await screen.findByText('Total Contacts Enrolled');
    // No KPICard titled "Avg Response Time" (an exact-text match on a tile
    // title, unlike a substring regex, won't false-positive on the
    // explanatory caption sentence below).
    expect(screen.queryByText('Avg Response Time')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Avg\.? Response Time$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/response time is not shown/i)).toBeInTheDocument();
  });

  test('shows a cancelled-excluded caption on the Failures tile when analytics.cancelled > 0', async () => {
    waMessagesService.campaignAnalytics.mockResolvedValue({ ...ANALYTICS, failed: 1, cancelled: 3 });
    render(<CampaignAnalytics />);
    await screen.findByText('Messages Sent');
    expect(tile('Failures')).toHaveTextContent('1');
    expect(tile('Failures')).toHaveTextContent('3 cancelled (excluded)');
  });

  test('switching the campaign selector reloads analytics for the newly picked campaign', async () => {
    waCampaignsService.listCampaigns.mockResolvedValue([...CAMPAIGNS, { id: 'camp-2', name: 'Follow-up' }]);
    render(<CampaignAnalytics />);
    await waitFor(() => expect(waMessagesService.campaignAnalytics).toHaveBeenCalledWith('camp-1'));

    fireEvent.mouseDown(screen.getByLabelText('Campaign'));
    fireEvent.click(await screen.findByRole('option', { name: 'Follow-up' }));

    await waitFor(() => expect(waMessagesService.campaignAnalytics).toHaveBeenCalledWith('camp-2'));
    expect(waCampaignsService.listEnrollments).toHaveBeenCalledWith('camp-2');
  });
});
