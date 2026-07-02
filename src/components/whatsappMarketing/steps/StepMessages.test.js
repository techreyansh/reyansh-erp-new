// Focused RTL test for StepMessages' step add/duplicate/reorder/disable
// actions and arbitrary (non-preset) delay-day input, mocking Task 3's
// waCampaignsService/waMediaService so no real network/Supabase calls happen.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../../services/waCampaignsService', () => {
  const mock = {
    getCampaign: jest.fn(),
    createStep: jest.fn(),
    updateStep: jest.fn(),
    deleteStep: jest.fn(),
    reorderSteps: jest.fn(),
    duplicateStep: jest.fn(),
  };
  return { __esModule: true, default: mock, ...mock };
});
jest.mock('../../../services/waMediaService', () => {
  const mock = { listMedia: jest.fn(), uploadMedia: jest.fn(), attachMediaToStep: jest.fn() };
  return { __esModule: true, default: mock, ...mock };
});

import waCampaignsService from '../../../services/waCampaignsService';
import waMediaService from '../../../services/waMediaService';
import StepMessages from './StepMessages';

const step = (over = {}) => ({
  id: 's1', campaign_id: 'c1', step_order: 0, delay_type: 'immediate', delay_days: 0,
  body_text: 'Hello {{CustomerName}}', is_active: true, ...over,
});

describe('StepMessages', () => {
  beforeEach(() => {
    waMediaService.listMedia.mockResolvedValue([]);
  });

  test('renders the loaded sequence and reflects an existing arbitrary delay (e.g. 7 days)', async () => {
    waCampaignsService.getCampaign.mockResolvedValue({ steps: [step({ delay_type: 'after_days', delay_days: 7 })] });
    render(<StepMessages campaignId="c1" onStepsChange={jest.fn()} notify={jest.fn()} />);

    expect(await screen.findByText('Step 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('7')).toBeInTheDocument();
    expect(screen.getByLabelText(/after n days/i)).toBeChecked();
  });

  test('add step calls createStep and appends a new card', async () => {
    waCampaignsService.getCampaign.mockResolvedValue({ steps: [step()] });
    waCampaignsService.createStep.mockResolvedValue(step({ id: 's2', step_order: 1, body_text: '', is_active: true }));
    const onStepsChange = jest.fn();
    render(<StepMessages campaignId="c1" onStepsChange={onStepsChange} notify={jest.fn()} />);

    await screen.findByText('Step 1');
    fireEvent.click(screen.getByRole('button', { name: /add step/i }));

    await waitFor(() => expect(screen.getByText('Step 2')).toBeInTheDocument());
    expect(waCampaignsService.createStep).toHaveBeenCalledWith('c1', {});
    expect(onStepsChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 's1' }), expect.objectContaining({ id: 's2' }),
    ]));
  });

  test('duplicate step calls duplicateStep and appends the copy', async () => {
    waCampaignsService.getCampaign.mockResolvedValue({ steps: [step()] });
    waCampaignsService.duplicateStep.mockResolvedValue(step({ id: 's2', step_order: 1 }));
    render(<StepMessages campaignId="c1" onStepsChange={jest.fn()} notify={jest.fn()} />);

    await screen.findByText('Step 1');
    fireEvent.click(screen.getByRole('button', { name: /duplicate step/i }));

    await waitFor(() => expect(waCampaignsService.duplicateStep).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(screen.getByText('Step 2')).toBeInTheDocument());
  });

  test('delete step confirms, then calls deleteStep and removes the card', async () => {
    waCampaignsService.getCampaign.mockResolvedValue({ steps: [step()] });
    waCampaignsService.deleteStep.mockResolvedValue(true);
    window.confirm = jest.fn(() => true);
    render(<StepMessages campaignId="c1" onStepsChange={jest.fn()} notify={jest.fn()} />);

    await screen.findByText('Step 1');
    fireEvent.click(screen.getByRole('button', { name: /delete step/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(waCampaignsService.deleteStep).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(screen.queryByText('Step 1')).not.toBeInTheDocument());
  });

  test('delete step is a no-op when the confirm dialog is dismissed', async () => {
    waCampaignsService.getCampaign.mockResolvedValue({ steps: [step()] });
    window.confirm = jest.fn(() => false);
    render(<StepMessages campaignId="c1" onStepsChange={jest.fn()} notify={jest.fn()} />);

    await screen.findByText('Step 1');
    fireEvent.click(screen.getByRole('button', { name: /delete step/i }));

    expect(waCampaignsService.deleteStep).not.toHaveBeenCalled();
    expect(screen.getByText('Step 1')).toBeInTheDocument();
  });

  test('toggling the enable switch disables without deleting (updateStep is_active:false)', async () => {
    waCampaignsService.getCampaign.mockResolvedValue({ steps: [step()] });
    waCampaignsService.updateStep.mockResolvedValue(step({ is_active: false }));
    render(<StepMessages campaignId="c1" onStepsChange={jest.fn()} notify={jest.fn()} />);

    await screen.findByText('Step 1');
    fireEvent.click(screen.getByRole('checkbox', { name: /disable \(keep, stop sending\)/i }));

    await waitFor(() => expect(waCampaignsService.updateStep).toHaveBeenCalledWith('s1', { is_active: false }));
    expect(waCampaignsService.deleteStep).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Disabled')).toBeInTheDocument());
  });

  test('reorder (move down) calls reorderSteps with the new id order and reloads', async () => {
    waCampaignsService.getCampaign
      .mockResolvedValueOnce({ steps: [step({ id: 'a', step_order: 0, body_text: 'first' }), step({ id: 'b', step_order: 1, body_text: 'second' })] })
      .mockResolvedValueOnce({ steps: [step({ id: 'b', step_order: 0, body_text: 'second' }), step({ id: 'a', step_order: 1, body_text: 'first' })] });
    waCampaignsService.reorderSteps.mockResolvedValue(true);
    render(<StepMessages campaignId="c1" onStepsChange={jest.fn()} notify={jest.fn()} />);

    await screen.findByText('Step 1');
    const downButtons = screen.getAllByRole('button', { name: /move down/i });
    fireEvent.click(downButtons[0]);

    await waitFor(() => expect(waCampaignsService.reorderSteps).toHaveBeenCalledWith('c1', ['b', 'a']));
  });

  test('arbitrary non-preset delay-day counts (e.g. 4) are accepted and saved verbatim', async () => {
    waCampaignsService.getCampaign.mockResolvedValue({ steps: [step({ delay_type: 'after_days', delay_days: 3 })] });
    waCampaignsService.updateStep.mockResolvedValue(step({ delay_type: 'after_days', delay_days: 4 }));
    render(<StepMessages campaignId="c1" onStepsChange={jest.fn()} notify={jest.fn()} />);

    await screen.findByText('Step 1');
    const daysInput = screen.getByLabelText('Days');
    fireEvent.change(daysInput, { target: { value: '4' } });

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(waCampaignsService.updateStep).toHaveBeenCalledWith('s1', {
      body_text: 'Hello {{CustomerName}}', delay_type: 'after_days', delay_days: 4,
    }));
  });

  test('the "Generate with AI" button is present and disabled', async () => {
    waCampaignsService.getCampaign.mockResolvedValue({ steps: [step()] });
    render(<StepMessages campaignId="c1" onStepsChange={jest.fn()} notify={jest.fn()} />);
    await screen.findByText('Step 1');
    expect(screen.getByRole('button', { name: /generate with ai/i })).toBeDisabled();
  });

  test('clicking a variable chip inserts the token into the body textarea', async () => {
    waCampaignsService.getCampaign.mockResolvedValue({ steps: [step({ body_text: 'Hi ' })] });
    render(<StepMessages campaignId="c1" onStepsChange={jest.fn()} notify={jest.fn()} />);
    await screen.findByText('Step 1');

    fireEvent.click(screen.getByText('{{Product}}'));

    const textarea = screen.getByPlaceholderText(/hi \{\{customername\}\}/i);
    expect(textarea).toHaveValue('Hi {{Product}}');
  });
});
