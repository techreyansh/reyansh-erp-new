// Focused RTL tests for CampaignsList — status chips, Pause/Resume/Stop
// wiring to waCampaignsService.setStatus, and that Stop surfaces the
// cancel-pending-messages confirmation + success message (Task 9).
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../services/waCampaignsService', () => {
  const mock = { listCampaigns: jest.fn(), setStatus: jest.fn() };
  return { __esModule: true, default: mock, ...mock };
});

import waCampaignsService from '../../services/waCampaignsService';
import CampaignsList from './CampaignsList';

// MUI's Tooltip puts the accessible `aria-label` on the *wrapping* <span>,
// not the inner <button> — a real click lands on the button (the innermost
// element under the pointer), and a click event dispatched on the outer span
// would never bubble down into it. So resolve to the actual <button> before
// firing the click.
function clickAction(container, label) {
  const labelled = within(container).getByLabelText(label);
  const button = labelled.tagName === 'BUTTON' ? labelled : labelled.querySelector('button');
  fireEvent.click(button);
}

const CAMPAIGNS = [
  { id: 'c-running', name: 'Diwali Blast', status: 'running', owner_email: 'a@b.com', created_at: '2026-06-01T00:00:00Z' },
  { id: 'c-paused', name: 'Follow-up', status: 'paused', owner_email: 'a@b.com', created_at: '2026-06-02T00:00:00Z' },
  { id: 'c-draft', name: 'New Draft', status: 'draft', owner_email: 'a@b.com', created_at: '2026-06-03T00:00:00Z' },
  { id: 'c-done', name: 'Old One', status: 'completed', owner_email: 'a@b.com', created_at: '2026-05-01T00:00:00Z' },
];

describe('CampaignsList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    waCampaignsService.listCampaigns.mockResolvedValue(CAMPAIGNS);
    window.confirm = jest.fn(() => true);
  });

  test('renders campaigns with status chips', async () => {
    render(<CampaignsList />);
    expect(await screen.findByText('Diwali Blast')).toBeInTheDocument();
    expect(screen.getByText('Follow-up')).toBeInTheDocument();
    expect(screen.getAllByText(/running|paused|draft|completed/).length).toBeGreaterThanOrEqual(4);
  });

  test('running campaign shows Pause and Stop actions', async () => {
    render(<CampaignsList />);
    await screen.findByText('Diwali Blast');
    const row = screen.getByTestId('campaign-row-c-running');
    expect(within(row).getByLabelText('Pause')).toBeInTheDocument();
    expect(within(row).getByLabelText('Stop (cancels un-sent messages)')).toBeInTheDocument();
  });

  test('paused campaign shows Resume and Stop actions', async () => {
    render(<CampaignsList />);
    await screen.findByText('Follow-up');
    const row = screen.getByTestId('campaign-row-c-paused');
    expect(within(row).getByLabelText('Resume')).toBeInTheDocument();
    expect(within(row).getByLabelText('Stop (cancels un-sent messages)')).toBeInTheDocument();
  });

  test('draft campaign shows only a Start action, no Stop', async () => {
    render(<CampaignsList />);
    await screen.findByText('New Draft');
    const row = screen.getByTestId('campaign-row-c-draft');
    expect(within(row).getByLabelText('Start now')).toBeInTheDocument();
    expect(within(row).queryByLabelText('Stop (cancels un-sent messages)')).not.toBeInTheDocument();
  });

  test('completed campaign shows no action buttons (only view links)', async () => {
    render(<CampaignsList />);
    await screen.findByText('Old One');
    const row = screen.getByTestId('campaign-row-c-done');
    expect(within(row).queryByLabelText('Pause')).not.toBeInTheDocument();
    expect(within(row).queryByLabelText('Resume')).not.toBeInTheDocument();
    expect(within(row).queryByLabelText('Start now')).not.toBeInTheDocument();
    expect(within(row).queryByLabelText(/^Stop/)).not.toBeInTheDocument();
  });

  test('Stop asks for confirmation, calls setStatus("stopped"), and notifies about cancelled messages', async () => {
    waCampaignsService.setStatus.mockResolvedValue({ id: 'c-running', status: 'stopped' });
    const notify = jest.fn();
    render(<CampaignsList notify={notify} />);
    await screen.findByText('Diwali Blast');
    const row = screen.getByTestId('campaign-row-c-running');
    clickAction(row, 'Stop (cancels un-sent messages)');

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(waCampaignsService.setStatus).toHaveBeenCalledWith('c-running', 'stopped'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/cancelled/i)));
  });

  test('declining the Stop confirmation does not call setStatus', async () => {
    window.confirm = jest.fn(() => false);
    render(<CampaignsList />);
    await screen.findByText('Diwali Blast');
    const row = screen.getByTestId('campaign-row-c-running');
    clickAction(row, 'Stop (cancels un-sent messages)');
    expect(window.confirm).toHaveBeenCalled();
    expect(waCampaignsService.setStatus).not.toHaveBeenCalled();
  });

  test('Pause calls setStatus("paused") without a confirmation prompt', async () => {
    waCampaignsService.setStatus.mockResolvedValue({ id: 'c-running', status: 'paused' });
    render(<CampaignsList />);
    await screen.findByText('Diwali Blast');
    const row = screen.getByTestId('campaign-row-c-running');
    clickAction(row, 'Pause');
    expect(window.confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(waCampaignsService.setStatus).toHaveBeenCalledWith('c-running', 'paused'));
  });

  test('surfaces a load error via notify', async () => {
    waCampaignsService.listCampaigns.mockRejectedValue(new Error('network down'));
    const notify = jest.fn();
    render(<CampaignsList notify={notify} />);
    await waitFor(() => expect(notify).toHaveBeenCalledWith('network down', 'error'));
  });
});
