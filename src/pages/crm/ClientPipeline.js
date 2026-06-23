// Client Pipeline (A Phase 3) — operational drag-drop kanban over the additive
// pipeline_stage field. Cards show owner, health, last activity, next action,
// value. Moving a card logs it. Independent of the lifecycle client_stage.
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Stack, Typography, Chip, CircularProgress, Alert, Snackbar, Avatar, Tooltip,
} from '@mui/material';
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import { listClients, clientHealth, moveClientPipelineStage, listAssignableUsers } from '../../services/crmPipelineService';

const STAGES = [
  { key: 'active', label: 'Active' },
  { key: 'follow_up', label: 'Follow-Up Required' },
  { key: 'quotation', label: 'Quotation' },
  { key: 'order_expected', label: 'Order Expected' },
  { key: 'order_received', label: 'Order Received' },
  { key: 'production', label: 'Production' },
  { key: 'dispatch', label: 'Dispatch Pending' },
  { key: 'repeat_opportunity', label: 'Repeat Opportunity' },
  { key: 'dormant', label: 'Dormant' },
  { key: 'lost', label: 'Lost' },
];
const BAND = { green: 'success', yellow: 'warning', red: 'error' };
const inrK = (n) => { const v = Number(n || 0); return v >= 1e7 ? `₹${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : v ? `₹${v.toLocaleString('en-IN')}` : '—'; };

export default function ClientPipeline() {
  const [clients, setClients] = useState([]);
  const [health, setHealth] = useState({});
  const [names, setNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [drag, setDrag] = useState(null);
  const [snack, setSnack] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cl, hp, users] = await Promise.all([listClients(), clientHealth().catch(() => []), listAssignableUsers().catch(() => [])]);
      const hm = {}; (hp || []).forEach((h) => { hm[String(h.customer_code || '').toLowerCase()] = h; });
      const nm = {}; (users || []).forEach((u) => { nm[(u.email || '').toLowerCase()] = u.full_name || u.name || u.email; });
      setClients(cl || []); setHealth(hm); setNames(nm);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const onDrop = async (stageKey) => {
    if (!drag || drag.pipeline_stage === stageKey) { setDrag(null); return; }
    const id = drag.id;
    setClients((cs) => cs.map((c) => (c.id === id ? { ...c, pipeline_stage: stageKey } : c))); // optimistic
    setDrag(null);
    try { await moveClientPipelineStage(id, stageKey); setSnack(`Moved to ${STAGES.find((s) => s.key === stageKey)?.label}`); }
    catch (e) { setSnack(e.message || 'Move failed'); load(); }
  };

  const colClients = (key) => clients.filter((c) => (c.pipeline_stage || 'active') === key);

  return (
    <Container maxWidth={false} sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <AccountTreeOutlined color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Client Pipeline</Typography>
        <Chip size="small" variant="outlined" label="drag to move" color="primary" />
      </Stack>

      {loading ? <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress /></Stack> : (
        <Box sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 2, alignItems: 'flex-start' }}>
          {STAGES.map((st) => {
            const items = colClients(st.key);
            return (
              <Box key={st.key} onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(st.key)}
                sx={{ minWidth: 250, width: 250, flexShrink: 0, bgcolor: 'action.hover', borderRadius: 2, p: 1 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, px: 0.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1 }}>{st.label}</Typography>
                  <Chip size="small" label={items.length} />
                </Stack>
                <Stack spacing={1}>
                  {items.length === 0 && <Typography variant="caption" color="text.disabled" sx={{ px: 0.5 }}>—</Typography>}
                  {items.map((c) => {
                    const h = health[String(c.customer_code || '').toLowerCase()];
                    return (
                      <Box key={c.id} draggable onDragStart={() => setDrag(c)}
                        sx={{ p: 1, borderRadius: 1.5, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', cursor: 'grab', '&:active': { cursor: 'grabbing' } }}>
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <Typography variant="body2" sx={{ fontWeight: 700, flexGrow: 1, minWidth: 0 }} noWrap>{c.company_name}</Typography>
                          {h && <Tooltip title={`Health ${h.health_score}`}><Chip size="small" color={BAND[h.band]} variant="outlined" label={h.health_score} sx={{ height: 18, '& .MuiChip-label': { px: 0.6, fontSize: '0.62rem' } }} /></Tooltip>}
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace' }}>{c.customer_code || '—'}</Typography>
                        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
                          <Avatar sx={{ width: 18, height: 18, fontSize: 10 }}>{(names[(c.owner_email || '').toLowerCase()] || c.owner_email || 'U')[0]}</Avatar>
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ flexGrow: 1 }}>{names[(c.owner_email || '').toLowerCase()] || (c.owner_email ? c.owner_email.split('@')[0] : 'Unassigned')}</Typography>
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>{inrK(c.annual_potential || c.total_value || c.value)}</Typography>
                        </Stack>
                        {c.next_action && <Typography variant="caption" sx={{ color: 'primary.main', display: 'block', mt: 0.25 }} noWrap>▸ {c.next_action}</Typography>}
                      </Box>
                    );
                  })}
                </Stack>
              </Box>
            );
          })}
        </Box>
      )}

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity="success" variant="filled" onClose={() => setSnack(null)}>{snack}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
