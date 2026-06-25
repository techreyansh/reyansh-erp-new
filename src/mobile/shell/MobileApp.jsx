// Factory Ops App root, mounted at /app/* (already behind ProtectedRouteGate in
// App.js, so auth + dashboard-module RBAC are enforced before we get here).
//
// Responsibilities:
//   - resolve mobile access (RBAC modules + capabilities) via useMobileAccess
//   - own one useSync instance shared with the shell badge
//   - route: Home → Module screen list → active screen; plus bottom-nav stubs.
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';
import AppShell from './AppShell';
import Home from './Home';
import ModuleRouter from './ModuleRouter';
import useMobileAccess from '../core/useMobileAccess';
import useSync from '../core/sync/useSync';

function PlaceholderScreen({ title, note }) {
  return (
    <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>{title}</Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>{note || 'Lands with a future module.'}</Typography>
    </Box>
  );
}

export default function MobileApp() {
  const { access, caps, loading } = useMobileAccess();
  const sync = useSync();

  if (loading) {
    return (
      <AppShell sync={sync}>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress />
        </Box>
      </AppShell>
    );
  }

  return (
    <AppShell sync={sync}>
      <Routes>
        <Route index element={<Home access={access} caps={caps} />} />
        <Route path="my-tasks" element={<PlaceholderScreen title="My Tasks" note="Task inbox arrives with the Tasks module." />} />
        <Route path="scan" element={<PlaceholderScreen title="Scan" note="Global scanner lands with the Store module." />} />
        <Route path="approvals" element={<PlaceholderScreen title="Approvals" note="Approvals inbox is a separate spec." />} />
        <Route path="notifications" element={<PlaceholderScreen title="Notifications" note="Push notifications are a separate spec." />} />
        <Route path=":moduleKey" element={<ModuleRouter access={access} caps={caps} />} />
        <Route path=":moduleKey/:screenKey" element={<ModuleRouter access={access} caps={caps} />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </AppShell>
  );
}
