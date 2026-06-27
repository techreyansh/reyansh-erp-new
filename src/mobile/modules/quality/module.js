// Quality module — shop-floor QC capture on the Factory Ops foundation. Thin
// client over ppc_record_qc via the offline outbox. Gated by the 'quality' RBAC
// module; screens by quality.* caps (20260627160000).
import React from 'react';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import Inspect from './screens/Inspect';
import Lookup from './screens/Lookup';

const qualityModule = {
  key: 'quality',
  title: 'Quality',
  icon: <FactCheckIcon />,
  requiredModule: 'quality',
  color: '#7C3AED',
  offlineEntities: ['open_wos'],
  screens: [
    { key: 'inspect', title: 'Record QC', cap: 'quality.inspect', component: Inspect },
    { key: 'lookup', title: 'Lookup', cap: 'quality.lookup', component: Lookup },
  ],
};

export default qualityModule;
