/**
 * Master Data catalog — the single source of truth for every master/reference
 * entity in the ERP. The Master Data Hub renders this; each entity either links
 * out to its rich manager (managerRoute) or is managed inline by MasterDataGrid.
 *
 * `table` is the PHYSICAL Supabase table (db.js getTableRows flattens the
 * `record` jsonb up to top level, so all fields below are top-level).
 * `title`/`code`/`subtitle`/`status` are candidate-key arrays — the first key
 * present on a row wins (shapes vary across tables).
 */

export const MASTER_CATEGORIES = [
  { key: 'partners',   label: 'Business Partners', icon: 'Handshake',  hint: 'Who we buy from and sell to' },
  { key: 'items',      label: 'Items & Products',  icon: 'Inventory2', hint: 'What we make, buy and ship' },
  { key: 'people',     label: 'People & Access',   icon: 'Groups',     hint: 'Team, roles and permissions' },
  { key: 'production', label: 'Production Assets',  icon: 'Factory',    hint: 'Machines and production masters' },
  { key: 'reference',  label: 'Reference Data',    icon: 'Tune',       hint: 'Lists everything else points at' },
];

export const MASTER_ENTITIES = [
  // ---------------- Business Partners ----------------
  {
    key: 'clients', label: 'Clients', category: 'partners', icon: 'Business',
    description: 'Customers we sell to — billing, GST, contacts, terms.',
    table: 'clients2', managerRoute: '/clients',
    title: ['ClientName'], code: ['ClientCode'], subtitle: ['City', 'State'], status: ['Status'],
  },
  {
    key: 'prospects', label: 'Prospects', category: 'partners', icon: 'PersonSearch',
    description: 'Leads and prospective clients not yet converted.',
    table: 'prospects_clients', managerRoute: '/prospects-clients',
    title: ['ClientName', 'ProspectName', 'Name', 'CompanyName'],
    code: ['ProspectCode', 'ClientCode'], subtitle: ['City', 'State'], status: ['Status'],
  },
  {
    key: 'vendors', label: 'Vendors / Suppliers', category: 'partners', icon: 'LocalShipping',
    description: 'Suppliers of raw material, components and services.',
    table: 'vendors_data', managerRoute: '/vendor-management',
    title: ['VendorName'], code: ['VendorCode'], subtitle: ['City', 'Category'], status: ['Status'],
  },

  // ---------------- Items & Products ----------------
  {
    key: 'products', label: 'Products', category: 'items', icon: 'Cable',
    description: 'Finished products and SKUs sold to customers.',
    table: 'products', managerRoute: '/products',
    title: ['name', 'ProductName'], code: ['code', 'ProductCode'],
    subtitle: ['description', 'ProductType'], status: ['Status'],
  },
  {
    key: 'cable_products', label: 'Cable Products', category: 'items', icon: 'SettingsInputComponent',
    description: 'Cable specifications — gauge, cores, insulation, ratings.',
    table: 'cable_products',
    title: ['CableProductName', 'Name', 'ProductName'], code: ['CableProductCode', 'Code'],
    subtitle: ['Specification', 'Description'],
    addFields: ['CableProductCode', 'CableProductName', 'Specification', 'Description'],
  },
  {
    key: 'bom', label: 'Bill of Materials', category: 'items', icon: 'AccountTree',
    description: 'BOM templates — components and quantities per product.',
    table: 'bom_templates', managerRoute: '/inventory/bill-of-materials',
    title: ['BOMName', 'ProductName', 'Name'], code: ['BOMCode', 'Code'], subtitle: ['ProductCode'],
  },
  {
    key: 'finished_goods', label: 'Finished Goods', category: 'items', icon: 'Inventory',
    description: 'Finished-goods master used by the FG store.',
    table: 'finished_goods', managerRoute: '/inventory/finished-goods',
    title: ['FGName', 'ProductName', 'Name'], code: ['FGCode', 'Code'], subtitle: ['Category'],
  },

  // ---------------- People & Access ----------------
  {
    key: 'employees', label: 'Employees', category: 'people', icon: 'Badge',
    description: 'Team master — codes, departments, designations, contacts.',
    table: 'employees_data', managerRoute: '/employee-dashboard',
    title: ['EmployeeName', 'Name'], code: ['EmployeeCode'],
    subtitle: ['Designation', 'Department'], status: ['Status'],
  },
  {
    key: 'roles', label: 'Roles', category: 'people', icon: 'AdminPanelSettings',
    description: 'RBAC roles referenced by every permission check.',
    table: 'roles', managerRoute: '/access-management',
    title: ['role_name', 'name', 'RoleName'], code: ['code', 'RoleCode'], subtitle: ['description'],
  },

  // ---------------- Production Assets ----------------
  {
    key: 'machines', label: 'Machines', category: 'production', icon: 'PrecisionManufacturing',
    description: 'Machine master — capacity, line, scheduling reference.',
    table: 'machine_schedules',
    title: ['MachineName', 'Machine', 'Name'], code: ['MachineCode', 'Code'],
    subtitle: ['Line', 'Department'],
    addFields: ['MachineCode', 'MachineName', 'Line', 'Capacity'],
  },
  {
    key: 'power_cord', label: 'Power Cord Master', category: 'production', icon: 'Power',
    description: 'Power-cord / moulding specifications master.',
    table: null, managerRoute: '/molding/power-cord-master',
    title: ['PowerCordName', 'Name'], code: ['PowerCordCode', 'Code'],
  },

  // ---------------- Reference Data ----------------
  {
    key: 'product_categories', label: 'Product Categories', category: 'reference', icon: 'Category',
    description: 'Categories that group products and cables.',
    table: 'product_categories',
    title: ['name'], code: ['slug'], subtitle: ['description'],
    columns: ['name', 'slug', 'description'],
    addFields: ['name', 'slug', 'description'],
  },
  {
    key: 'uom', label: 'Units of Measure', category: 'reference', icon: 'Straighten',
    description: 'Units (KG, MTR, PC…) used across products and orders.',
    table: 'units_of_measure',
    title: ['name'], code: ['code'], subtitle: ['symbol'],
    columns: ['code', 'name', 'symbol'],
    addFields: ['code', 'name', 'symbol'],
  },
];

export const getEntity = (key) => MASTER_ENTITIES.find((e) => e.key === key) || null;

/** First candidate key present (and non-empty) on a row. */
export const pickField = (row, candidates = []) => {
  if (!row) return '';
  for (const k of candidates) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
};
