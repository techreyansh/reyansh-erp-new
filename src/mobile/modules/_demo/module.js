// THROWAWAY STUB MODULE — proves the Factory Ops frame end-to-end:
//   login → Home tile → screen → offline submit → sync (idempotent).
// DELETE THIS FOLDER once a real module (Store, Production, …) lands. It exists
// only so the platform foundation is demonstrably wired before any business logic.
import React from 'react';
import ScienceIcon from '@mui/icons-material/Science';
import DemoRead from './screens/DemoRead';
import DemoSubmit from './screens/DemoSubmit';

const demoModule = {
  key: '_demo',
  title: 'Demo (stub)',
  icon: <ScienceIcon />,
  // Gated behind the dashboard module everyone-with-access can view.
  requiredModule: 'dashboard',
  color: '#475569',
  offlineEntities: ['mobile_ping_log'],
  screens: [
    { key: 'read', title: 'Cached Read', component: DemoRead },
    // The submit screen is gated by a capability to demonstrate the cap layer.
    { key: 'submit', title: 'Offline Submit', cap: 'demo.submit', component: DemoSubmit },
  ],
};

export default demoModule;
