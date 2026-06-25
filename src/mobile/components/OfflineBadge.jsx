// Online/offline + pending-sync indicator, driven by useSync.
import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import SyncProblemIcon from '@mui/icons-material/SyncProblem';
import useSync from '../core/sync/useSync';

export default function OfflineBadge({ sync }) {
  // Allow a shared sync instance to be passed in (AppShell), else self-mount.
  const own = useSync();
  const s = sync || own;
  const { online, counts } = s;
  const pending = counts?.pending || 0;
  const failed = counts?.failed || 0;

  let icon = <CloudDoneIcon fontSize="small" />;
  let color = 'success';
  let label = 'Online';

  if (!online) {
    icon = <CloudOffIcon fontSize="small" />;
    color = 'default';
    label = pending ? `Offline · ${pending} queued` : 'Offline';
  } else if (failed) {
    icon = <SyncProblemIcon fontSize="small" />;
    color = 'error';
    label = `${failed} failed`;
  } else if (pending) {
    icon = <SyncProblemIcon fontSize="small" />;
    color = 'warning';
    label = `${pending} pending`;
  }

  return (
    <Tooltip title={online ? 'Connected to ERP' : 'Working offline — changes will sync'}>
      <Chip
        size="small"
        icon={icon}
        label={label}
        color={color}
        variant={online && !pending && !failed ? 'outlined' : 'filled'}
        onClick={online && (pending || failed) ? s.flushNow : undefined}
      />
    </Tooltip>
  );
}
