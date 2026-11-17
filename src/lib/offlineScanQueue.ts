import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDocFromServer, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { ChipRead } from '../types';
import { authenticatedFetch, useAccess } from './access';
import { computeBackoffMs, parseRetryAfterSeconds } from './resilientFetch';

const MAX_AUTO_RETRIES_PER_SCAN = 8;
const key = (uid: string, raceId: string) => `racepulse_pending_chip_reads_v2:${uid}:${raceId}`;
const retryKey = (uid: string, raceId: string) => `racepulse_pending_chip_retry_v1:${uid}:${raceId}`;

interface RetryMeta {
  attempts: number;
  nextRetryAt: number;
}

function readQueue(storageKey: string): ChipRead[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function readRetryMap(storageKey: string): Record<string, RetryMeta> {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, RetryMeta>)
      : {};
  } catch {
    return {};
  }
}

function writeRetryMap(storageKey: string, map: Record<string, RetryMeta>) {
  try {
    if (Object.keys(map).length === 0) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, JSON.stringify(map));
    }
  } catch {
    // Ignore storage limits; queue items stay safe in localStorage.
  }
}

export function useOfflineScanQueue(raceId: string) {
  const { can, version } = useAccess();
  const uid = auth.currentUser?.uid || '';
  const storageKey = key(uid, raceId);
  const retryStorageKey = retryKey(uid, raceId);
  const [pendingCount, setPendingCount] = useState(0);
  const [queueError, setQueueError] = useState('');
  const flushing = useRef(false);
  const batchCooldownUntilRef = useRef(0);

  const refresh = useCallback(() => {
    setPendingCount(readQueue(storageKey).length);
  }, [storageKey]);

  const discard = useCallback(
    (id: string) => {
      localStorage.setItem(storageKey, JSON.stringify(readQueue(storageKey).filter((r) => r.id !== id)));
      const map = readRetryMap(retryStorageKey);
      if (id in map) {
        delete map[id];
        writeRetryMap(retryStorageKey, map);
      }
      refresh();
    },
    [storageKey, retryStorageKey, refresh],
  );

  const flush = useCallback(
    async (manualTrigger = false) => {
      if (flushing.current || !uid || auth.currentUser?.uid !== uid || !navigator.onLine || !can('timing.scan')) {
        return;
      }
      const queued = readQueue(storageKey);
      if (queued.length === 0) return;

      const nowMs = Date.now();
      if (!manualTrigger && nowMs < batchCooldownUntilRef.current) {
        return;
      }

      const retryMap = readRetryMap(retryStorageKey);
      if (manualTrigger) {
        batchCooldownUntilRef.current = 0;
        for (const id of Object.keys(retryMap)) {
          retryMap[id] = { attempts: 0, nextRetryAt: 0 };
        }
        writeRetryMap(retryStorageKey, retryMap);
      }

      const dueRecords = queued.filter((record) => {
        if (record.recordedBy !== uid || record.raceId !== raceId) return false;
        const meta = retryMap[record.id];
        if (!meta) return true;
        if (meta.attempts >= MAX_AUTO_RETRIES_PER_SCAN) return false;
        return nowMs >= meta.nextRetryAt;
      });

      if (dueRecords.length === 0) {
        const hasPaused = queued.some((r) => (retryMap[r.id]?.attempts || 0) >= MAX_AUTO_RETRIES_PER_SCAN);
        if (hasPaused) {
          setQueueError('Queued scans paused after repeated failures. Review authorization or tap Retry.');
        }
        return;
      }

      flushing.current = true;
      try {
        // Verify authorization ONCE per batch rather than per queued scan.
        const sessionUrl = `${(import.meta.env.VITE_ACCESS_API_URL || 'https://asia-southeast1-racepulseph.cloudfunctions.net/accessApi').replace(/\/$/, '')}/session`;
        const session = await authenticatedFetch(sessionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });

        if (!session.ok) {
          const retryAfter = parseRetryAfterSeconds(session);
          const backoffMs = computeBackoffMs(1, {
            baseMs: 15_000,
            maxMs: 300_000,
            retryAfterSec: retryAfter,
          });
          batchCooldownUntilRef.current = Date.now() + backoffMs;
          if (session.status === 401 || session.status === 403) {
            setQueueError('Session expired or permissions changed. Re-authenticate before replaying queued scans.');
          } else {
            setQueueError('Authorization is unavailable. Scans remain queued.');
          }
          return;
        }

        const value = await session.json();
        if (!value.permissions?.['timing.scan'] || (value.scope !== 'all' && !value.allowedRaceIds?.includes(raceId))) {
          batchCooldownUntilRef.current = Date.now() + 60_000;
          setQueueError('Race access changed. Queued scans require review.');
          return;
        }

        for (const record of dueRecords) {
          if (auth.currentUser?.uid !== uid || record.recordedBy !== uid || record.raceId !== raceId) continue;
          try {
            await setDoc(doc(db, 'chipReads', record.id), record);
            await getDocFromServer(doc(db, 'chipReads', record.id));
            void authenticatedFetch('/api/chip-reads', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(record),
            }).catch(() => undefined);
            discard(record.id);
            setQueueError('');
          } catch (error: unknown) {
            const prev = retryMap[record.id] || { attempts: 0, nextRetryAt: 0 };
            const attempts = prev.attempts + 1;
            const delayMs = computeBackoffMs(attempts, { baseMs: 12_000, maxMs: 300_000 });
            retryMap[record.id] = { attempts, nextRetryAt: Date.now() + delayMs };
            writeRetryMap(retryStorageKey, retryMap);
            const message = error instanceof Error && error.message ? error.message : 'Scan remains queued for review.';
            setQueueError(
              attempts >= MAX_AUTO_RETRIES_PER_SCAN
                ? `Scan paused after ${MAX_AUTO_RETRIES_PER_SCAN} failed retries: ${message}`
                : message,
            );
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error && error.message ? error.message : 'Authorization is unavailable. Scans remain queued.';
        batchCooldownUntilRef.current = Date.now() + 20_000;
        setQueueError(message);
      } finally {
        flushing.current = false;
        refresh();
      }
    },
    [uid, storageKey, retryStorageKey, raceId, version, can, discard, refresh],
  );

  const enqueue = useCallback(
    (record: ChipRead) => {
      if (!can('timing.scan') || record.recordedBy !== uid || auth.currentUser?.uid !== uid) {
        throw new Error('Timing access is unavailable.');
      }
      const records = readQueue(storageKey);
      if (!records.some((r) => r.id === record.id)) {
        localStorage.setItem(storageKey, JSON.stringify([...records, record]));
      }
      refresh();
      void flush(false);
    },
    [uid, storageKey, can, refresh, flush],
  );

  useEffect(() => {
    // Migrate only this actor's old items; keep every other actor's legacy work intact.
    const legacyKey = 'racepulse_pending_chip_reads_v1';
    const legacy = readQueue(legacyKey);
    const mine = legacy.filter((r) => r.recordedBy === uid && r.raceId === raceId);
    if (mine.length) {
      const merged = new Map([...readQueue(storageKey), ...mine].map((r) => [r.id, r]));
      localStorage.setItem(storageKey, JSON.stringify([...merged.values()]));
      localStorage.setItem(legacyKey, JSON.stringify(legacy.filter((r) => !mine.includes(r))));
    }
    refresh();
    void flush(false);

    const onOnline = () => {
      batchCooldownUntilRef.current = 0;
      void flush(false);
    };
    const onFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void flush(false);
      }
    };
    const onTimer = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (!navigator.onLine) return;
      void flush(false);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(onTimer, 12_000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [uid, raceId, storageKey, refresh, flush]);

  const manualFlush = useCallback(() => flush(true), [flush]);

  return { pendingCount, enqueue, flush: manualFlush, discard, queueError };
}
