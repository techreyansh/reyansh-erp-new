// Focused RTL test for MediaLibraryPicker: render/list, upload, and
// select-then-attach behavior, including Task 8's confirm-before-reassign
// guard when an attach would steal media off another step. Mocks
// waMediaService the same way CampaignWizard.test.js / StepMessages.test.js
// do, so no real Supabase calls happen.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../services/waMediaService', () => {
  const mock = {
    listMedia: jest.fn(),
    uploadMedia: jest.fn(),
    mediaUrl: jest.fn(),
    attachMediaToStep: jest.fn(),
  };
  return { __esModule: true, default: mock, ...mock };
});

import waMediaService from '../../services/waMediaService';
import MediaLibraryPicker from './MediaLibraryPicker';

const media = (over = {}) => ({
  id: 'm1', campaign_id: 'c1', step_id: null, storage_path: 'wa_campaigns/c1/foo.pdf',
  file_name: 'foo.pdf', mime_type: 'application/pdf', category: 'document', ...over,
});

describe('MediaLibraryPicker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    waMediaService.mediaUrl.mockResolvedValue('https://signed.example/foo');
    waMediaService.attachMediaToStep.mockResolvedValue({});
  });

  test('lists media loaded from listMedia for the campaign', async () => {
    waMediaService.listMedia.mockResolvedValue([
      media({ id: 'm1', file_name: 'brochure.pdf' }),
      media({ id: 'm2', file_name: 'hero.png', category: 'image' }),
    ]);
    render(<MediaLibraryPicker open campaignId="c1" stepId="s1" onClose={jest.fn()} notify={jest.fn()} />);

    expect(await screen.findByText('brochure.pdf')).toBeInTheDocument();
    expect(screen.getByText('hero.png')).toBeInTheDocument();
    expect(waMediaService.listMedia).toHaveBeenCalledWith('c1');
  });

  test('uploading a file calls uploadMedia with the campaign, step and file', async () => {
    waMediaService.listMedia.mockResolvedValue([]);
    waMediaService.uploadMedia.mockResolvedValue(media({ id: 'new1' }));
    render(<MediaLibraryPicker open campaignId="c1" stepId="s1" onClose={jest.fn()} notify={jest.fn()} />);

    await screen.findByText(/no media uploaded/i);
    const file = new File(['hello'], 'note.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(waMediaService.uploadMedia).toHaveBeenCalledWith('c1', 's1', file));
  });

  test('attach calls attachMediaToStep with diffed ids: deselecting current-step media detaches, selecting unattached media attaches — no confirm needed', async () => {
    waMediaService.listMedia.mockResolvedValue([
      media({ id: 'm1', file_name: 'already-on-step.pdf', step_id: 's1' }),
      media({ id: 'm2', file_name: 'unattached.pdf', step_id: null }),
    ]);
    const onAttached = jest.fn();
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MediaLibraryPicker open campaignId="c1" stepId="s1" onClose={jest.fn()} onAttached={onAttached} notify={jest.fn()} />);

    await screen.findByText('already-on-step.pdf');
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // deselect m1 (was on this step)
    fireEvent.click(checkboxes[1]); // select m2 (unattached)

    fireEvent.click(screen.getByRole('button', { name: /attach/i }));

    await waitFor(() => expect(waMediaService.attachMediaToStep).toHaveBeenCalledWith('m2', 's1'));
    expect(waMediaService.attachMediaToStep).toHaveBeenCalledWith('m1', null);
    expect(confirmSpy).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  test('selecting media attached to a DIFFERENT step prompts for confirmation before reassigning, and proceeds only when confirmed', async () => {
    waMediaService.listMedia.mockResolvedValue([
      media({ id: 'm3', file_name: 'on-other-step.pdf', step_id: 's2' }),
    ]);
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MediaLibraryPicker open campaignId="c1" stepId="s1" onClose={jest.fn()} notify={jest.fn()} />);

    await screen.findByText('on-other-step.pdf');
    fireEvent.click(screen.getAllByRole('checkbox')[0]); // select media currently on step s2

    fireEvent.click(screen.getByRole('button', { name: /attach/i }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(confirmSpy.mock.calls[0][0]).toMatch(/1 file/i);
    await waitFor(() => expect(waMediaService.attachMediaToStep).toHaveBeenCalledWith('m3', 's1'));

    confirmSpy.mockRestore();
  });

  test('cancelling the reassignment confirmation does not call attachMediaToStep', async () => {
    waMediaService.listMedia.mockResolvedValue([
      media({ id: 'm3', file_name: 'on-other-step.pdf', step_id: 's2' }),
    ]);
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MediaLibraryPicker open campaignId="c1" stepId="s1" onClose={jest.fn()} notify={jest.fn()} />);

    await screen.findByText('on-other-step.pdf');
    fireEvent.click(screen.getAllByRole('checkbox')[0]); // select media currently on step s2

    fireEvent.click(screen.getByRole('button', { name: /attach/i }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(waMediaService.attachMediaToStep).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });
});
