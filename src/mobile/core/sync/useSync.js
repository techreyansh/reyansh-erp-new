// React hook exposing online state + outbox counts + a manual flush trigger.
// Drives OfflineBadge and the AppShell sync indicator.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as outbox from './outbox';
import { runIntent } from '../api/client';

const getOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

export function useSync({ pollMs = 15000 } = {}) {
  const [online, setOnline] = useState(getOnline());
  const [counts, setCounts] = useState({ pending: 0, failed: 0, sent: 0 });
  const flushing = useRef(false);

  const refreshCounts = useCallback(async () => {
    try {
      setCounts(await outbox.counts());
    } catch {
      /* IDB unavailable — leave counts as-is */
    }
  }, []);

  const flushNow = useCallback(async () => {
    if (flushing.current || !getOnline()) return;
    flushing.current = true;
    try {
      await outbox.flush(runIntent);
    } finally {
      flushing.current = false;
      await refreshCounts();
    }
  }, [refreshCounts]);

  // online/offline events
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      flushNow();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [flushNow]);

  // initial load + periodic count refresh + opportunistic flush
  useEffect(() => {
    refreshCounts();
    flushNow();
    const id = setInterval(() => {
      outbox.pruneOld().catch(() => {});
      refreshCounts();
      flushNow();
    }, pollMs);
    return () => clearInterval(id);
  }, [refreshCounts, flushNow, pollMs]);

  return { online, counts, flushNow, refreshCounts };
}

export default useSync;
