import React, { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionContext';
import ceoDashboardAccessLog from '../../services/ceoDashboardAccessLog';

/**
 * Route guard: Renders children ONLY for CEO role.
 * Non-CEO users get "Access Denied – Insufficient Privileges" (no redirect, no leak of route purpose).
 * All access attempts are logged. Backend must validate CEO role server-side when APIs exist.
 */
const CEOOnlyRoute = ({ children }) => {
  const { user, role, loading: authLoading } = useAuth();
  const permissions = usePermissions();
  const location = useLocation();
  const logged = useRef(false);

  useEffect(() => {
    if (authLoading || permissions.loading || !user) return;
    const granted = permissions.isCEO || role === 'CEO';
    if (!logged.current) {
      ceoDashboardAccessLog.logAccessAttempt({
        granted,
        userId: user.email ?? user.id,
        userRole: permissions.role?.role_name || role || null,
      });
      logged.current = true;
    }
  }, [authLoading, permissions.isCEO, permissions.loading, permissions.role, role, user]);

  if (authLoading || permissions.loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '40vh' }}>
        <Typography variant="body2" color="text.secondary">Checking access...</Typography>
      </Box>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!permissions.authorized) {
    return <Navigate to="/access-denied" state={{ from: location }} replace />;
  }

  if (!permissions.isCEO && role !== 'CEO') {
    return <Navigate to="/access-denied" state={{ from: location, reason: 'unauthorized_route' }} replace />;
  }

  return children;
};

export default CEOOnlyRoute;
