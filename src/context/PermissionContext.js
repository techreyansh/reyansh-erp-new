import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';
import { normalizeModuleKey } from '../config/moduleAccess';

const PermissionContext = createContext(null);

const EMPTY_ACCESS = {
  authorized: false,
  reason: null,
  employee: null,
  role: null,
  modules: [],
};

function normalizeAccess(payload) {
  if (!payload || typeof payload !== 'object') return EMPTY_ACCESS;
  const modules = Array.isArray(payload.modules) ? payload.modules : [];
  return {
    authorized: Boolean(payload.authorized),
    reason: payload.reason || null,
    employee: payload.employee || null,
    role: payload.role || null,
    modules,
  };
}

export function PermissionProvider({ children }) {
  const { user, authLoading } = useAuth();
  const [access, setAccess] = useState(EMPTY_ACCESS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refreshAccess = useCallback(async () => {
    if (!user?.email) {
      setAccess(EMPTY_ACCESS);
      setError(null);
      setLoading(false);
      return EMPTY_ACCESS;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_my_rbac_access');
      if (rpcError) throw rpcError;
      const normalized = normalizeAccess(data);
      setAccess(normalized);
      return normalized;
    } catch (err) {
      console.error('[PermissionContext] Failed to load RBAC access:', err);
      setAccess({ ...EMPTY_ACCESS, reason: 'rbac_load_failed' });
      setError(err);
      return EMPTY_ACCESS;
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useEffect(() => {
    if (authLoading) return undefined;
    let cancelled = false;
    (async () => {
      const next = await refreshAccess();
      if (cancelled) return;
      setAccess(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, refreshAccess]);

  const permissionByModule = useMemo(() => {
    const map = new Map();
    access.modules.forEach((module) => {
      map.set(normalizeModuleKey(module.module_key), module);
    });
    return map;
  }, [access.modules]);

  const roleCode = String(access.role?.code || access.role?.role_name || '').toUpperCase();
  const isCEO = roleCode === 'CEO' || roleCode === 'SUPER_ADMIN';
  const isAdmin = isCEO || roleCode === 'ADMIN';

  const can = useCallback(
    (moduleKey, action = 'view') => {
      if (!moduleKey) return access.authorized;
      if (isCEO) return true;
      const permission = permissionByModule.get(normalizeModuleKey(moduleKey));
      if (!permission) return false;
      const field = `can_${String(action || 'view').toLowerCase()}`;
      return Boolean(permission[field]);
    },
    [access.authorized, isCEO, permissionByModule]
  );

  const value = useMemo(
    () => ({
      ...access,
      loading,
      error,
      isCEO,
      isAdmin,
      roleCode,
      permissionByModule,
      refreshAccess,
      can,
      canView: (moduleKey) => can(moduleKey, 'view'),
      canCreate: (moduleKey) => can(moduleKey, 'create'),
      canEdit: (moduleKey) => can(moduleKey, 'edit'),
      canDelete: (moduleKey) => can(moduleKey, 'delete'),
    }),
    [access, can, error, isAdmin, isCEO, loading, permissionByModule, refreshAccess, roleCode]
  );

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions() {
  const context = useContext(PermissionContext);
  if (!context) {
    throw new Error('usePermissions must be used within PermissionProvider');
  }
  return context;
}

export default PermissionContext;
