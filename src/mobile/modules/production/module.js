// Production module — shop-floor output capture on the Factory Ops foundation.
// Thin client over ppc_post_jobcard via the offline outbox. Gated by the
// 'production' RBAC module; screens by production.* caps (20260626020000).
import React from 'react';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import LogOutput from './screens/LogOutput';
import Lookup from './screens/Lookup';

const productionModule = {
  key: 'production',
  title: 'Production',
  icon: <PrecisionManufacturingIcon />,
  requiredModule: 'production',
  color: '#B45309',
  offlineEntities: ['open_wos'],
  screens: [
    { key: 'log', title: 'Log Output', cap: 'production.log', component: LogOutput },
    { key: 'lookup', title: 'Lookup', cap: 'production.lookup', component: Lookup },
  ],
};

export default productionModule;
