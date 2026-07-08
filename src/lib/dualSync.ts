import { useEffect, useRef, useState } from 'react';
import { onSnapshot, Query } from 'firebase/firestore';

interface DualSyncOptions<T> {
  firestoreQuery: Query;
  lanEndpoint: string; // e.g. '/api/orders'
  lanResponseKey: string; // e.g. 'orders' - the array field in the LAN server's JSON response
  getId: (item: T) => string;
  getUpdatedAt: (item: T) => string; // timestamp field used for merge conflict resolution
  pollIntervalMs?: number;
}

interface DualSyncResult<T> {
  items: T[];
  loading: boolean;
  lanConnected: boolean | null;
}

// Blends a live Firestore collection with the on-site LAN Express server (server.ts),
// resolving conflicts by whichever copy of a record was updated most recently. This is
// the same dual-sync pattern OperatorDashboard/CustomerForm use for engraving orders,
// factored out so timing (Organizer/Admin live reads, Runner's own splits) can reuse it.
export function useDualSync<T>({
  firestoreQuery,
  lanEndpoint,
  lanResponseKey,
  getId,
  getUpdatedAt,
  pollIntervalMs = 2000,
}: DualSyncOptions<T>): DualSyncResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [lanConnected, setLanConnected] = useState<boolean | null>(null);

  const firestoreItemsRef = useRef<T[]>([]);
  const lanItemsRef = useRef<T[]>([]);

  const mergeAndPublish = () => {
    const combinedMap = new Map<string, T>();

    const insertOrResolve = (item: T) => {
      const id = getId(item);
      const existing = combinedMap.get(id);
      if (!existing) {
        combinedMap.set(id, item);
      } else {
        const timeExisting = new Date(getUpdatedAt(existing)).getTime() || 0;
        const timeNew = new Date(getUpdatedAt(item)).getTime() || 0;
        if (timeNew >= timeExisting) {
          combinedMap.set(id, item);
        }
      }
    };

    firestoreItemsRef.current.forEach(insertOrResolve);
    lanItemsRef.current.forEach(insertOrResolve);

    setItems(Array.from(combinedMap.values()));
    setLoading(false);
  };

  // 1. Firestore Cloud Database Listener
  useEffect(() => {
    const unsubscribe = onSnapshot(firestoreQuery, (snapshot) => {
      const list: T[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as T));
      firestoreItemsRef.current = list;
      mergeAndPublish();
    }, (error) => {
      console.warn(`Cloud Firestore stream offline or restricted (${lanEndpoint}):`, error.message);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Onsite LAN Local Express Server Poller
  useEffect(() => {
    let active = true;
    const pollLocalServer = async () => {
      try {
        const res = await fetch(lanEndpoint);
        if (!res.ok) {
          if (active) setLanConnected(false);
          return;
        }
        const data = await res.json();
        if (active) setLanConnected(true);
        lanItemsRef.current = data[lanResponseKey] || [];
        mergeAndPublish();
      } catch (err) {
        if (active) setLanConnected(false);
      }
    };

    pollLocalServer();
    const interval = setInterval(pollLocalServer, pollIntervalMs);

    return () => {
      active = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { items, loading, lanConnected };
}
