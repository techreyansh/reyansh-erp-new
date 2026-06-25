export const MODULE_KEYS = {
  DASHBOARD: 'dashboard',
  CRM: 'crm',
  SALES: 'sales',
  PRODUCTION: 'production',
  INVENTORY: 'inventory',
  PURCHASE: 'purchase',
  QUALITY: 'quality',
  DISPATCH: 'dispatch',
  ACCOUNTS: 'accounts',
  EMPLOYEES: 'employees',
  TASKS: 'tasks',
  REPORTS: 'reports',
  SETTINGS: 'settings',
  NPD: 'npd',
};

/**
 * Human-readable list of the main screens each module unlocks. Shown under each
 * row in the employee Access & Permissions matrix so an admin can see exactly
 * what a toggle controls. Keep in sync with ROUTE_MODULE_RULES below — these are
 * the same groupings, labeled for non-technical admins. A `MODULE_KEYS` value
 * with no entry here falls back to the generic "Visible after login" caption.
 */
export const MODULE_UNLOCKS = {
  [MODULE_KEYS.DASHBOARD]: ['Home / My Day', 'Dashboards', 'Operations Tower', 'Profile'],
  [MODULE_KEYS.CRM]: ['CRM Pipeline (Prospects & Clients)', 'KIT', 'Collections', 'Email Campaigns'],
  [MODULE_KEYS.SALES]: ['Sales Flow', 'Client Orders', 'Sales Orders', 'Products', 'Demand Forecast'],
  [MODULE_KEYS.PRODUCTION]: ['PPC', 'Cable Production', 'Molding', 'Production Log', 'Plant Command'],
  [MODULE_KEYS.INVENTORY]: ['Inventory', 'Material Control', 'MRP'],
  [MODULE_KEYS.PURCHASE]: ['Purchase Flow', 'Purchase Requisitions', 'Vendors'],
  [MODULE_KEYS.QUALITY]: ['Quality'],
  [MODULE_KEYS.DISPATCH]: ['Dispatch Control', 'Dispatch Management', 'Flow Management'],
  [MODULE_KEYS.ACCOUNTS]: ['Invoicing', 'Cost Control', 'Costing'],
  [MODULE_KEYS.EMPLOYEES]: ['Employee Management', 'Master Data', 'Access'],
  [MODULE_KEYS.TASKS]: ['Tasks', 'Team Tasks', 'Task Scheduler', 'My Tasks', 'Checklists'],
  [MODULE_KEYS.REPORTS]: ['MIS', 'Performance Review', 'Document Library'],
  [MODULE_KEYS.SETTINGS]: ['Settings'],
  [MODULE_KEYS.NPD]: ['NPD Projects', 'Product Development Workspace', 'Stage Gates', 'Approvals'],
};

export const PUBLIC_PATHS = ['/', '/login', '/access-denied'];

const ROUTE_MODULE_RULES = [
  { test: (path) => path === '/home' || path === '/welcome' || path === '/dashboard' || path === '/operations-tower', moduleKey: MODULE_KEYS.DASHBOARD },
  { test: (path) => path === '/ceo-command' || path === '/access-management', moduleKey: MODULE_KEYS.EMPLOYEES },
  { test: (path) => path === '/employee-dashboard' || path === '/employee-management', moduleKey: MODULE_KEYS.EMPLOYEES },
  { test: (path) => path === '/profile' || path === '/help', moduleKey: MODULE_KEYS.DASHBOARD },
  { test: (path) => path === '/settings' || path === '/setup-sheets' || path === '/troubleshoot-sheets' || path === '/storage-debug', moduleKey: MODULE_KEYS.SETTINGS },
  { test: (path) => path.split('?')[0].startsWith('/crm-pipeline'), moduleKey: MODULE_KEYS.CRM },
  { test: (path) => path.startsWith('/crm'), moduleKey: MODULE_KEYS.CRM },
  { test: (path) => path.startsWith('/kit'), moduleKey: MODULE_KEYS.CRM },
  { test: (path) => path.startsWith('/sales-flow') || path === '/clients' || path === '/prospects-clients' || path === '/client-orders' || path === '/po-ingestion' || path === '/client-dashboard' || path === '/products' || path === '/product-master' || path === '/sales-orders', moduleKey: MODULE_KEYS.SALES },
  { test: (path) => path === '/plant-command' || path === '/production-log' || path === '/production-intelligence' || path === '/assembly-operations' || path === '/job-cards' || path === '/mes-setup' || path === '/mes-dashboard' || path === '/daily-plan' || path === '/capacity-planner' || path === '/line-balancing' || path === '/production-demand' || path.startsWith('/ppc') || path.startsWith('/cable-production') || path === '/cable-floor' || path.startsWith('/molding') || path === '/molding-production', moduleKey: MODULE_KEYS.PRODUCTION },
  { test: (path) => path.startsWith('/inventory') || path === '/mrp', moduleKey: MODULE_KEYS.INVENTORY },
  { test: (path) => path === '/demand-forecast' || path === '/portal-admin', moduleKey: MODULE_KEYS.SALES },
  { test: (path) => path.startsWith('/temp/'), moduleKey: MODULE_KEYS.PRODUCTION },
  { test: (path) => path === '/dispatch' || path === '/dispatch-management' || path === '/dispatch-test' || path === '/dispatch-control' || path === '/flow-management', moduleKey: MODULE_KEYS.DISPATCH },
  { test: (path) => path === '/costing' || path === '/invoicing' || path === '/cost-control', moduleKey: MODULE_KEYS.ACCOUNTS },
  { test: (path) => path === '/vendor-management' || path.startsWith('/purchase-flow') || path === '/purchase-requisitions', moduleKey: MODULE_KEYS.PURCHASE },
  { test: (path) => path === '/quality' || path.startsWith('/quality/'), moduleKey: MODULE_KEYS.QUALITY },
  { test: (path) => path === '/task-scheduler' || path === '/team-tasks' || path === '/tasks', moduleKey: MODULE_KEYS.TASKS },
  { test: (path) => path === '/my-tasks' || path === '/task-checklist' || path === '/task-compliance-admin' || path === '/checklist-templates', moduleKey: MODULE_KEYS.TASKS },
  { test: (path) => path === '/document-library', moduleKey: MODULE_KEYS.REPORTS },
  { test: (path) => path === '/accountability', moduleKey: MODULE_KEYS.DASHBOARD },
  { test: (path) => path === '/mis' || path.startsWith('/mis/'), moduleKey: MODULE_KEYS.REPORTS },
  { test: (path) => path === '/performance' || path.startsWith('/performance/'), moduleKey: MODULE_KEYS.REPORTS },
  { test: (path) => path === '/master-data', moduleKey: MODULE_KEYS.EMPLOYEES },
  { test: (path) => path === '/access-preview', moduleKey: MODULE_KEYS.EMPLOYEES },
  { test: (path) => path.startsWith('/npd'), moduleKey: MODULE_KEYS.NPD },
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
  { test: (path) => path === '/access-management' || path === '/employee-management', moduleKey: MODULE_KEYS.EMPLOYEES, action: 'edit' },
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
