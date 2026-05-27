import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../context/PermissionContext';
import { getModuleKeyForPath, getRequiredActionForPath } from '../../config/moduleAccess';

/**
 * Waits for auth + optional Supabase sync (fixes race: getSession has user before React state updates).
 */
const ProtectedRoute = ({ children, moduleKey }) => {
  const { user, authLoading, syncUserFromSupabase } = useAuth();
  const permissions = usePermissions();
  const location = useLocation();
  const [sessionResolved, setSessionResolved] = useState(false);

  useEffect(() => {
    if (authLoading) {
      setSessionResolved(false);
      return undefined;
    }
    if (user) {
      setSessionResolved(true);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      await syncUserFromSupabase();
      if (!cancelled) setSessionResolved(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, syncUserFromSupabase]);

  if (authLoading || permissions.loading || !sessionResolved) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          minHeight: '40vh',
        }}
      >
        <CircularProgress size={32} />
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      </Box>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!permissions.authorized) {
    return <Navigate to="/access-denied" state={{ from: location }} replace />;
  }

  const requiredModule = moduleKey || getModuleKeyForPath(location.pathname);
  if (requiredModule && !permissions.canView(requiredModule)) {
    return <Navigate to="/access-denied" state={{ from: location, reason: 'unauthorized_route' }} replace />;
  }

  const actionRule = getRequiredActionForPath(location.pathname);
  if (actionRule) {
    const { moduleKey: actionModule, action } = actionRule;
    const allowed =
      action === 'create'
        ? permissions.canCreate(actionModule)
        : action === 'edit'
          ? permissions.canEdit(actionModule)
          : action === 'delete'
            ? permissions.canDelete(actionModule)
            : permissions.canView(actionModule);
    if (!allowed) {
      return <Navigate to="/access-denied" state={{ from: location, reason: 'unauthorized_route' }} replace />;
    }
  }

  return children;
};

export default ProtectedRoute;
