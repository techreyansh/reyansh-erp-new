// Focused RTL tests for ProviderSettings — the CEO/admin-only screen for
// configuring the WhatsApp BSP. The single most important assertion here is
// the credential-KEY assertion: the object passed to upsertProvider().credentials
// must use the EXACT keys supabase/functions/_shared/wa/meta.ts reads
// (access_token / phone_number_id / verify_token), NOT any other naming
// (e.g. NOT webhook_verify_token) — see Task 6's review carry-forward.
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../services/waProviderService', () => {
  const mock = {
    listProviders: jest.fn(),
    getActiveProvider: jest.fn(),
    upsertProvider: jest.fn(),
    setActive: jest.fn(),
    testConnection: jest.fn(),
  };
  return { __esModule: true, default: mock, ...mock };
});

const authorizedPermissions = {
  loading: false,
  authorized: true,
  canEdit: (moduleKey) => moduleKey === 'employees',
};

let mockPermissions = authorizedPermissions;
jest.mock('../../context/PermissionContext', () => ({
  usePermissions: () => mockPermissions,
}));

import waProviderService from '../../services/waProviderService';
import ProviderSettings from './ProviderSettings';

describe('ProviderSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPermissions = authorizedPermissions;
    waProviderService.listProviders.mockResolvedValue([]);
    waProviderService.upsertProvider.mockResolvedValue({
      id: 'prov-1',
      provider_key: 'meta_cloud',
      label: 'Meta WhatsApp Cloud API',
      sender_number: '+919876543210',
      mode: 'live',
      rate_limit_per_minute: 60,
      is_active: false,
      credentials: {},
    });
    waProviderService.setActive.mockResolvedValue({
      id: 'prov-1',
      provider_key: 'meta_cloud',
      is_active: true,
    });
  });

  test('non-CEO/admin users see access-denied, not the credential form', async () => {
    mockPermissions = { loading: false, authorized: true, canEdit: () => false };
    render(<ProviderSettings />);
    await screen.findByText(/Access restricted/i);
    expect(screen.queryByLabelText(/Access Token/i)).not.toBeInTheDocument();
    expect(waProviderService.listProviders).not.toHaveBeenCalled();
  });

  test('saving writes credentials to the exact keys meta.ts reads, and mode toggle works', async () => {
    render(<ProviderSettings />);
    await screen.findByLabelText(/Sender number/i);

    fireEvent.change(screen.getByLabelText(/Sender number/i), { target: { value: '+919876543210' } });
    fireEvent.change(screen.getByLabelText(/^Phone Number ID$/i), { target: { value: '1234567890' } });
    fireEvent.change(screen.getByLabelText(/Business Account ID/i), { target: { value: 'waba-999' } });
    fireEvent.change(screen.getByLabelText(/^Access Token$/i), { target: { value: 'EAA-test-token' } });
    fireEvent.change(screen.getByLabelText(/^Webhook Verify Token$/i), { target: { value: 'my-verify-token' } });

    // Mode toggle: default is Live; switch to Sandbox.
    fireEvent.click(screen.getByRole('button', { name: 'Sandbox' }));

    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => expect(waProviderService.upsertProvider).toHaveBeenCalledTimes(1));
    const payload = waProviderService.upsertProvider.mock.calls[0][0];

    expect(payload.provider_key).toBe('meta_cloud');
    expect(payload.mode).toBe('sandbox');
    expect(payload.sender_number).toBe('+919876543210');

    // THE critical assertion: exact credential keys, matching meta.ts.
    expect(payload.credentials).toEqual({
      access_token: 'EAA-test-token',
      phone_number_id: '1234567890',
      waba_id: 'waba-999',
      verify_token: 'my-verify-token',
    });
    expect(payload.credentials).not.toHaveProperty('webhook_verify_token');
  });

  test('turning on "Set as active provider" calls setActive after save (single-active enforcement)', async () => {
    render(<ProviderSettings />);
    await screen.findByLabelText(/Sender number/i);

    fireEvent.change(screen.getByLabelText(/Sender number/i), { target: { value: '+919876543210' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Set as active provider/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => expect(waProviderService.upsertProvider).toHaveBeenCalledTimes(1));
    // The upsert itself must not blindly set is_active true — single-active
    // is enforced via the dedicated setActive() call, which clears other rows.
    expect(waProviderService.upsertProvider.mock.calls[0][0].is_active).toBe(false);
    await waitFor(() => expect(waProviderService.setActive).toHaveBeenCalledWith('prov-1'));
  });

  test('renders the other 5 providers as disabled "Not available yet" rows', async () => {
    render(<ProviderSettings />);
    await screen.findByLabelText(/Sender number/i);

    const others = ['Twilio', 'Interakt', 'AiSensy', 'WATI', '360dialog'];
    others.forEach((label) => {
      const heading = screen.getByText(label);
      const row = heading.closest('.MuiPaper-root');
      expect(row).not.toBeNull();
      expect(within(row).getByText(/Not available yet/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Not available yet/i).length).toBeGreaterThanOrEqual(5);
  });

  test('test connection button is disabled until the row is saved, then shows the result', async () => {
    waProviderService.listProviders.mockResolvedValue([{
      id: 'prov-2', provider_key: 'meta_cloud', label: 'Meta', sender_number: '+911234567890',
      mode: 'live', rate_limit_per_minute: 60, is_active: false,
      credentials: { access_token: 'tok', phone_number_id: '123' },
    }]);
    waProviderService.testConnection.mockResolvedValue({
      ok: true, reason: null,
      provider: { id: 'prov-2', health_status: 'ok', health_reason: null },
    });

    render(<ProviderSettings />);
    const testBtn = await screen.findByRole('button', { name: /Test connection/i });
    expect(testBtn).toBeEnabled();

    fireEvent.click(testBtn);
    await waitFor(() => expect(waProviderService.testConnection).toHaveBeenCalledWith('prov-2'));
    expect(await screen.findByText(/Connection ready/i)).toBeInTheDocument();
  });

  test('test connection button is disabled when the row has not been saved yet', async () => {
    render(<ProviderSettings />);
    await screen.findByLabelText(/Sender number/i);
    expect(screen.getByRole('button', { name: /Test connection/i })).toBeDisabled();
  });
});
