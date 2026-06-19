export const MODULE_KEYS = {
  DASHBOARD: 'dashboard',
  CRM: 'crm',
  SALES: 'sales',
  PRODUCTION: 'production',
  INVENTORY: 'inventory',
  DISPATCH: 'dispatch',
  ACCOUNTS: 'accounts',
  EMPLOYEES: 'employees',
  TASKS: 'tasks',
  REPORTS: 'reports',
  SETTINGS: 'settings',
};

export const PUBLIC_PATHS = ['/', '/login', '/access-denied'];

const ROUTE_MODULE_RULES = [
  { test: (path) => path === '/home' || path === '/welcome' || path === '/dashboard', moduleKey: MODULE_KEYS.DASHBOARD },
  { test: (path) => path === '/ceo-command' || path === '/access-management', moduleKey: MODULE_KEYS.EMPLOYEES },
  { test: (path) => path === '/employee-dashboard' || path === '/employees', moduleKey: MODULE_KEYS.EMPLOYEES },
  { test: (path) => path === '/profile' || path === '/help', moduleKey: MODULE_KEYS.DASHBOARD },
  { test: (path) => path === '/settings' || path === '/setup-sheets' || path === '/troubleshoot-sheets' || path === '/storage-debug', moduleKey: MODULE_KEYS.SETTINGS },
  { test: (path) => path.startsWith('/crm'), moduleKey: MODULE_KEYS.CRM },
  { test: (path) => path.startsWith('/sales-flow') || path === '/clients' || path === '/prospects-clients' || path === '/client-orders' || path === '/po-ingestion' || path === '/client-dashboard' || path === '/products', moduleKey: MODULE_KEYS.SALES },
  { test: (path) => path === '/plant-command' || path === '/production-log' || path.startsWith('/ppc') || path.startsWith('/cable-production') || path === '/cable-floor' || path.startsWith('/molding') || path === '/molding-production', moduleKey: MODULE_KEYS.PRODUCTION },
  { test: (path) => path.startsWith('/inventory'), moduleKey: MODULE_KEYS.INVENTORY },
  { test: (path) => path === '/dispatch' || path === '/dispatch-management' || path === '/dispatch-test' || path === '/flow-management', moduleKey: MODULE_KEYS.DISPATCH },
  { test: (path) => path === '/costing', moduleKey: MODULE_KEYS.ACCOUNTS },
  { test: (path) => path === '/vendor-management' || path.startsWith('/purchase-flow'), moduleKey: MODULE_KEYS.INVENTORY },
  { test: (path) => path === '/task-scheduler' || path === '/team-tasks' || path === '/tasks', moduleKey: MODULE_KEYS.TASKS },
  { test: (path) => path === '/my-tasks' || path === '/task-checklist' || path === '/task-compliance-admin' || path === '/checklist-templates', moduleKey: MODULE_KEYS.TASKS },
  { test: (path) => path === '/document-library', moduleKey: MODULE_KEYS.REPORTS },
  { test: (path) => path === '/accountability', moduleKey: MODULE_KEYS.DASHBOARD },
  { test: (path) => path === '/mis' || path.startsWith('/mis/'), moduleKey: MODULE_KEYS.REPORTS },
  { test: (path) => path === '/master-data', moduleKey: MODULE_KEYS.EMPLOYEES },
];

export function getModuleKeyForPath(pathname = '') {
  const cleanPath = pathname || '/';
  if (PUBLIC_PATHS.includes(cleanPath)) return null;
  const match = ROUTE_MODULE_RULES.find((rule) => rule.test(cleanPath));
  return match?.moduleKey || MODULE_KEYS.DASHBOARD;
}

export function normalizeModuleKey(value) {
  return String(value || '').trim().toLowerCase();
}

/** Routes that require more than view permission. */
const ROUTE_ACTION_RULES = [
  { test: (path) => path === '/task-scheduler', moduleKey: MODULE_KEYS.TASKS, action: 'create' },
  { test: (path) => path === '/team-tasks' || path === '/tasks', moduleKey: MODULE_KEYS.TASKS, action: 'edit' },
  { test: (path) => path === '/access-management', moduleKey: MODULE_KEYS.EMPLOYEES, action: 'edit' },
  { test: (path) => path === '/ceo-command', moduleKey: MODULE_KEYS.EMPLOYEES, action: 'edit' },
  { test: (path) => path === '/master-data', moduleKey: MODULE_KEYS.EMPLOYEES, action: 'edit' },
  { test: (path) => path === '/task-compliance-admin', moduleKey: MODULE_KEYS.TASKS, action: 'edit' },
  { test: (path) => path === '/checklist-templates', moduleKey: MODULE_KEYS.TASKS, action: 'edit' },
];

export function getRequiredActionForPath(pathname = '') {
  const cleanPath = pathname || '/';
  const match = ROUTE_ACTION_RULES.find((rule) => rule.test(cleanPath));
  return match || null;
}
