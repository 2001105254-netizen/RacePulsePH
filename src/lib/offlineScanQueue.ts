import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDocFromServer, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { ChipRead } from '../types';
import { authenticatedFetch, useAccess } from './access';
const key = (uid: string, raceId: string) => `racepulse_pending_chip_reads_v2:${uid}:${raceId}`;
function readQueue(storageKey: string): ChipRead[] { try { const value = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
export function useOfflineScanQueue(raceId: string) {
  const { can, version } = useAccess();
  const uid = auth.currentUser?.uid || '';
  const storageKey = key(uid, raceId);
  const [pendingCount, setPendingCount] = useState(0), [queueError, setQueueError] = useState('');
  const flushing = useRef(false);
  const refresh = useCallback(() => setPendingCount(readQueue(storageKey).length), [storageKey]);
  const discard = useCallback((id: string) => { localStorage.setItem(storageKey, JSON.stringify(readQueue(storageKey).filter(r => r.id !== id))); refresh(); }, [storageKey, refresh]);
  const flush = useCallback(async () => {
    if (flushing.current || !uid || auth.currentUser?.uid !== uid || !navigator.onLine || !can('timing.scan')) return;
    flushing.current = true;
    try {
      for (const record of readQueue(storageKey)) {
        if (auth.currentUser?.uid !== uid || record.recordedBy !== uid || record.raceId !== raceId) continue;
        try {
          // Ask the current backend policy before replaying any local item.
          const session = await authenticatedFetch((import.meta.env.VITE_ACCESS_API_URL || 'https://asia-southeast1-racepulseph.cloudfunctions.net/accessApi') + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          if (!session.ok) throw new Error('Authorization is unavailable. Scans remain queued.');
          const value = await session.json();
          if (!value.permissions['timing.scan'] || (value.scope !== 'all' && !value.allowedRaceIds.includes(raceId))) throw new Error('Race access changed. Queued scans require review.');
          await setDoc(doc(db, 'chipReads', record.id), record);
          await getDocFromServer(doc(db, 'chipReads', record.id));
          void authenticatedFetch('/api/chip-reads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) }).catch(() => undefined);
          discard(record.id); setQueueError('');
        } catch (error: any) { setQueueError(error.message || 'Scan remains queued for review.'); }
      }
    } finally { flushing.current = false; refresh(); }
  }, [uid, storageKey, raceId, version, can, discard, refresh]);
  const enqueue = useCallback((record: ChipRead) => {
    if (!can('timing.scan') || record.recordedBy !== uid || auth.currentUser?.uid !== uid) throw new Error('Timing access is unavailable.');
    const records = readQueue(storageKey); if (!records.some(r => r.id === record.id)) localStorage.setItem(storageKey, JSON.stringify([...records, record]));
    refresh(); void flush();
  }, [uid, storageKey, can, refresh, flush]);
  useEffect(() => {
    // Migrate only this actor's old items; keep every other actor's legacy work intact.
    const legacyKey = 'racepulse_pending_chip_reads_v1';
    const legacy = readQueue(legacyKey), mine = legacy.filter(r => r.recordedBy === uid && r.raceId === raceId);
    if (mine.length) { const merged = new Map([...readQueue(storageKey), ...mine].map(r => [r.id, r])); localStorage.setItem(storageKey, JSON.stringify([...merged.values()])); localStorage.setItem(legacyKey, JSON.stringify(legacy.filter(r => !mine.includes(r)))); }
    refresh(); void flush(); const retry = () => { void flush(); };
    window.addEventListener('online', retry); window.addEventListener('focus', retry); const timer = setInterval(retry, 12000);
    return () => { window.removeEventListener('online', retry); window.removeEventListener('focus', retry); clearInterval(timer); };
  }, [uid, raceId, storageKey, refresh, flush]);
  return { pendingCount, enqueue, flush, discard, queueError };
}
