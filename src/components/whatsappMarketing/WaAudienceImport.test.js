// Smoke test for the WhatsApp audience import widget. This is also the only
// thing that actually forces WaAudienceImport.js through Babel/webpack-style
// compilation in this repo today (nothing imports it yet — Task 8 wires it
// into StepAudience.js) — `npm run build` alone would silently skip a file
// nothing references, so this test is the real "does it compile and render"
// check for this task.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// This repo has no global src/setupTests.js wiring jest-dom matchers (no
// existing component render tests to have needed it) — import it directly.
import '@testing-library/jest-dom';

jest.mock('../../services/waContactsService', () => {
  const mock = {
    listContacts: jest.fn(),
    upsertContact: jest.fn(),
    bulkImport: jest.fn(),
    pasteImport: jest.fn(),
    parsePasteRows: jest.fn(),
    normalizePhoneNumber: jest.fn(),
  };
  return { __esModule: true, default: mock, ...mock };
});

import waContactsService from '../../services/waContactsService';
import { getDataset } from '../../services/bulkImport/registry';
import WaAudienceImport from './WaAudienceImport';

// The component's paste-apply path calls the wa_contacts dataset's apply()
// directly (the same function BulkImportDialog.apply() uses for CSV/Excel) so
// preview and apply always agree. `dataset` is a singleton object, so
// getDataset() here returns the exact same reference the component imports —
// spying on it lets us assert what the component hands to apply() without
// hitting Supabase.
const dataset = getDataset('wa_contacts');
jest.spyOn(dataset, 'apply');

describe('WaAudienceImport', () => {
  // NOTE: react-scripts' Jest config sets `resetMocks: true`, which strips any
  // mockResolvedValue/mockImplementation set inside jest.mock()'s factory
  // before every test runs — so implementations must be (re)installed here,
  // not in the factory above.
  beforeEach(() => {
    waContactsService.listContacts.mockResolvedValue([]);
    waContactsService.upsertContact.mockResolvedValue('contact-id');
    waContactsService.bulkImport.mockResolvedValue({ batchId: 'b1', created: 0, updated: 0, errors: [] });
    waContactsService.pasteImport.mockResolvedValue({ batchId: 'b1', created: 1, updated: 0, errors: [] });
    waContactsService.parsePasteRows.mockImplementation((text) => (text || '').split('\n').filter(Boolean).map((line) => ({ contactName: line, whatsappNumber: line })));
    waContactsService.normalizePhoneNumber.mockImplementation((v) => (v ? `+91${String(v).replace(/\D/g, '')}` : ''));
    dataset.apply.mockResolvedValue({ created: 1, updated: 0, errors: [] });
  });

  test('renders without crashing and loads the contact list', async () => {
    render(<WaAudienceImport />);
    await waitFor(() => expect(waContactsService.listContacts).toHaveBeenCalled());
    expect(await screen.findByText(/0 contacts/i)).toBeInTheDocument();
  });

  test('shows the 4 CRM/list sources as visibly present but disabled', async () => {
    render(<WaAudienceImport />);
    await waitFor(() => expect(waContactsService.listContacts).toHaveBeenCalled());
    ['CRM Customers', 'CRM Prospects', 'Client Groups', 'Custom Lists'].forEach((label) => {
      const chip = screen.getByText(label).closest('.MuiChip-root');
      expect(chip).toBeTruthy();
      expect(chip.className).toMatch(/Mui-disabled/);
    });
  });

  test('manual add form calls upsertContact with the entered fields', async () => {
    render(<WaAudienceImport />);
    await waitFor(() => expect(waContactsService.listContacts).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /add contact/i }));
    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'Ravi Sharma' } });
    fireEvent.change(screen.getByLabelText(/whatsapp number/i), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByLabelText(/^Tags$/i), { target: { value: 'vip, geyser' } });
    fireEvent.click(screen.getByRole('button', { name: /^save contact$/i }));

    await waitFor(() => expect(waContactsService.upsertContact).toHaveBeenCalledWith(expect.objectContaining({
      contactName: 'Ravi Sharma',
      whatsappNumber: '9876543210',
      tags: ['vip', 'geyser'],
      source: 'manual',
    })));
  });

  test('paste import: preview shows a row, then apply calls the dataset apply() (not pasteImport)', async () => {
    render(<WaAudienceImport />);
    await waitFor(() => expect(waContactsService.listContacts).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /paste import/i }));
    const textarea = screen.getByPlaceholderText(/Ravi Sharma, 9876543210/i);
    fireEvent.change(textarea, { target: { value: '9876543210' } });
    fireEvent.click(screen.getByRole('button', { name: /^preview$/i }));

    await waitFor(() => expect(screen.getByText(/^Import \(1\)$/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/^Import \(1\)$/i));

    await waitFor(() => expect(dataset.apply).toHaveBeenCalled());
    expect(waContactsService.pasteImport).not.toHaveBeenCalled();
    expect(dataset.apply.mock.calls[0][0]).toHaveLength(1);
  });

  test('paste import: Import applies ONLY the previewed-valid rows — a malformed-but-non-empty number is never written (regression for preview/apply validation mismatch)', async () => {
    render(<WaAudienceImport />);
    await waitFor(() => expect(waContactsService.listContacts).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /paste import/i }));
    const textarea = screen.getByPlaceholderText(/Ravi Sharma, 9876543210/i);
    // One good 10-digit number (valid) + one malformed-but-non-empty number
    // ("12345" — normalizes to a non-empty string but fails the 8-15 digit
    // sanity check, so the preview must flag it "Skip").
    fireEvent.change(textarea, { target: { value: '9876543210\n12345' } });
    fireEvent.click(screen.getByRole('button', { name: /^preview$/i }));

    // Preview: 1 new + 1 skipped, and the Import button only counts the valid one.
    await waitFor(() => expect(screen.getByText(/^Import \(1\)$/i)).toBeInTheDocument());
    expect(screen.getByText(/1 skipped/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/^Import \(1\)$/i));

    await waitFor(() => expect(dataset.apply).toHaveBeenCalled());
    // The old code called waContactsService.pasteImport(pasteText) with the
    // FULL raw text, which would have written the malformed "12345" row too.
    expect(waContactsService.pasteImport).not.toHaveBeenCalled();

    const itemsPassedToApply = dataset.apply.mock.calls[0][0];
    expect(itemsPassedToApply).toHaveLength(1);
    expect(itemsPassedToApply.every((a) => a.valid)).toBe(true);
    expect(itemsPassedToApply.some((a) => a.rec.whatsapp_number === '+9112345')).toBe(false);
  });
});
