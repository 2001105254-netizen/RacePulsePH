type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const isLikelyCloudOrigin = () => {
  if (typeof window === 'undefined') return false;
  const { protocol, hostname } = window.location;
  if (protocol === 'capacitor:' || protocol === 'file:') return true;
  return (
    hostname.endsWith('.web.app') ||
    hostname.endsWith('.firebaseapp.com') ||
    hostname === 'racepulseph.com' ||
    hostname === 'www.racepulseph.com'
  );
};

export interface LanPollControllerOptions {
  endpoint: string;
  fetcher: FetchLike;
  activeIntervalMs: number;
  idleBackoffMs?: number;
  onData: (payload: unknown) => void;
  onDisconnected: () => void;
}

/**
 * Polls an on-site Express LAN endpoint while preventing wasted SPA HTML fetches
 * and JSON parse churn when running on cloud hosting or offline Capacitor origins.
 */
export function startLanJsonPoller({
  endpoint,
  fetcher,
  activeIntervalMs,
  idleBackoffMs = 30000,
  onData,
  onDisconnected,
}: LanPollControllerOptions): () => void {
  let stopped = false;
  let timerId: number | null = null;
  let consecutiveMisses = isLikelyCloudOrigin() ? 1 : 0;

  const scheduleNext = (delay: number) => {
    if (stopped) return;
    if (timerId !== null) window.clearTimeout(timerId);
    timerId = window.setTimeout(() => {
      void tick();
    }, delay);
  };

  const tick = async () => {
    if (stopped) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      scheduleNext(idleBackoffMs);
      return;
    }

    try {
      const response = await fetcher(endpoint, { cache: 'no-store' });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('application/json')) {
        consecutiveMisses += 1;
        onDisconnected();
        scheduleNext(consecutiveMisses >= 2 ? idleBackoffMs : Math.min(8000, activeIntervalMs * 4));
        return;
      }

      const payload = await response.json();
      if (stopped) return;
      consecutiveMisses = 0;
      onData(payload);
      scheduleNext(activeIntervalMs);
    } catch {
      if (stopped) return;
      consecutiveMisses += 1;
      onDisconnected();
      scheduleNext(consecutiveMisses >= 2 ? idleBackoffMs : Math.min(8000, activeIntervalMs * 4));
    }
  };

  const onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && consecutiveMisses === 0) {
      void tick();
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  void tick();

  return () => {
    stopped = true;
    if (timerId !== null) window.clearTimeout(timerId);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}

