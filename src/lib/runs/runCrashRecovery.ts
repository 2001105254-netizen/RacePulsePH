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
    req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  });
}

function runWriteTx(
  db: IDBDatabase,
  storeName: string,
  action: (store: IDBObjectStore) => void,
  errorMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(errorMessage));
    };
    const tx = db.transaction(storeName, 'readwrite');
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    tx.onerror = () => fail(tx.error || new Error(errorMessage));
    tx.onabort = () => fail(tx.error || new Error(`${errorMessage} (aborted)`));
    action(tx.objectStore(storeName));
  });
}

function runReadTx<T>(
  db: IDBDatabase,
  storeName: string,
  requestFactory: (store: IDBObjectStore) => IDBRequest,
  transform: (result: unknown) => T,
  errorMessage: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(errorMessage));
    };
    const tx = db.transaction(storeName, 'readonly');
    tx.onerror = () => fail(tx.error || new Error(errorMessage));
    tx.onabort = () => fail(tx.error || new Error(`${errorMessage} (aborted)`));
    const req = requestFactory(tx.objectStore(storeName));
    req.onsuccess = () => {
      if (settled) return;
      settled = true;
      resolve(transform(req.result));
    };
    req.onerror = () => fail(req.error || tx.error || new Error(errorMessage));
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

function isValidPendingUpload(value: unknown, expectedUid?: string): value is PendingRunUpload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PendingRunUpload>;
  if (typeof candidate.uid !== 'string' || !candidate.uid) return false;
  if (expectedUid !== undefined && candidate.uid !== expectedUid) return false;
  return typeof candidate.requestId === 'string' && typeof candidate.createdAt === 'string';
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
        await runWriteTx(
          db,
          ACTIVE_STORE,
          (store) => store.put(session),
          'Failed saving active run snapshot.',
        );
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
        const record = await runReadTx(
          db,
          ACTIVE_STORE,
          (store) => store.get(uid),
          (result) => result ?? null,
          'Failed loading active run snapshot.',
        );
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
        await runWriteTx(
          db,
          ACTIVE_STORE,
          (store) => store.delete(uid),
          'Failed clearing active run snapshot.',
        );
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
        await runWriteTx(
          db,
          PENDING_STORE,
          (store) => store.put(record),
          'Failed saving pending run upload.',
        );
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
  const existing = readJsonStorage<unknown>(storage, key);
  const items = Array.isArray(existing)
    ? existing.filter((item): item is PendingRunUpload => isValidPendingUpload(item, entry.uid))
    : [];
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
        const records = await runReadTx(
          db,
          PENDING_STORE,
          (store) => store.getAll(),
          (result) => (Array.isArray(result) ? result : []),
          'Failed listing pending uploads.',
        );
        const filtered = records
          .filter((item): item is StoredPendingUploadRecord => isValidPendingUpload(item, uid))
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
  const parsed = readJsonStorage<unknown>(storage, `${PENDING_FALLBACK_PREFIX}${uid}`);
  return Array.isArray(parsed)
    ? sortPendingUploads(
        parsed.filter((item): item is PendingRunUpload => isValidPendingUpload(item, uid)),
      )
    : [];
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
        await runWriteTx(
          db,
          PENDING_STORE,
          (store) => store.delete(`${uid}::${requestId}`),
          'Failed removing pending upload.',
        );
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
  const existing = readJsonStorage<unknown>(storage, key);
  if (!Array.isArray(existing)) return;
  const remaining = existing
    .filter((item): item is PendingRunUpload => isValidPendingUpload(item, uid))
    .filter((item) => item.requestId !== requestId);
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
