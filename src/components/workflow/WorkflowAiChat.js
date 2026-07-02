// Reusable AI chat card over the order workflow. Pass the preset tools and a
// getContext() returning the context blob (wf_dashboard for cross-order, or a
// getWorkflow() payload for one order). Clones the Production Intelligence chat
// UX. Self-contained; safe to drop onto any workflow page.
import React, { useState, useCallback } from 'react';
import {
  Box, Card, CardContent, Stack, Typography, Chip, TextField, Button, Alert, CircularProgress, alpha, useTheme,
} from '@mui/material';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import workflowAiService from '../../services/workflowAiService';

export default function WorkflowAiChat({
  presets = [],
  getContext,
  title = 'Ask the workflow AI',
  hint = 'Answered over the current workflow data.',
  placeholder = 'Ask e.g. “Which orders are most at risk?”',
}) {
  const theme = useTheme();
  const [chat, setChat] = useState([]); // {role:'user'|'ai', text?, sections?, error?}
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const send = useCallback(async (tool, label) => {
    if (busy) return;
    const userText = label || q.trim();
    if (!userText) return;
    const ctx = (typeof getContext === 'function' ? getContext() : getContext) || {};
    setChat((c) => [...c, { role: 'user', text: userText }]);
    if (!tool) setQ('');
    setBusy(true);
    const res = await workflowAiService.askWorkflow(tool || 'ask', tool ? '' : userText, ctx);
    setChat((c) => [...c, { role: 'ai', sections: res.sections, error: res.error }]);
    setBusy(false);
  }, [busy, q, getContext]);

  return (
    <Card variant="outlined" sx={{ borderRadius: 2.5, borderColor: alpha(theme.palette.secondary.main, 0.35) }}><CardContent>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <AutoAwesomeOutlined color="secondary" fontSize="small" />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{title}</Typography>
        <Typography variant="caption" color="text.secondary">{hint}</Typography>
      </Stack>
      {presets.length > 0 && (
        <Stack direction="row" spacing={0.75} sx={{ mb: 1.5, flexWrap: 'wrap' }} useFlexGap>
          {presets.map((p) => (
            <Chip key={p.tool} label={p.label} size="small" variant="outlined" disabled={busy}
              onClick={() => send(p.tool, p.label)} sx={{ cursor: 'pointer' }} />
          ))}
        </Stack>
      )}
      {chat.length > 0 && (
        <Stack spacing={1.5} sx={{ mb: 1.5, maxHeight: 440, overflow: 'auto' }}>
          {chat.map((m, i) => (m.role === 'user' ? (
            <Box key={i} sx={{ alignSelf: 'flex-end', maxWidth: '85%', bgcolor: alpha(theme.palette.primary.main, 0.1), px: 1.5, py: 0.75, borderRadius: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.text}</Typography>
            </Box>
          ) : (
            <Box key={i} sx={{ alignSelf: 'flex-start', maxWidth: '92%' }}>
              {m.error ? <Alert severity="info">{m.error}</Alert> : (m.sections || []).map((s, j) => (
                <Box key={j} sx={{ mb: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>{s.heading}</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{s.body}</Typography>
                </Box>
              ))}
            </Box>
          )))}
          {busy && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={16} /><Typography variant="caption" color="text.secondary">Thinking…</Typography></Stack>}
        </Stack>
      )}
      <Stack direction="row" spacing={1}>
        <TextField size="small" fullWidth placeholder={placeholder} value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && q.trim() && !busy) send(); }} disabled={busy} />
        <Button variant="contained" onClick={() => send()} disabled={busy || !q.trim()}>Ask</Button>
      </Stack>
    </CardContent></Card>
  );
}
