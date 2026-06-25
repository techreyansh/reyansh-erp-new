// Lookup — read-only list of open work orders with progress. cap: production.lookup.
import React, { useEffect, useState } from 'react';
import { Box, Typography, Card, CardContent, Chip, Stack, LinearProgress, CircularProgress } from '@mui/material';
import { listOpenWOs } from '../service';

const pct = (w) => {
  const q = Number(w.qty) || 0;
  return q > 0 ? Math.min(100, Math.round(((Number(w.produced_qty) || 0) / q) * 100)) : 0;
};
const STATUS_COLOR = { planned: 'info', released: 'info', in_progress: 'warning', qc: 'secondary', done: 'success' };

export default function Lookup({ api }) {
  const [wos, setWos] = useState(null);
  useEffect(() => { listOpenWOs(api).then((r) => setWos(r || [])).catch(() => setWos([])); }, [api]);

  if (!wos) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>;
  if (!wos.length) return <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No open work orders.</Typography>;

  return (
    <Stack spacing={1}>
      {wos.map((w) => (
        <Card key={w.id} variant="outlined">
          <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography sx={{ fontWeight: 700 }}>{w.wo_number}</Typography>
              <Chip size="small" color={STATUS_COLOR[w.status] || 'default'} label={w.status} sx={{ height: 20 }} />
            </Stack>
            <Typography variant="caption" color="text.secondary">{Number(w.produced_qty) || 0}/{Number(w.qty) || 0} produced</Typography>
            <LinearProgress variant="determinate" value={pct(w)} sx={{ height: 5, borderRadius: 2, mt: 0.5 }} />
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}
