// Mobile chrome: top app bar (title + OfflineBadge) and bottom navigation
// (Home · My Tasks · Scan · Approvals · Notifications). Pure layout — routing is
// handled by the nested <MobileApp> routes that render into `children`.
import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AppBar, Toolbar, Typography, Box, IconButton, BottomNavigation,
  BottomNavigationAction, Paper,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import AssignmentIcon from '@mui/icons-material/Assignment';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import NotificationsIcon from '@mui/icons-material/Notifications';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import OfflineBadge from '../components/OfflineBadge';

const NAV = [
  { key: 'home', label: 'Home', icon: <HomeIcon />, path: '/app' },
  { key: 'tasks', label: 'My Tasks', icon: <AssignmentIcon />, path: '/app/my-tasks' },
  { key: 'scan', label: 'Scan', icon: <QrCodeScannerIcon />, path: '/app/scan' },
  { key: 'approvals', label: 'Approvals', icon: <FactCheckIcon />, path: '/app/approvals' },
  { key: 'alerts', label: 'Alerts', icon: <NotificationsIcon />, path: '/app/notifications' },
];

export default function AppShell({ title = 'Factory Ops', sync, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const atHome = location.pathname === '/app' || location.pathname === '/app/';

  const activeIndex = (() => {
    const idx = NAV.findIndex((n) => n.path !== '/app' && location.pathname.startsWith(n.path));
    if (idx >= 0) return idx;
    return atHome ? 0 : -1;
  })();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 1 }}>
          {!atHome && (
            <IconButton edge="start" onClick={() => navigate(-1)} aria-label="Back">
              <ArrowBackIcon />
            </IconButton>
          )}
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }} noWrap>{title}</Typography>
          <OfflineBadge sync={sync} />
        </Toolbar>
      </AppBar>

      <Box component="main" sx={{ flex: 1, p: 2, pb: 10, maxWidth: 480, width: '100%', mx: 'auto' }}>
        {children}
      </Box>

      <Paper elevation={3} sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 10 }}>
        <BottomNavigation
          showLabels
          value={activeIndex}
          onChange={(_, idx) => NAV[idx] && navigate(NAV[idx].path)}
        >
          {NAV.map((n) => (
            <BottomNavigationAction key={n.key} label={n.label} icon={n.icon} />
          ))}
        </BottomNavigation>
      </Paper>
    </Box>
  );
}
