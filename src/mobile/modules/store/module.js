// Store module — first business module on the Factory Ops foundation.
// Thin capture client over the live inv_* ledger RPCs; every post goes through
// the offline outbox. Gated by the 'inventory' RBAC module; each screen by a
// store.* capability (seeded by 20260625220000_store_role_caps.sql).
import React from 'react';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import Issue from './screens/Issue';
import Receipt from './screens/Receipt';
import Adjust from './screens/Adjust';
import Transfer from './screens/Transfer';
import Scan from './screens/Scan';
import Lookup from './screens/Lookup';

const storeModule = {
  key: 'store',
  title: 'Store',
  icon: <Inventory2Icon />,
  requiredModule: 'inventory',
  color: '#0F766E',
  offlineEntities: ['ppc_items', 'inv_location', 'inv_balance', 'open_pos', 'open_wos'],
  screens: [
    { key: 'issue', title: 'Material Issue', cap: 'store.issue', component: Issue },
    { key: 'receipt', title: 'Material Receipt', cap: 'store.receipt', component: Receipt },
    { key: 'adjust', title: 'Stock Adjustment', cap: 'store.adjust', component: Adjust },
    { key: 'transfer', title: 'Rack Transfer', cap: 'store.transfer', component: Transfer },
    { key: 'scan', title: 'Scan', cap: 'store.scan', component: Scan },
    { key: 'lookup', title: 'Lookup', cap: 'store.lookup', component: Lookup },
  ],
};

export default storeModule;
