// WhatsApp Marketing — Provider Settings. CEO/true-admin-only screen for
// configuring the WhatsApp Business Solution Provider (BSP). RLS on
// wa_provider_settings is already a single is_super_admin()-only policy
// (Global Constraints), so a non-admin literally cannot read/write this
// table — but we still gate the UI cleanly here rather than rendering a
// form that would just error out, matching the same client-side check
// src/components/auth/CEOOnlyRoute.js uses to hide Profitability Center /
// Access Audit: usePermissions().canEdit('employees') (that route wrapper's
// own comment: "Access is permission-based: users need the employees
// module, not a CEO role/title").
//
// Meta Cloud API credential keys — CRITICAL, confirmed by reading
// supabase/functions/_shared/wa/meta.ts (the only real WaAdapter in V1):
//   credentials.access_token     — MetaCloudApiAdapter.post(): credentials?.access_token
//   credentials.phone_number_id  — MetaCloudApiAdapter.post(): credentials?.phone_number_id
//   credentials.verify_token     — MetaCloudApiAdapter.verifyWebhookGet(): credentials?.verify_token
//   credentials.waba_id          — NOT read by meta.ts today (no send/webhook path touches it),
//                                   but it's the WhatsApp Business Account id every Meta app setup
//                                   needs on hand, so we still capture it here for completeness/
//                                   future use — writing it does not risk breaking anything meta.ts
//                                   currently reads.
// These are the EXACT object keys written below. Do NOT rename any of them
// (e.g. NOT webhook_verify_token) — the edge functions read these precise
// keys and would silently fail to send/verify otherwise.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, TextField, InputAdornment, IconButton,
  Switch, FormControlLabel, ToggleButtonGroup, ToggleButton, Chip, Alert,
  CircularProgress, Tooltip, Divider,
} from '@mui/material';
import {
  VisibilityOutlined, VisibilityOffOutlined, SaveOutlined, NetworkCheckOutlined,
  RefreshRounded, LockOutlined, WhatsApp,
} from '@mui/icons-material';
import { usePermissions } from '../../context/PermissionContext';
import waProviderService from '../../services/waProviderService';

const OTHER_PROVIDERS = [
  { key: 'twilio', label: 'Twilio' },
  { key: 'interakt', label: 'Interakt' },
  { key: 'aisensy', label: 'AiSensy' },
  { key: 'wati', label: 'WATI' },
  { key: '360dialog', label: '360dialog' },
];

const EMPTY_META = {
  id: null,
  label: 'Meta WhatsApp Cloud API',
  senderNumber: '',
  mode: 'live',
  rateLimit: 60,
  isActive: false,
  accessToken: '',
  phoneNumberId: '',
  wabaId: '',
  verifyToken: '',
};

/** Map a wa_provider_settings row -> the form's field shape. */
function hydrate(row) {
  if (!row) return EMPTY_META;
  const c = row.credentials || {};
  return {
    id: row.id,
    label: row.label || EMPTY_META.label,
    senderNumber: row.sender_number || '',
    mode: row.mode || 'live',
    rateLimit: row.rate_limit_per_minute ?? 60,
    isActive: !!row.is_active,
    accessToken: c.access_token || '',
    phoneNumberId: c.phone_number_id || '',
    wabaId: c.waba_id || '',
    verifyToken: c.verify_token || '',
  };
}

function MaskedField({ label, value, onChange, show, onToggleShow, ...rest }) {
  return (
    <TextField
      label={label}
      type={show ? 'text' : 'password'}
      value={value}
      onChange={onChange}
      fullWidth
      autoComplete="off"
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton size="small" onClick={onToggleShow} edge="end" aria-label={show ? `Hide ${label}` : `Show ${label}`}>
              {show ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
            </IconButton>
          </InputAdornment>
        ),
      }}
      {...rest}
    />
  );
}

export default function ProviderSettings({ notify }) {
  const permissions = usePermissions();
  const [snack, setSnack] = useState(null);
  const say = useCallback((message, severity = 'success') => {
    if (notify) notify(message, severity);
    else setSnack({ message, severity });
  }, [notify]);

  const authorized = permissions.authorized && permissions.canEdit('employees');

  const [loading, setLoading] = useState(true);
  const [metaRow, setMetaRow] = useState(null);
  const [form, setForm] = useState(EMPTY_META);
  const [showToken, setShowToken] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await waProviderService.listProviders();
      const meta = rows.find((r) => r.provider_key === 'meta_cloud') || null;
      setMetaRow(meta);
      setForm(hydrate(meta));
      setTestResult(meta?.health_status ? { ok: meta.health_status === 'ok', reason: meta.health_reason } : null);
    } catch (e) {
      setError(e.message || 'Failed to load provider settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authorized) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized]);

  const setField = (patch) => setForm((f) => ({ ...f, ...patch }));

  const handleSave = async () => {
    if (!form.senderNumber.trim()) { say('Sender number is required', 'warning'); return; }
    setSaving(true);
    try {
      const fields = {
        provider_key: 'meta_cloud',
        label: form.label || EMPTY_META.label,
        sender_number: form.senderNumber.trim(),
        mode: form.mode,
        rate_limit_per_minute: Number(form.rateLimit) || 60,
        // Preserve any credential keys not managed by this form (forward
        // compatibility), then overwrite EXACTLY the keys meta.ts reads.
        credentials: {
          ...(metaRow?.credentials || {}),
          access_token: form.accessToken.trim(),
          phone_number_id: form.phoneNumberId.trim(),
          waba_id: form.wabaId.trim(),
          verify_token: form.verifyToken.trim(),
        },
        // Always write is_active:false here; single-active is enforced
        // exclusively through waProviderService.setActive() below, which
        // clears every other row before flipping this one on.
        is_active: false,
      };
      if (metaRow?.id) fields.id = metaRow.id;

      let saved = await waProviderService.upsertProvider(fields);
      if (form.isActive) {
        saved = await waProviderService.setActive(saved.id);
      }
      setMetaRow(saved);
      setForm(hydrate(saved));
      say('Provider settings saved');
    } catch (e) {
      say(e.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!metaRow?.id) { say('Save the provider row before testing.', 'warning'); return; }
    setTesting(true);
    try {
      const res = await waProviderService.testConnection(metaRow.id);
      setTestResult(res);
      setMetaRow(res.provider);
    } catch (e) {
      say(e.message || 'Test failed', 'error');
    } finally {
      setTesting(false);
    }
  };

  const providerLabel = useMemo(() => (metaRow ? 'Meta Cloud API row saved' : 'Not yet saved'), [metaRow]);

  if (!permissions.loading && !authorized) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <LockOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Access restricted</Typography>
        <Typography variant="body2" color="text.secondary">
          Provider Settings is CEO / super-admin only. Ask an administrator if you need access.
        </Typography>
      </Box>
    );
  }

  if (permissions.loading || loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>Provider Settings</Typography>
        <Tooltip title="Refresh"><span><IconButton onClick={load} disabled={loading}><RefreshRounded /></IconButton></span></Tooltip>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <WhatsApp sx={{ color: 'success.main' }} />
            <Typography variant="overline" sx={{ fontWeight: 800, color: 'text.secondary' }}>Meta WhatsApp Cloud API</Typography>
            <Chip size="small" label={providerLabel} color={metaRow ? 'success' : 'default'} variant="outlined" />
            {metaRow?.is_active && <Chip size="small" label="Active" color="success" />}
          </Stack>
          <FormControlLabel
            control={(
              <Switch
                checked={form.isActive}
                onChange={(e) => setField({ isActive: e.target.checked })}
              />
            )}
            label="Set as active provider"
          />
        </Stack>

        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Label" value={form.label} onChange={(e) => setField({ label: e.target.value })} fullWidth
            />
            <TextField
              label="Sender number" value={form.senderNumber} onChange={(e) => setField({ senderNumber: e.target.value })}
              fullWidth placeholder="+91XXXXXXXXXX"
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Phone Number ID" value={form.phoneNumberId}
              onChange={(e) => setField({ phoneNumberId: e.target.value })} fullWidth
            />
            <TextField
              label="Business Account ID (WABA ID)" value={form.wabaId}
              onChange={(e) => setField({ wabaId: e.target.value })} fullWidth
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <MaskedField
              label="Access Token" value={form.accessToken}
              onChange={(e) => setField({ accessToken: e.target.value })}
              show={showToken} onToggleShow={() => setShowToken((v) => !v)}
            />
            <MaskedField
              label="Webhook Verify Token" value={form.verifyToken}
              onChange={(e) => setField({ verifyToken: e.target.value })}
              show={showVerify} onToggleShow={() => setShowVerify((v) => !v)}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Mode</Typography>
              <ToggleButtonGroup
                size="small" exclusive value={form.mode}
                onChange={(_, v) => v && setField({ mode: v })}
              >
                <ToggleButton value="sandbox">Sandbox</ToggleButton>
                <ToggleButton value="live">Live</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <TextField
              label="Rate limit / minute" type="number" value={form.rateLimit}
              onChange={(e) => setField({ rateLimit: e.target.value })}
              sx={{ width: 180 }}
            />
          </Stack>

          <Divider />

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <Button variant="contained" startIcon={<SaveOutlined />} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              variant="outlined" startIcon={<NetworkCheckOutlined />} onClick={handleTest}
              disabled={testing || !metaRow?.id}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
            {testResult && (
              <Chip
                size="small"
                color={testResult.ok ? 'success' : 'error'}
                label={testResult.ok ? 'Connection ready' : `Not ready: ${testResult.reason || 'unknown reason'}`}
              />
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            "Test connection" is a lightweight readiness check on the saved row (required fields present) — it does not call Meta's API. Real delivery happens via the wa-send edge function.
          </Typography>
        </Stack>
      </Paper>

      <Typography variant="overline" sx={{ fontWeight: 800, color: 'text.secondary', display: 'block', mb: 1 }}>
        Other providers
      </Typography>
      <Stack spacing={1}>
        {OTHER_PROVIDERS.map((p) => (
          <Tooltip key={p.key} title="Not available yet — roadmap for a future release" arrow>
            <Paper
              variant="outlined"
              sx={{ p: 1.5, borderRadius: 2, opacity: 0.55, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}
            >
              <Typography sx={{ fontWeight: 600 }}>{p.label}</Typography>
              <Chip size="small" label="Not available yet" disabled />
            </Paper>
          </Tooltip>
        ))}
      </Stack>

      {!notify && (
        <Alert
          severity={snack?.severity || 'info'}
          sx={{ mt: 2, display: snack ? 'flex' : 'none' }}
          onClose={() => setSnack(null)}
        >
          {snack?.message}
        </Alert>
      )}
    </Box>
  );
}
