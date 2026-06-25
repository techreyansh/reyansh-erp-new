import React, { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionContext';
import ceoDashboardAccessLog from '../../services/ceoDashboardAccessLog';
import { rememberIntendedPath } from '../../lib/postLoginRedirect';

/**
 * Compatibility guard for the executive area. Access is permission-based:
 * users need the employees module, not a CEO role/title.
 */
const CEOOnlyRoute = ({ children }) => {
  const { user, role, loading: authLoading } = useAuth();
  const permissions = usePermissions();
  const location = useLocation();
  const logged = useRef(false);

  useEffect(() => {
    if (authLoading || permissions.loading || !user) return;
    const granted = permissions.canEdit('employees');
    if (!logged.current) {
      ceoDashboardAccessLog.logAccessAttempt({
        granted,
        userId: user.email ?? user.id,
        userRole: permissions.role?.role_name || role || null,
      });
      logged.current = true;
    }
  }, [authLoading, permissions, role, user]);

  if (authLoading || permissions.loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '40vh' }}>
        <Typography variant="body2" color="text.secondary">Checking access...</Typography>
      </Box>
    );
  }

  if (!user) {
    rememberIntendedPath(location.pathname + location.search);
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!permissions.authorized) {
    return <Navigate to="/access-denied" state={{ from: location }} replace />;
  }

  if (!permissions.canEdit('employees')) {
    return <Navigate to="/access-denied" state={{ from: location, reason: 'unauthorized_route' }} replace />;
  }

  return children;
};

export default CEOOnlyRoute;
