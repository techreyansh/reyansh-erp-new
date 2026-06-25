import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Stack, Card, CardContent, Typography, TextField, MenuItem, IconButton, Chip, Tooltip,
  CircularProgress, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  useTheme, alpha,
} from '@mui/material';
import { Balance as BalanceIcon, Refresh as RefreshIcon, WarningAmber as WarnIcon } from '@mui/icons-material';
import mesService from '../../services/mesService';

const round = (n) => Math.round((Number(n) || 0));

const LineBalancing = () => {
  const theme = useTheme();
  const [ops, setOps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState('assembly');
  const [targetRate, setTargetRate] = useState(200);

  const load = useCallback(async () => {
    setLoading(true);
    try { setOps(await mesService.listOperations({ includeInactive: false })); }
    catch { setOps([]); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const line = useMemo(() => {
    const rows = ops
      .filter((o) => (cat === 'all' || o.category === cat) && Number(o.std_time_sec) > 0)
      .map((o) => {
        const uph = 3600 / Number(o.std_time_sec);            // per operator (STD time -> UPH)
        const opsNeeded = Math.max(1, Math.ceil(targetRate / uph));
        const throughput = opsNeeded * uph;                   // balanced station throughput
        return { ...o, uph: round(uph), opsNeeded, throughput: round(throughput) };
      })
      .sort((a, b) => a.uph - b.uph); // slowest first
    const minUph = rows.length ? Math.min(...rows.map((r) => r.uph)) : 0;
    const totalMen = rows.reduce((s, r) => s + r.opsNeeded, 0);
    return { rows: rows.map((r) => ({ ...r, bottleneck: r.uph === minUph })), totalMen, minUph };
  }, [ops, cat, targetRate]);

  const bn = line.rows.find((r) => r.bottleneck);

  return (
    <Box sx={{ p: 3 }}>
      <Card sx={{ background: `linear-gradient(135deg, ${theme.palette.secondary.main} 0%, ${theme.palette.secondary.dark} 100%)`, color: 'white', borderRadius: 3, mb: 2 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, py: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <BalanceIcon sx={{ fontSize: 32 }} />
            <Box><Typography variant="h5" sx={{ fontWeight: 700 }}>Line Balancing</Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>UPH from STD time → find the bottleneck → man it to free the line.</Typography></Box>
          </Box>
          <Tooltip title="Reload operations"><IconButton onClick={load} sx={{ color: 'white' }}><RefreshIcon /></IconButton></Tooltip>
        </CardContent>
      </Card>

      <Card sx={{ borderRadius: 2, mb: 2 }}><CardContent>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
          <TextField type="number" label="Target line rate (pcs/hr)" value={targetRate} onChange={(e) => setTargetRate(Number(e.target.value) || 0)} sx={{ width: 200 }} />
          <TextField select label="Section" value={cat} onChange={(e) => setCat(e.target.value)} sx={{ width: 160 }}>
            {['assembly', 'molding', 'packing', 'testing', 'all'].map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </TextField>
          <Typography variant="body2" color="text.secondary">Total manpower to balance: <b>{line.totalMen}</b> operators</Typography>
        </Stack>
      </CardContent></Card>

      {loading ? <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box> : line.rows.length === 0 ? (
        <Card sx={{ borderRadius: 2 }}><CardContent sx={{ textAlign: 'center', py: 6 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>No operations with a STD time</Typography>
          <Typography variant="body2" color="text.secondary">Set STD time on operations in MES Setup → Assembly Operations; UPH and the bottleneck compute from it.</Typography>
        </CardContent></Card>
      ) : (
        <>
          {bn && (
            <Card sx={{ borderRadius: 2, mb: 2, border: '1px solid', borderColor: 'error.main', bgcolor: alpha(theme.palette.error.main, 0.05) }}><CardContent sx={{ py: 1.5 }}>
              <Typography variant="body1" sx={{ fontWeight: 600, color: 'error.main' }}>
                <WarnIcon sx={{ verticalAlign: 'middle', mr: 0.5 }} fontSize="small" /> Bottleneck: <b>{bn.name}</b> — slowest at {bn.uph}/hr per operator.
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                To run the line at {targetRate}/hr it needs <b>{bn.opsNeeded} operator{bn.opsNeeded > 1 ? 's' : ''}</b> (it gives {bn.throughput}/hr with that crew). Man it up — that frees the bottleneck and every station keeps pace.
              </Typography>
            </CardContent></Card>
          )}
          <Card sx={{ borderRadius: 2 }}><CardContent>
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
              <Table size="small">
                <TableHead><TableRow>{['Operation', 'STD (s)', 'UPH / operator', 'Operators to balance', 'Station throughput', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {line.rows.map((r) => (
                    <TableRow key={r.id} hover sx={{ bgcolor: r.bottleneck ? alpha(theme.palette.error.main, 0.06) : 'inherit' }}>
                      <TableCell sx={{ fontWeight: 600 }}>{r.name}</TableCell>
                      <TableCell>{r.std_time_sec}</TableCell>
                      <TableCell><Chip size="small" label={`${r.uph}/hr`} variant="outlined" color={r.bottleneck ? 'error' : 'default'} sx={{ height: 20 }} /></TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{r.opsNeeded}</TableCell>
                      <TableCell>{r.throughput}/hr {r.throughput >= targetRate && <Chip size="small" color="success" label="meets rate" sx={{ height: 18, ml: 0.5 }} />}</TableCell>
                      <TableCell>{r.bottleneck && <Chip size="small" color="error" icon={<WarnIcon />} label="bottleneck" sx={{ height: 22 }} />}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              UPH = 3600 ÷ STD time (per operator). Operators-to-balance = ⌈ target rate ÷ UPH ⌉ — staffing each station so it keeps up with the line, which is how the bottleneck is freed.
            </Typography>
          </CardContent></Card>
        </>
      )}
    </Box>
  );
};

export default LineBalancing;
