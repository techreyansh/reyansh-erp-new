// Focused end-to-end RTL test for the Campaign Wizard's key flows: Basics ->
// Audience (enroll, not import) -> Messages (add a step) -> Schedule
// (business-hours carry-forward) -> Review (Start Now sets status). All
// Task 3 services are mocked — no real Supabase calls. This is also the only
// thing that forces CampaignWizard.js, StepBasics.js, StepAudience.js and
// StepReview.js through Babel/webpack-style compilation today (nothing
// mounts them from a route yet — Task 9/12 wire the wizard into a page),
// exactly the same reasoning WaAudienceImport.test.js documents for itself.
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../context/PermissionContext', () => ({
  usePermissions: () => ({ employee: { email: 'owner@reyansh.test', full_name: 'Owner Test' } }),
}));

jest.mock('../../services/rbacService', () => ({
  listEmployees: jest.fn(),
}));

jest.mock('../../services/waContactsService', () => {
  const mock = {
    listContacts: jest.fn(), upsertContact: jest.fn(), bulkImport: jest.fn(),
    pasteImport: jest.fn(), parsePasteRows: jest.fn(), normalizePhoneNumber: jest.fn(),
  };
  return { __esModule: true, default: mock, ...mock };
});

jest.mock('../../services/waCampaignsService', () => {
  const mock = {
    getCampaign: jest.fn(), createCampaign: jest.fn(), updateCampaign: jest.fn(),
    createStep: jest.fn(), updateStep: jest.fn(), deleteStep: jest.fn(),
    reorderSteps: jest.fn(), duplicateStep: jest.fn(), listEnrollments: jest.fn(),
    enrollContacts: jest.fn(), setStatus: jest.fn(),
  };
  return { __esModule: true, default: mock, ...mock };
});

jest.mock('../../services/waMediaService', () => {
  const mock = { listMedia: jest.fn(), uploadMedia: jest.fn(), attachMediaToStep: jest.fn(), inferMediaCategory: jest.fn() };
  return { __esModule: true, default: mock, ...mock };
});

// StepAudience embeds Task 7's WaAudienceImport (already covered by its own
// dedicated test file) — stub it here so this test stays focused on the
// wizard's own enroll-vs-import wiring, not WaAudienceImport's internals.
jest.mock('./WaAudienceImport', () => function StubWaAudienceImport() {
  return <div data-testid="wa-audience-import-stub">audience import widget</div>;
});

import { listEmployees } from '../../services/rbacService';
import waContactsService from '../../services/waContactsService';
import waCampaignsService from '../../services/waCampaignsService';
import waMediaService from '../../services/waMediaService';
import CampaignWizard from './CampaignWizard';

describe('CampaignWizard — end-to-end key flows', () => {
  let campaignRow;
  let stepRows;

  beforeEach(() => {
    campaignRow = null;
    stepRows = [];

    listEmployees.mockResolvedValue([{ id: 'e1', email: 'owner@reyansh.test', full_name: 'Owner Test' }]);
    waContactsService.listContacts.mockResolvedValue([
      { id: 'contact-1', contact_name: 'Ravi Sharma', whatsapp_number: '+919876543210', company: 'Acme Cables' },
    ]);
    waMediaService.listMedia.mockResolvedValue([]);

    waCampaignsService.createCampaign.mockImplementation(async (fields) => {
      campaignRow = { id: 'campaign-1', status: 'draft', business_hours_start: 9, business_hours_end: 18, working_days_only: true, ...fields };
      return campaignRow;
    });
    waCampaignsService.updateCampaign.mockImplementation(async (id, patch) => {
      campaignRow = { ...campaignRow, ...patch };
      return campaignRow;
    });
    waCampaignsService.getCampaign.mockImplementation(async () => ({ ...campaignRow, steps: stepRows, media: [] }));
    waCampaignsService.createStep.mockImplementation(async () => {
      const row = { id: `step-${stepRows.length + 1}`, step_order: stepRows.length, delay_type: 'immediate', delay_days: 0, body_text: '', is_active: true };
      stepRows = [...stepRows, row];
      return row;
    });
    waCampaignsService.listEnrollments.mockResolvedValue([]);
    waCampaignsService.enrollContacts.mockResolvedValue(1);
    waCampaignsService.setStatus.mockImplementation(async (id, status) => {
      campaignRow = { ...campaignRow, status };
      return campaignRow;
    });
  });

  test('Basics -> Audience -> Messages -> Schedule -> Review -> Start Now', async () => {
    const onSaved = jest.fn();
    const onClose = jest.fn();
    render(<CampaignWizard onClose={onClose} onSaved={onSaved} notify={jest.fn()} />);

    // Step 1 — Basics
    expect(await screen.findByLabelText(/campaign name/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/campaign name/i), { target: { value: 'Diwali Geyser Offer' } });
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    await waitFor(() => expect(waCampaignsService.createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Diwali Geyser Offer' }),
    ));

    // Step 2 — Audience: import widget is present but distinct from enrolling;
    // enrolling a contact and advancing calls enrollContacts (NOT any import call).
    expect(await screen.findByTestId('wa-audience-import-stub')).toBeInTheDocument();
    const contactRow = await screen.findByText('Ravi Sharma');
    fireEvent.click(within(contactRow.closest('tr')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    await waitFor(() => expect(waCampaignsService.enrollContacts).toHaveBeenCalledWith('campaign-1', ['contact-1']));
    expect(waContactsService.bulkImport).not.toHaveBeenCalled();
    expect(waContactsService.upsertContact).not.toHaveBeenCalled();

    // Step 3 — Messages: Next is blocked until at least one step exists.
    await screen.findByText(/message sequence/i);
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /add step/i }));
    await waitFor(() => expect(waCampaignsService.createStep).toHaveBeenCalledWith('campaign-1', {}));
    await waitFor(() => expect(screen.getByRole('button', { name: /^next$/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    // Step 4 — Schedule: default 9->18 window is valid, Next proceeds and persists it.
    await screen.findByText(/business hours window/i);
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    await waitFor(() => expect(waCampaignsService.updateCampaign).toHaveBeenLastCalledWith('campaign-1', expect.objectContaining({
      business_hours_start: 9, business_hours_end: 18, working_days_only: true,
    })));

    // Step 5 — Review: Start Now sets status to 'running' and closes the wizard.
    await screen.findByText(/review & launch/i);
    fireEvent.click(screen.getByRole('button', { name: /start now/i }));

    await waitFor(() => expect(waCampaignsService.setStatus).toHaveBeenCalledWith('campaign-1', 'running'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('campaign-1', 'running'));
    expect(onClose).toHaveBeenCalled();
  });

  test('Schedule step blocks Next with an inline error when business hours end <= start (Task 5 carry-forward)', async () => {
    render(<CampaignWizard onClose={jest.fn()} onSaved={jest.fn()} notify={jest.fn()} />);

    fireEvent.change(await screen.findByLabelText(/campaign name/i), { target: { value: 'Test Campaign' } });
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^next$/i })); // Audience -> Messages
    await screen.findByText(/message sequence/i);
    fireEvent.click(screen.getByRole('button', { name: /add step/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^next$/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /^next$/i })); // Messages -> Schedule

    await screen.findByText(/business hours window/i);
    fireEvent.mouseDown(screen.getByLabelText(/end hour/i));
    fireEvent.click(screen.getByRole('option', { name: '09:00' }));

    expect(screen.getByText(/end hour must be later than the start hour/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
  });
});
