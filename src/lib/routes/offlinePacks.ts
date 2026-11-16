import type { PublishedRaceRoute } from './types';

const DB_NAME = 'racepulse_offline_routes_v1';
const STORE_NAME = 'course_packs';

export interface OfflineCoursePack {
  key: string; // `${raceId}_${distanceId}`
  publicationId: string;
  versionNumber: number;
  savedAt: string;
  publication: PublishedRaceRoute;
  gpxText: string;
}

function openPackDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Offline storage is unavailable in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open offline course storage.'));
  });
}

export async function saveOfflineCoursePack(pack: OfflineCoursePack): Promise<void> {
  const db = await openPackDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(pack);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not save offline pack.'));
    });
  } finally {
    db.close();
  }
}

export async function getOfflineCoursePack(
  raceId: string,
  distanceId: string,
): Promise<OfflineCoursePack | null> {
  try {
    const db = await openPackDb();
    try {
      return await new Promise<OfflineCoursePack | null>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(`${raceId}_${distanceId}`);
        req.onsuccess = () => resolve((req.result as OfflineCoursePack) || null);
        req.onerror = () => resolve(null);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function removeOfflineCoursePack(
  raceId: string,
  distanceId: string,
): Promise<void> {
  const db = await openPackDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(`${raceId}_${distanceId}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not remove offline pack.'));
    });
  } finally {
    db.close();
  }
}
