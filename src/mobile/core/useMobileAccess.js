// Resolves what the current user can see in the Factory Ops App:
//   - modules  : the RBAC module list (reused from PermissionContext — get_my_rbac_access)
//   - caps     : the mobile capability set (get_my_capabilities)
//
// RBAC is reused from the existing PermissionProvider so we don't double-call the RPC.
// Capabilities are mobile-specific, so we fetch them here once per session.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { usePermissions } from '../../context/PermissionContext';
import { normalizeCaps } from './capabilities';

export function useMobileAccess() {
  const permissions = usePermissions();
  const access = {
    authorized: permissions.authorized,
    modules: permissions.modules || [],
    role: permissions.role || null,
    employee: permissions.employee || null,
  };

  const [caps, setCaps] = useState([]);
  const [capsLoading, setCapsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCapsLoading(true);
      try {
        const { data, error } = await supabase.rpc('get_my_capabilities');
        if (error) throw error;
        if (!cancelled) setCaps(normalizeCaps(data));
      } catch (err) {
        // capability RPC may not be deployed yet — degrade gracefully to "no caps"
        if (process.env.NODE_ENV === 'development') {
          console.warn('[useMobileAccess] get_my_capabilities unavailable:', err?.message || err);
        }
        if (!cancelled) setCaps([]);
      } finally {
        if (!cancelled) setCapsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    access,
    modules: access.modules,
    caps,
    loading: Boolean(permissions.loading) || capsLoading,
  };
}

export default useMobileAccess;
