import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { PublicLiveResults } from '../types';

type LiveResultsMapSubscriber = (
  resultsByRaceId: Record<string, PublicLiveResults>,
  loaded: boolean,
  error: string | null,
) => void;

let cachedMap: Record<string, PublicLiveResults> = {};
let hasSnapshot = false;
let lastError: string | null = null;
let unsubscribeFirestore: (() => void) | null = null;
const subscribers = new Set<LiveResultsMapSubscriber>();

function notifyAll() {
  for (const listener of subscribers) {
    listener(cachedMap, hasSnapshot, lastError);
  }
}

function ensureStarted() {
  if (unsubscribeFirestore || subscribers.size === 0) return;
  unsubscribeFirestore = onSnapshot(
    collection(db, 'liveResults'),
    (snapshot) => {
      const next: Record<string, PublicLiveResults> = {};
      snapshot.forEach((docSnap) => {
        next[docSnap.id] = docSnap.data() as PublicLiveResults;
      });
      cachedMap = next;
      hasSnapshot = true;
      lastError = null;
      notifyAll();
    },
    (err) => {
      lastError = err.message || 'Could not load live results.';
      notifyAll();
    },
  );
}

/**
 * Shares a single Firestore `liveResults` listener across landing, public hub,
 * and race result views so tab switches and race picks incur zero extra reads.
 */
export function subscribeSharedLiveResults(listener: LiveResultsMapSubscriber): () => void {
  subscribers.add(listener);
  if (hasSnapshot || lastError !== null) {
    listener(cachedMap, hasSnapshot, lastError);
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

export function subscribeLiveResultByRace(
  raceId: string,
  listener: (summary: PublicLiveResults | null | undefined) => void,
): () => void {
  return subscribeSharedLiveResults((map, loaded, err) => {
    if (err) {
      listener(null);
      return;
    }
    if (!loaded) {
      listener(undefined);
      return;
    }
    listener(map[raceId] ?? null);
  });
}
