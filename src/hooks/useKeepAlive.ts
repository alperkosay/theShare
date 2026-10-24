import { useEffect } from 'react';

/**
 * While a transfer runs: keep the screen on (mobile browsers suspend the page,
 * and with it the connection, when the screen locks) and warn before the tab
 * is closed or reloaded.
 */
export function useKeepAlive(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    let lock: WakeLockSentinel | null = null;
    let disposed = false;
    const acquire = async () => {
      if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (disposed) void sentinel.release();
        else lock = sentinel;
      } catch {
        // Not allowed (battery saver, iframe, …): the transfer still runs, just without the lock.
      }
    };
    // The lock is released automatically whenever the page is hidden.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      void lock?.release();
    };
  }, [active]);
}
