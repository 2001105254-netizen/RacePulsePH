import type { ActiveRunSession, PendingRunUpload } from './types';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DB_NAME = 'racepulse_run_recovery_v1';
const DB_VERSION = 1;
const ACTIVE_STORE = 'activeRuns';
const PENDING_STORE = 'pendingUploads';

const ACTIVE_FALLBACK_PREFIX = 'racepulse_active_run_v1::';
const PENDING_FALLBACK_PREFIX = 'racepulse_pending_uploads_v1::';

function resolveFallbackStorage(storageOverride?: StorageLike): StorageLike | null {
  if (storageOverride) {
    return storageOverride;
  }
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch (err) {
    console.warn('[runCrashRecovery] localStorage access failed', err);
  }
  return null;
}

function shouldUseIndexedDb(storageOverride?: StorageLike): boolean {
  return !storageOverride && typeof indexedDB !== 'undefined';
}

function openRecoveryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ACTIVE_STORE)) {
        db.createObjectStore(ACTIVE_STORE, { keyPath: 'uid' });
      }
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open run recovery database.'));
  });
}

function readJsonStorage<T>(storage: StorageLike, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn('[runCrashRecovery] failed parsing stored JSON for', key, err);
    return null;
  }
}

function writeJsonStorage(storage: StorageLike, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[runCrashRecovery] failed writing storage for', key, err);
  }
}

function isValidSessionShape(value: unknown, expectedUid: string): value is ActiveRunSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ActiveRunSession>;
  return (
    typeof candidate.sessionId === 'string' &&
    candidate.uid === expectedUid &&
    Array.isArray(candidate.points)
  );
}

export async function saveActiveRunSnapshot(
  session: ActiveRunSession,
  storageOverride?: StorageLike,
): Promise<void> {
  if (!session.uid) return;

  if (shouldUseIndexedDb(storageOverride)) {
    try {
      const db = await openRecoveryDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(ACTIVE_STORE, 'readwrite');
          tx.objectStore(ACTIVE_STORE).put(session);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Failed saving active run snapshot.'));
        });
        return;
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[runCrashRecovery] IndexedDB active run save failed; falling back', err);
    }
  }

  const storage = resolveFallbackStorage(storageOverride);
  if (storage) {
    writeJsonStorage(storage, `${ACTIVE_FALLBACK_PREFIX}${session.uid}`, session);
  }
}

export async function loadActiveRunSnapshot(
  uid: string,
  storageOverride?: StorageLike,
): Promise<ActiveRunSession | null> {
  if (!uid) return null;

  if (shouldUseIndexedDb(storageOverride)) {
    try {
      const db = await openRecoveryDb();
      try {
        const record = await new Promise<unknown>((resolve, reject) => {
          const tx = db.transaction(ACTIVE_STORE, 'readonly');
          const req = tx.objectStore(ACTIVE_STORE).get(uid);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => reject(req.error || new Error('Failed loading active run snapshot.'));
        });
        return isValidSessionShape(record, uid) ? record : null;
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[runCrashRecovery] IndexedDB active run load failed; falling back', err);
    }
  }

  const storage = resolveFallbackStorage(storageOverride);
  if (!storage) return null;
  const parsed = readJsonStorage<unknown>(storage, `${ACTIVE_FALLBACK_PREFIX}${uid}`);
  return isValidSessionShape(parsed, uid) ? parsed : null;
}

export async function clearActiveRunSnapshot(
  uid: string,
  storageOverride?: StorageLike,
): Promise<void> {
  if (!uid) return;

  if (shouldUseIndexedDb(storageOverride)) {
    try {
      const db = await openRecoveryDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(ACTIVE_STORE, 'readwrite');
          tx.objectStore(ACTIVE_STORE).delete(uid);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Failed clearing active run snapshot.'));
        });
        return;
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[runCrashRecovery] IndexedDB active run clear failed; falling back', err);
    }
  }

  const storage = resolveFallbackStorage(storageOverride);
  if (storage) {
    try {
      storage.removeItem(`${ACTIVE_FALLBACK_PREFIX}${uid}`);
    } catch (err) {
      console.warn('[runCrashRecovery] failed removing active run snapshot', err);
    }
  }
}

type StoredPendingUploadRecord = PendingRunUpload & { id: string };

function sortPendingUploads(entries: PendingRunUpload[]): PendingRunUpload[] {
  return [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function savePendingRunUpload(
  entry: PendingRunUpload,
  storageOverride?: StorageLike,
): Promise<void> {
  if (!entry.uid || !entry.requestId) return;

  if (shouldUseIndexedDb(storageOverride)) {
    try {
      const db = await openRecoveryDb();
      try {
        const record: StoredPendingUploadRecord = {
          ...entry,
          id: `${entry.uid}::${entry.requestId}`,
        };
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(PENDING_STORE, 'readwrite');
          tx.objectStore(PENDING_STORE).put(record);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Failed saving pending run upload.'));
        });
        return;
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[runCrashRecovery] IndexedDB pending upload save failed; falling back', err);
    }
  }

  const storage = resolveFallbackStorage(storageOverride);
  if (!storage) return;
  const key = `${PENDING_FALLBACK_PREFIX}${entry.uid}`;
  const existing = readJsonStorage<PendingRunUpload[]>(storage, key);
  const items = Array.isArray(existing) ? existing : [];
  const next = items.filter((item) => item.requestId !== entry.requestId);
  next.push(entry);
  writeJsonStorage(storage, key, sortPendingUploads(next));
}

export async function listPendingRunUploads(
  uid: string,
  storageOverride?: StorageLike,
): Promise<PendingRunUpload[]> {
  if (!uid) return [];

  if (shouldUseIndexedDb(storageOverride)) {
    try {
      const db = await openRecoveryDb();
      try {
        const records = await new Promise<StoredPendingUploadRecord[]>((resolve, reject) => {
          const tx = db.transaction(PENDING_STORE, 'readonly');
          const req = tx.objectStore(PENDING_STORE).getAll();
          req.onsuccess = () =>
            resolve(Array.isArray(req.result) ? (req.result as StoredPendingUploadRecord[]) : []);
          req.onerror = () => reject(req.error || new Error('Failed listing pending uploads.'));
        });
        const filtered = records
          .filter((item) => item && item.uid === uid)
          .map(({ id: _id, ...rest }) => rest as PendingRunUpload);
        return sortPendingUploads(filtered);
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[runCrashRecovery] IndexedDB pending upload list failed; falling back', err);
    }
  }

  const storage = resolveFallbackStorage(storageOverride);
  if (!storage) return [];
  const parsed = readJsonStorage<PendingRunUpload[]>(storage, `${PENDING_FALLBACK_PREFIX}${uid}`);
  return Array.isArray(parsed) ? sortPendingUploads(parsed.filter((item) => item.uid === uid)) : [];
}

export async function removePendingRunUpload(
  uid: string,
  requestId: string,
  storageOverride?: StorageLike,
): Promise<void> {
  if (!uid || !requestId) return;

  if (shouldUseIndexedDb(storageOverride)) {
    try {
      const db = await openRecoveryDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(PENDING_STORE, 'readwrite');
          tx.objectStore(PENDING_STORE).delete(`${uid}::${requestId}`);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('Failed removing pending upload.'));
        });
        return;
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[runCrashRecovery] IndexedDB pending upload delete failed; falling back', err);
    }
  }

  const storage = resolveFallbackStorage(storageOverride);
  if (!storage) return;
  const key = `${PENDING_FALLBACK_PREFIX}${uid}`;
  const existing = readJsonStorage<PendingRunUpload[]>(storage, key);
  if (!Array.isArray(existing)) return;
  const remaining = existing.filter((item) => item.requestId !== requestId);
  if (remaining.length === 0) {
    try {
      storage.removeItem(key);
    } catch (err) {
      console.warn('[runCrashRecovery] failed removing empty pending uploads key', err);
    }
  } else {
    writeJsonStorage(storage, key, sortPendingUploads(remaining));
  }
}
