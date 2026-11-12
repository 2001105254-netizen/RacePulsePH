import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Race } from '../types';

type RacesSubscriber = (races: Race[], loaded: boolean, error: string | null) => void;

let cachedRaces: Race[] = [];
let hasSnapshot = false;
let lastError: string | null = null;
let unsubscribeFirestore: (() => void) | null = null;
const subscribers = new Set<RacesSubscriber>();

function notifyAll() {
  for (const listener of subscribers) {
    listener(cachedRaces, hasSnapshot, lastError);
  }
}

function ensureStarted() {
  if (unsubscribeFirestore || subscribers.size === 0) return;
  unsubscribeFirestore = onSnapshot(
    collection(db, 'races'),
    (snapshot) => {
      const list: Race[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ ...(docSnap.data() as Race), id: docSnap.id });
      });
      cachedRaces = list;
      hasSnapshot = true;
      lastError = null;
      notifyAll();
    },
    (err) => {
      lastError = err.message || 'Could not load races.';
      notifyAll();
    },
  );
}

/**
 * Shares a single Firestore collection listener across all active views and exposes
 * the latest cached snapshot immediately so tab switches never re-download race media.
 */
export function subscribeSharedRaces(listener: RacesSubscriber): () => void {
  subscribers.add(listener);
  if (hasSnapshot || lastError !== null) {
    listener(cachedRaces, hasSnapshot, lastError);
  }
  ensureStarted();
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0 && unsubscribeFirestore) {
      unsubscribeFirestore();
      unsubscribeFirestore = null;
      hasSnapshot = false;
    }
  };
}

