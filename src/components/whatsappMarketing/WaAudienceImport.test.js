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
import WaAudienceImport from './WaAudienceImport';

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

  test('paste import: preview shows a row, then apply calls pasteImport', async () => {
    render(<WaAudienceImport />);
    await waitFor(() => expect(waContactsService.listContacts).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /paste import/i }));
    const textarea = screen.getByPlaceholderText(/Ravi Sharma, 9876543210/i);
    fireEvent.change(textarea, { target: { value: '9876543210' } });
    fireEvent.click(screen.getByRole('button', { name: /^preview$/i }));

    await waitFor(() => expect(screen.getByText(/^Import \(1\)$/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/^Import \(1\)$/i));

    await waitFor(() => expect(waContactsService.pasteImport).toHaveBeenCalledWith('9876543210'));
  });
});
