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
      // Resilient load: a single transient failure (a briefly-expired access token,
      // or a Supabase/PostgREST hiccup) must NOT lock a valid user out. Retry up to
      // 3 times, refreshing the auth session between attempts so an expired token is
      // renewed before we declare access "unverified".
      let data = null;
      let rpcError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        ({ data, error: rpcError } = await supabase.rpc('get_my_rbac_access'));
        if (!rpcError) break;
        try { await supabase.auth.refreshSession(); } catch { /* ignore — retry anyway */ }
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
      }
      if (rpcError) throw rpcError;
      const normalized = normalizeAccess(data);
      if (process.env.NODE_ENV === 'development') {
        console.log('Current user:', user);
        console.log('Permissions:', normalized);
      }
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
      await refreshAccess();
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

  const can = useCallback(
    (moduleKey, action = 'view') => {
      if (!moduleKey) return access.authorized;
      const permission = permissionByModule.get(normalizeModuleKey(moduleKey));
      if (!permission) return false;
      const field = `can_${String(action || 'view').toLowerCase()}`;
      return Boolean(permission[field]);
    },
    [access.authorized, permissionByModule]
  );

  const hasFullAccess = useMemo(
    () =>
      access.authorized &&
      access.modules.length > 0 &&
      access.modules.every(
        (module) =>
          module.can_view === true &&
          module.can_create === true &&
          module.can_edit === true &&
          module.can_delete === true
      ),
    [access.authorized, access.modules]
  );

  const canManageEmployees =
    can('employees', 'create') || can('employees', 'edit') || can('employees', 'delete');
  const canManageTasks =
    can('tasks', 'create') || can('tasks', 'edit') || can('tasks', 'delete');

  const roleCode = String(access.role?.code || access.role?.role_name || '').toUpperCase();

  const canView = useCallback((moduleKey) => can(moduleKey, 'view'), [can]);
  const canCreate = useCallback((moduleKey) => can(moduleKey, 'create'), [can]);
  const canEdit = useCallback((moduleKey) => can(moduleKey, 'edit'), [can]);
  const canDelete = useCallback((moduleKey) => can(moduleKey, 'delete'), [can]);

  const getPermission = useCallback(
    (moduleKey) => permissionByModule.get(normalizeModuleKey(moduleKey)) || null,
    [permissionByModule]
  );

  const allowedModules = useMemo(
    () => access.modules.filter((module) => module.can_view === true),
    [access.modules]
  );

  const allowedModuleKeys = useMemo(
    () => allowedModules.map((module) => normalizeModuleKey(module.module_key)),
    [allowedModules]
  );

  const value = useMemo(
    () => ({
      ...access,
      loading,
      error,
      hasFullAccess,
      canManageEmployees,
      canManageTasks,
      roleCode,
      permissionByModule,
      allowedModules,
      allowedModuleKeys,
      refreshAccess,
      can,
      canView,
      canCreate,
      canEdit,
      canDelete,
      getPermission,
    }),
    [
      access,
      can,
      canCreate,
      canDelete,
      canEdit,
      canManageEmployees,
      canManageTasks,
      canView,
      allowedModuleKeys,
      allowedModules,
      error,
      getPermission,
      hasFullAccess,
      loading,
      permissionByModule,
      refreshAccess,
      roleCode,
    ]
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
