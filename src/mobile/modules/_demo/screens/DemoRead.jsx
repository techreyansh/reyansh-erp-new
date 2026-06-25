// STUB screen: proves offline reads. Reads the mobile_ping_log via api.read(),
// which refreshes the Dexie cache when online and falls back to it when offline.
import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, CircularProgress } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import RecentFeed from '../../../components/RecentFeed';

export default function DemoRead({ api }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.read('mobile_ping_log', {
        select: 'idempotency_key, posted_by, posted_at',
        order: { col: 'posted_at', ascending: false },
        limit: 25,
        cacheAs: 'mobile_ping_log',
      });
      setRows(data || []);
    } catch {
      setRows([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const items = rows.map((r) => ({
    id: r.idempotency_key,
    primary: r.posted_by || 'ping',
    secondary: r.posted_at ? new Date(r.posted_at).toLocaleString() : '',
  }));

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Cached Read (stub)</Typography>
        <Button size="small" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        Reads from the ERP and caches to IndexedDB — opens offline from the last snapshot.
      </Typography>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : (
        <RecentFeed items={items} title="Recent pings" emptyText="No pings yet — submit one from the other screen." />
      )}
    </Box>
  );
}
