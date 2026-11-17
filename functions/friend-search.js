const accessPolicy = require('./access-policy');
const { AccountError } = require('./account-security');
const { enforceRateLimit, GuardError } = require('./request-guard');

const SEARCH_WINDOW_MS = 5 * 60 * 1000;
const SEARCH_MAX_REQUESTS = 60;
const DIRECTORY_CACHE_TTL_MS = 60 * 1000;
const MAX_DIRECTORY_SCAN_DOCS = 5000;
const MAX_RESULTS = 10;

function normalizeSearchQuery(rawQuery) {
  const cleaned = String(rawQuery ?? '')
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (cleaned.length < 2) {
    throw new AccountError(400, 'Enter at least 2 characters of a name or @username.');
  }
  if (cleaned.length > 64) {
    throw new AccountError(400, 'Search query must be 64 characters or fewer.');
  }
  return {
    query: cleaned,
    tokens: cleaned.split(' ').filter(Boolean),
  };
}

function safeCandidate(raw, fallbackUid = '') {
  const uid = typeof raw?.uid === 'string' && raw.uid.trim() ? raw.uid.trim() : fallbackUid;
  if (!uid) return null;
  const username = typeof raw?.username === 'string' ? raw.username.trim().toLowerCase() : '';
  const displayName = typeof raw?.displayName === 'string' && raw.displayName.trim()
    ? raw.displayName.trim().slice(0, 100)
    : username || 'Runner';
  const nickname = typeof raw?.nickname === 'string' && raw.nickname.trim()
    ? raw.nickname.trim().slice(0, 30)
    : undefined;
  const photoURL = typeof raw?.photoURL === 'string' && raw.photoURL.length <= 100000 && raw.photoURL.trim()
    ? raw.photoURL
    : undefined;
  const updatedAt = typeof raw?.updatedAt === 'string' && raw.updatedAt
    ? raw.updatedAt
    : typeof raw?.createdAt === 'string' && raw.createdAt
      ? raw.createdAt
      : '';
  return {
    uid,
    username,
    displayName,
    ...(nickname ? { nickname } : {}),
    ...(photoURL ? { photoURL } : {}),
    updatedAt,
  };
}

function scoreFriendMatch(candidate, query, tokens) {
  const username = String(candidate.username || '').toLowerCase();
  const displayName = String(candidate.displayName || '').toLowerCase();
  const nickname = String(candidate.nickname || '').toLowerCase();
  const words = `${displayName} ${nickname}`
    .split(/[\s._-]+/)
    .filter(Boolean);

  let score = 0;
  if (username && username === query) {
    score = 120;
  } else if (username && username.startsWith(query)) {
    score = 100;
  } else if (words.some((word) => word === query)) {
    score = 90;
  } else if (words.some((word) => word.startsWith(query))) {
    score = 80;
  } else if (username && username.includes(query)) {
    score = 70;
  } else if (displayName.includes(query) || nickname.includes(query)) {
    score = 60;
  } else if (tokens.length > 1) {
    const searchable = `${username} ${displayName} ${nickname}`;
    const allMatch = tokens.every((token) => searchable.includes(token));
    if (allMatch) {
      score = words.some((word) => word.startsWith(tokens[0])) ? 75 : 55;
    }
  }

  if (score === 0) return 0;
  return score + (username ? 2 : 0);
}

async function enforceFriendSearchLimit({ db, secret, uid, now = Date.now }) {
  try {
    await enforceRateLimit({
      db,
      secret,
      namespace: 'friend_search',
      identifier: uid,
      limit: SEARCH_MAX_REQUESTS,
      windowMs: SEARCH_WINDOW_MS,
      message: 'Too many searches. Wait a moment before searching again.',
      now,
    });
  } catch (error) {
    if (error instanceof GuardError) {
      throw new AccountError(error.status, error.message, error.retryAfter);
    }
    throw error;
  }
}

const directoryCacheByDb = new WeakMap();

async function readSafeCollection(db, name, fields) {
  let queryRef = db.collection(name);
  if (typeof queryRef.select === 'function') {
    queryRef = queryRef.select(...fields);
  }
  if (typeof queryRef.limit === 'function') {
    queryRef = queryRef.limit(MAX_DIRECTORY_SCAN_DOCS);
  }
  return queryRef.get();
}

async function loadRunnerDirectorySnapshot(db, now = Date.now) {
  const currentMs = now();
  let state = directoryCacheByDb.get(db);
  if (state?.candidates && currentMs - state.loadedAt < DIRECTORY_CACHE_TTL_MS) {
    return state;
  }
  if (state?.inFlight) {
    return state.inFlight;
  }

  const loadPromise = (async () => {
    const [directorySnap, usersSnap] = await Promise.all([
      readSafeCollection(db, 'friendDirectory', ['uid', 'username', 'displayName', 'nickname', 'photoURL', 'updatedAt']),
      readSafeCollection(db, 'users', ['uid', 'username', 'displayName', 'nickname', 'photoURL', 'accessRemoved', 'createdAt']),
    ]);

    const removedUids = new Set();
    const byUid = new Map();

    usersSnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const uid = typeof data.uid === 'string' && data.uid ? data.uid : docSnap.id;
      if (data.accessRemoved) {
        removedUids.add(uid);
        return;
      }
      const candidate = safeCandidate(data, uid);
      if (candidate) byUid.set(candidate.uid, candidate);
    });

    directorySnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const candidate = safeCandidate({ ...data, username: data.username || docSnap.id });
      if (!candidate || removedUids.has(candidate.uid)) return;
      const prev = byUid.get(candidate.uid);
      byUid.set(candidate.uid, {
        ...(prev || {}),
        ...candidate,
        username: candidate.username || prev?.username || '',
        displayName: candidate.displayName || prev?.displayName || 'Runner',
        ...(candidate.nickname || prev?.nickname ? { nickname: candidate.nickname || prev?.nickname } : {}),
        ...(candidate.photoURL || prev?.photoURL ? { photoURL: candidate.photoURL || prev?.photoURL } : {}),
      });
    });

    const nextState = {
      loadedAt: now(),
      removedUids,
      candidates: Array.from(byUid.values()),
      inFlight: null,
    };
    directoryCacheByDb.set(db, nextState);
    return nextState;
  })().catch((err) => {
    const prev = directoryCacheByDb.get(db);
    if (prev) {
      directoryCacheByDb.set(db, { ...prev, inFlight: null });
    }
    throw err;
  });

  state = { ...(state || {}), inFlight: loadPromise };
  directoryCacheByDb.set(db, state);
  return loadPromise;
}

async function searchRunnerDirectory({ db, secret, callerUid, rawQuery, now = Date.now }) {
  const { query, tokens } = normalizeSearchQuery(rawQuery);
  const [callerUserSnap, callerAccessSnap, callerRemovedSnap] = await Promise.all([
    db.doc(`users/${callerUid}`).get(),
    db.doc(`userAccess/${callerUid}`).get(),
    db.doc(`removedAccounts/${callerUid}`).get(),
  ]);

  if (callerRemovedSnap.exists || !callerUserSnap.exists || callerUserSnap.data()?.accessRemoved) {
    throw new AccountError(403, 'This account does not have active app access.');
  }
  if (!accessPolicy.can(callerUserSnap.data(), callerAccessSnap.exists ? callerAccessSnap.data() : undefined, 'personal.friends')) {
    throw new AccountError(403, 'Runner friends access is disabled for this account.');
  }

  await enforceFriendSearchLimit({ db, secret, uid: callerUid, now });

  const { candidates, removedUids } = await loadRunnerDirectorySnapshot(db, now);

  const ranked = [];
  for (const candidate of candidates) {
    if (candidate.uid === callerUid || removedUids.has(candidate.uid)) continue;
    const score = scoreFriendMatch(candidate, query, tokens);
    if (score > 0) {
      ranked.push({ candidate, score });
    }
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const nameCompare = a.candidate.displayName.localeCompare(b.candidate.displayName, undefined, { sensitivity: 'base' });
    if (nameCompare !== 0) return nameCompare;
    return a.candidate.username.localeCompare(b.candidate.username, undefined, { sensitivity: 'base' });
  });

  return {
    results: ranked.slice(0, MAX_RESULTS).map((entry) => entry.candidate),
  };
}

module.exports = {
  normalizeSearchQuery,
  scoreFriendMatch,
  searchRunnerDirectory,
};
