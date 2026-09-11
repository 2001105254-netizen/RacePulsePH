import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDocFromServer, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ChipRead } from '../types';

const STORAGE_KEY = 'racepulse_pending_chip_reads_v1';

function readQueue(): ChipRead[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved as ChipRead[] : [];
  } catch {
    return [];
  }
}

function writeQueue(reads: ChipRead[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reads));
}

async function postToLan(record: ChipRead): Promise<void> {
  try {
    await fetch('/api/chip-reads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  } catch {
    // The on-site server is optional. The browser queue remains the source of
    // truth until Firestore confirms the scan from the cloud.
  }
}

// Every timing scan goes here before it is sent anywhere. Firestore itself
// has IndexedDB persistence, but this additional localStorage queue protects
// a scan even if Firestore persistence is unavailable (for example in a
// second browser tab). A queued item is removed only after a server read can
// see the exact scan document.
export function useOfflineScanQueue(raceId: string) {
  const [pendingCount, setPendingCount] = useState(0);
  const flushingRef = useRef(false);

  const refreshCount = useCallback(() => {
    setPendingCount(readQueue().filter((record) => record.raceId === raceId).length);
  }, [raceId]);

  const flush = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator.onLine || flushingRef.current) return;
    const queued = readQueue();
    if (queued.length === 0) {
      refreshCount();
      return;
    }

    flushingRef.current = true;
    let remaining = queued;
    try {
      for (const record of queued) {
        const recordRef = doc(db, 'chipReads', record.id);
        try {
          // setDoc is idempotent because the scan ID was generated once when
          // the runner crossed the station. Retrying never creates a second read.
          await setDoc(recordRef, record);
          void postToLan(record);
          const cloudCopy = await getDocFromServer(recordRef);
          if (cloudCopy.exists()) {
            remaining = remaining.filter((queuedRecord) => queuedRecord.id !== record.id);
            writeQueue(remaining);
          }
        } catch {
          // Stop at the first unavailable/rejected record; retain every item
          // for the next online, focus, or interval retry.
          break;
        }
      }
    } finally {
      flushingRef.current = false;
      refreshCount();
    }
  }, [refreshCount]);

  const enqueue = useCallback((record: ChipRead) => {
    const current = readQueue();
    if (!current.some((queuedRecord) => queuedRecord.id === record.id)) {
      writeQueue([...current, record]);
    }
    refreshCount();
    // Firestore publishes this to its local cache immediately, so the current
    // timing screen and result calculations still update while fully offline.
    void setDoc(doc(db, 'chipReads', record.id), record).catch(() => undefined);
    // The LAN post is attempted even without WAN; it lets other timing desks
    // on the local hotspot see the scan immediately.
    void postToLan(record);
    void flush();
  }, [flush, refreshCount]);

  useEffect(() => {
    refreshCount();
    void flush();
    const retry = () => { void flush(); };
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    const interval = window.setInterval(retry, 12_000);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', retry);
      window.clearInterval(interval);
    };
  }, [flush, refreshCount]);

  return { pendingCount, enqueue, flush };
}
