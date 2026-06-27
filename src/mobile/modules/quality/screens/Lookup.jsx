// Lookup — open work orders + their recent QC result. cap: quality.lookup.
import React, { useEffect, useState } from 'react';
import { Box, Typography, Card, CardContent, Chip, Stack, CircularProgress } from '@mui/material';
import { listOpenWOs, listQc } from '../service';

const RESULT_COLOR = { pass: 'success', fail: 'error', pending: 'warning' };

export default function Lookup({ api }) {
  const [wos, setWos] = useState(null);
  const [qcByWo, setQcByWo] = useState({});

  useEffect(() => {
    let on = true;
    listOpenWOs(api).then(async (r) => {
      if (!on) return;
      const list = r || [];
      setWos(list);
      const entries = await Promise.all(list.slice(0, 25).map(async (w) => [w.id, (await listQc(api, w.id).catch(() => []))[0] || null]));
      if (on) setQcByWo(Object.fromEntries(entries));
    }).catch(() => on && setWos([]));
    return () => { on = false; };
  }, [api]);

  if (!wos) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>;
  if (!wos.length) return <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No open work orders.</Typography>;

  return (
    <Stack spacing={1}>
      {wos.map((w) => {
        const qc = qcByWo[w.id];
        return (
          <Card key={w.id} variant="outlined">
            <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography sx={{ fontWeight: 700 }}>{w.wo_number}</Typography>
                {qc
                  ? <Chip size="small" color={RESULT_COLOR[qc.result] || 'default'} label={`${qc.check_type || 'qc'}: ${qc.result}`} sx={{ height: 20 }} />
                  : <Chip size="small" variant="outlined" label="no QC yet" sx={{ height: 20 }} />}
              </Stack>
              <Typography variant="caption" color="text.secondary">{w.status} · {Number(w.produced_qty) || 0}/{Number(w.qty) || 0} produced</Typography>
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}
