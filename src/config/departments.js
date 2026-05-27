/** Standard ERP departments for access and task assignment. */
export const DEPARTMENT_OPTIONS = [
  'Sales',
  'CRM',
  'Production',
  'Inventory',
  'Accounts',
  'HR',
  'Dispatch',
  'Management',
];

export function normalizeDepartment(value) {
  return String(value || '').trim();
}
