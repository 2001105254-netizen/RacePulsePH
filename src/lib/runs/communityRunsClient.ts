import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../../firebase';
import { authenticatedFetch } from '../access';
import { CircuitOpenError, parseRetryAfterSeconds } from '../resilientFetch';
import { round1 } from './calorieEngine';
import type {
  RecordedRunCourseRef,
  RecordedRunMode,
  RecordedRunPrivacy,
  RecordedRunSummary,
  RecordedTrackPoint,
} from './types';

export const DEFAULT_COMMUNITY_API_URL =
  'https://asia-southeast1-racepulseph.cloudfunctions.net/communityApi';
export const MAX_SERVER_TRACK_POINTS = 5000;
export const MAX_TRIM_CREDIT_M = 250;
export const MAX_STORAGE_TRACK_BYTES = 5 * 1024 * 1024;
const STORAGE_UPLOAD_TIMEOUT_MS = 12_000;
const MIN_ELEVATION_M = -450;
const MAX_ELEVATION_M = 9000;

const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const VALID_REQUEST_ID_RE = /^[a-zA-Z0-9-]{16,64}$/;
const RANDOM_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export interface CommunityRunApiErrorOptions {
  retryAfter?: number;
  retryable?: boolean;
  offline?: boolean;
  cause?: unknown;
}

export function isRetryableCommunityStatus(
  status: number,
  options: { offline?: boolean } = {},
): boolean {
  if (status === 0) return true;
  if (status === 408 || status === 429 || status >= 500) return true;
  if (status === 401 && options.offline === true) return true;
  return false;
}

export class CommunityRunApiError extends Error {
  public readonly status: number;
  public readonly retryAfter?: number;
  public readonly retryable: boolean;

  constructor(
    message: string,
    status: number,
    options: CommunityRunApiErrorOptions = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'CommunityRunApiError';
    this.status = status;
    this.retryAfter =
      typeof options.retryAfter === 'number' &&
      Number.isFinite(options.retryAfter) &&
      options.retryAfter > 0
        ? Math.ceil(options.retryAfter)
        : undefined;
    const isOffline =
      options.offline ??
      (typeof navigator !== 'undefined' && navigator.onLine === false);
    this.retryable =
      options.retryable ?? isRetryableCommunityStatus(status, { offline: isOffline });
  }
}

export function getCommunityApiBaseUrl(configuredUrl?: string): string {
  const raw =
    configuredUrl !== undefined
      ? configuredUrl
      : typeof import.meta !== 'undefined'
        ? (import.meta.env?.VITE_COMMUNITY_API_URL as string | undefined)
        : undefined;
  const trimmed = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
  return trimmed || DEFAULT_COMMUNITY_API_URL;
}

export function createCommunityRequestId(): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    const uuid = cryptoObj.randomUUID();
    if (VALID_REQUEST_ID_RE.test(uuid)) {
      return uuid;
    }
  }
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(24);
    cryptoObj.getRandomValues(bytes);
    let token = '';
    for (let i = 0; i < bytes.length; i += 1) {
      token += RANDOM_ID_ALPHABET[bytes[i] % RANDOM_ID_ALPHABET.length];
    }
    return `req-${token}`;
  }
  const timePart = Date.now().toString(36);
  const randA = Math.floor(Math.random() * 1e12).toString(36);
  const randB = Math.floor(Math.random() * 1e12).toString(36);
  return `req-${timePart}-${randA}-${randB}`.slice(0, 64).padEnd(16, '0');
}

export function createRecordedRunId(): string {
  return `run_${createCommunityRequestId().replace(/-/g, '').slice(0, 28)}`;
}

/**
 * Downsamples a track to at most `maxPoints` while retaining start, finish,
 * pause/resume `segmentBreak` markers, and original chronological ordering.
 */
export function capServerTrackPoints(
  points: RecordedTrackPoint[],
  maxPoints = MAX_SERVER_TRACK_POINTS,
): RecordedTrackPoint[] {
  if (!Array.isArray(points) || points.length === 0 || maxPoints <= 0) {
    return [];
  }
  if (points.length <= maxPoints) {
    return points.map((pt) => ({ ...pt }));
  }
  if (maxPoints === 1) {
    return [{ ...points[0] }];
  }

  const lastIdx = points.length - 1;
  const mandatory = new Set<number>([0, lastIdx]);
  for (let i = 1; i < lastIdx; i += 1) {
    if (points[i]?.segmentBreak === true) {
      mandatory.add(i);
    }
  }

  const mandatorySorted = Array.from(mandatory).sort((a, b) => a - b);
  if (mandatorySorted.length >= maxPoints) {
    const picked: number[] = [0];
    const interior = mandatorySorted.slice(1, -1);
    const interiorSlots = maxPoints - 2;
    for (let k = 0; k < interiorSlots; k += 1) {
      const pos =
        interiorSlots === 1
          ? Math.floor(interior.length / 2)
          : Math.round((k / (interiorSlots - 1)) * (interior.length - 1));
      picked.push(interior[pos]);
    }
    picked.push(lastIdx);
    return picked.map((idx) => ({ ...points[idx] }));
  }

  const chosen = new Set<number>(mandatorySorted);
  const remainingSlots = maxPoints - chosen.size;
  const candidates: number[] = [];
  for (let i = 1; i < lastIdx; i += 1) {
    if (!chosen.has(i)) {
      candidates.push(i);
    }
  }

  for (let k = 0; k < remainingSlots; k += 1) {
    const pos =
      remainingSlots === 1
        ? Math.floor(candidates.length / 2)
        : Math.round((k / (remainingSlots - 1)) * (candidates.length - 1));
    chosen.add(candidates[pos]);
  }

  return Array.from(chosen)
    .sort((a, b) => a - b)
    .map((idx) => ({ ...points[idx] }));
}

function sanitizeServerTrackPoints(rawPoints: RecordedTrackPoint[]): RecordedTrackPoint[] {
  const sanitized: RecordedTrackPoint[] = [];
  let prevTs = 0;

  for (const pt of rawPoints) {
    if (
      !pt ||
      !Number.isFinite(pt.lat) ||
      !Number.isFinite(pt.lon) ||
      Math.abs(pt.lat) > 90 ||
      Math.abs(pt.lon) > 180 ||
      !Number.isFinite(pt.timestampMs) ||
      pt.timestampMs <= 0
    ) {
      continue;
    }

    const timestampMs = Math.max(prevTs, Math.round(pt.timestampMs));
    prevTs = timestampMs;

    const clean: RecordedTrackPoint = {
      lat: pt.lat,
      lon: pt.lon,
      accuracyM:
        typeof pt.accuracyM === 'number' && Number.isFinite(pt.accuracyM) && pt.accuracyM >= 0
          ? round1(pt.accuracyM)
          : 0,
      timestampMs,
    };

    if (
      typeof pt.ele === 'number' &&
      Number.isFinite(pt.ele) &&
      pt.ele >= MIN_ELEVATION_M &&
      pt.ele <= MAX_ELEVATION_M
    ) {
      clean.ele = round1(pt.ele);
    }
    if (typeof pt.speedMps === 'number' && Number.isFinite(pt.speedMps) && pt.speedMps >= 0) {
      clean.speedMps = Number(pt.speedMps.toFixed(2));
    }
    if (pt.segmentBreak === true) {
      clean.segmentBreak = true;
    }

    sanitized.push(clean);
  }

  if (sanitized.length === 1) {
    return [];
  }
  return capServerTrackPoints(sanitized, MAX_SERVER_TRACK_POINTS);
}

function normalizeUtcIso(raw: string, fieldName: string): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  const parsedMs = trimmed ? Date.parse(trimmed) : Number.NaN;
  if (!Number.isFinite(parsedMs)) {
    throw new CommunityRunApiError(`Valid ${fieldName} timestamp is required.`, 400);
  }
  return new Date(parsedMs).toISOString();
}

function clampTrimMeters(raw: number, enabled: boolean): number {
  if (!enabled || !Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return Math.min(MAX_TRIM_CREDIT_M, round1(raw));
}

function sanitizeCourseRef(courseRef?: RecordedRunCourseRef): RecordedRunCourseRef | undefined {
  if (!courseRef) return undefined;
  const raceId = courseRef.raceId.trim();
  const distanceId = courseRef.distanceId.trim();
  const raceName = courseRef.raceName.trim();
  const distanceLabel = courseRef.distanceLabel.trim();
  if (!VALID_ID_RE.test(raceId) || !VALID_ID_RE.test(distanceId)) {
    throw new CommunityRunApiError('Invalid course reference ID.', 400);
  }
  if (!raceName || !distanceLabel || !Number.isFinite(courseRef.advertisedKm) || courseRef.advertisedKm <= 0) {
    throw new CommunityRunApiError('Incomplete course reference metadata.', 400);
  }
  const publicationId =
    courseRef.publicationId !== undefined && courseRef.publicationId !== null
      ? String(courseRef.publicationId).trim()
      : '';
  if (publicationId && !VALID_ID_RE.test(publicationId)) {
    throw new CommunityRunApiError('Invalid publication reference ID.', 400);
  }
  return {
    raceId,
    distanceId,
    raceName: raceName.slice(0, 150),
    distanceLabel: distanceLabel.slice(0, 50),
    advertisedKm: courseRef.advertisedKm,
    ...(publicationId ? { publicationId } : {}),
    ...(courseRef.region?.trim() ? { region: courseRef.region.trim().slice(0, 80) } : {}),
  };
}

export interface CompleteRecordedRunInput {
  requestId?: string;
  runId: string;
  mode: RecordedRunMode;
  privacy: RecordedRunPrivacy;
  title: string;
  startedAt: string;
  finishedAt: string;
  movingTimeMs: number;
  clientDistanceM: number;
  trimmedHeadM: number;
  trimmedTailM: number;
  homePrivacyTrimEnabled: boolean;
  courseRef?: RecordedRunCourseRef;
  trackPoints: RecordedTrackPoint[];
  trackStoragePath?: string;
  storageUploadSettled?: boolean;
}

export interface CompleteRunRequestPayload {
  requestId: string;
  runId: string;
  mode: RecordedRunMode;
  privacy: RecordedRunPrivacy;
  title: string;
  startedAt: string;
  finishedAt: string;
  movingTimeMs: number;
  clientDistanceM: number;
  trimmedHeadM: number;
  trimmedTailM: number;
  homePrivacyTrimEnabled: boolean;
  courseRef?: RecordedRunCourseRef;
  trackStoragePath?: string;
  trackPoints: RecordedTrackPoint[];
}

export function buildCompleteRunRequestPayload(
  input: CompleteRecordedRunInput,
): CompleteRunRequestPayload {
  const runId = typeof input.runId === 'string' ? input.runId.trim() : '';
  if (!VALID_ID_RE.test(runId)) {
    throw new CommunityRunApiError('Invalid runId.', 400);
  }

  const requestId =
    input.requestId !== undefined ? input.requestId.trim() : createCommunityRequestId();
  if (!VALID_REQUEST_ID_RE.test(requestId)) {
    throw new CommunityRunApiError('Valid requestId is required.', 400);
  }

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 120) {
    throw new CommunityRunApiError('Run title must be between 1 and 120 characters.', 400);
  }

  const startedAt = normalizeUtcIso(input.startedAt, 'startedAt');
  const finishedAt = normalizeUtcIso(input.finishedAt, 'finishedAt');
  if (Date.parse(finishedAt) <= Date.parse(startedAt)) {
    throw new CommunityRunApiError('Run finish time must be after start time.', 400);
  }

  const movingTimeMs =
    typeof input.movingTimeMs === 'number' && Number.isFinite(input.movingTimeMs)
      ? Math.max(0, Math.round(input.movingTimeMs))
      : 0;
  const clientDistanceM =
    typeof input.clientDistanceM === 'number' && Number.isFinite(input.clientDistanceM)
      ? Math.max(0, round1(input.clientDistanceM))
      : 0;

  const homePrivacyTrimEnabled = Boolean(input.homePrivacyTrimEnabled);
  const trimmedHeadM = clampTrimMeters(input.trimmedHeadM, homePrivacyTrimEnabled);
  const trimmedTailM = clampTrimMeters(input.trimmedTailM, homePrivacyTrimEnabled);
  const courseRef = sanitizeCourseRef(input.courseRef);
  const trackPoints = sanitizeServerTrackPoints(input.trackPoints ?? []);
  const trackStoragePath = input.trackStoragePath?.trim() || undefined;

  return {
    requestId,
    runId,
    mode: input.mode,
    privacy: input.privacy,
    title,
    startedAt,
    finishedAt,
    movingTimeMs,
    clientDistanceM,
    trimmedHeadM,
    trimmedTailM,
    homePrivacyTrimEnabled,
    ...(courseRef ? { courseRef } : {}),
    ...(trackStoragePath ? { trackStoragePath } : {}),
    trackPoints,
  };
}

export async function uploadRunTrackJsonToStorage(
  uid: string,
  runId: string,
  trackPoints: RecordedTrackPoint[],
  options: { timeoutMs?: number } = {},
): Promise<string | undefined> {
  if (!uid || !VALID_ID_RE.test(runId) || !Array.isArray(trackPoints) || trackPoints.length === 0) {
    return undefined;
  }

  const timeoutMs = Math.max(1000, options.timeoutMs ?? STORAGE_UPLOAD_TIMEOUT_MS);
  const objectPath = `run-tracks/${uid}/${runId}.json`;
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

  try {
    const json = JSON.stringify({
      version: 1,
      runId,
      trackPoints,
    });
    const blob = new Blob([json], { type: 'application/json' });
    if (blob.size >= MAX_STORAGE_TRACK_BYTES) {
      console.warn('[communityRunsClient] track archive exceeds 5 MB limit; skipping Storage upload');
      return undefined;
    }

    const uploadPromise = uploadBytes(ref(storage, objectPath), blob, {
      contentType: 'application/json',
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = globalThis.setTimeout(() => {
        reject(new Error('Storage upload timed out.'));
      }, timeoutMs);
    });

    await Promise.race([uploadPromise, timeoutPromise]);
    return objectPath;
  } catch (err) {
    console.warn('[communityRunsClient] best-effort track storage upload skipped', err);
    return undefined;
  } finally {
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
    }
  }
}

function normalizeThrownError(err: unknown): CommunityRunApiError {
  if (err instanceof CommunityRunApiError) {
    return err;
  }
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  if (err instanceof CircuitOpenError) {
    return new CommunityRunApiError(err.message, 503, {
      retryAfter: err.retryAfter,
      retryable: true,
      offline: isOffline,
      cause: err,
    });
  }

  const errCode =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  if (errCode === 'auth/network-request-failed') {
    return new CommunityRunApiError(
      'Unable to refresh your sign-in session while offline. Your run stays queued locally.',
      0,
      { retryable: true, offline: true, cause: err },
    );
  }

  const message =
    err instanceof Error && err.message ? err.message : 'Unable to reach RacePulsePH right now.';
  if (message === 'Sign in to continue.') {
    return new CommunityRunApiError(
      isOffline
        ? 'Offline: your run is saved locally and will sync once signed in online.'
        : message,
      401,
      { offline: isOffline, cause: err },
    );
  }

  return new CommunityRunApiError(message, 0, {
    retryable: true,
    offline: isOffline,
    cause: err,
  });
}

async function postCommunityCommand(
  path: '/runs/complete' | '/runs/update' | '/runs/delete',
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `${getCommunityApiBaseUrl()}${path}`;
  let response: Response;
  try {
    response = await authenticatedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw normalizeThrownError(err);
  }

  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const retryAfter = parseRetryAfterSeconds(response, result);
    const serverError =
      typeof result.error === 'string' && result.error.trim() ? result.error.trim() : '';
    const message =
      response.status === 429 && retryAfter > 0
        ? serverError || `Too many requests. Wait ${retryAfter}s and try again.`
        : serverError || `Community command failed (HTTP ${response.status}).`;
    throw new CommunityRunApiError(message, response.status, { retryAfter });
  }
  return result;
}

export async function prepareCompleteRecordedRunInput(
  input: CompleteRecordedRunInput,
  options: {
    uid?: string | null;
    uploader?: typeof uploadRunTrackJsonToStorage;
  } = {},
): Promise<CompleteRecordedRunInput> {
  const basePayload = buildCompleteRunRequestPayload(input);
  let resolvedPath = basePayload.trackStoragePath;
  const uid = options.uid !== undefined ? options.uid : auth.currentUser?.uid;
  const uploader = options.uploader ?? uploadRunTrackJsonToStorage;

  if (!resolvedPath && !input.storageUploadSettled && uid && basePayload.trackPoints.length >= 2) {
    resolvedPath = await uploader(uid, basePayload.runId, input.trackPoints);
  }

  return {
    ...input,
    requestId: basePayload.requestId,
    ...(resolvedPath ? { trackStoragePath: resolvedPath } : {}),
    storageUploadSettled: true,
  };
}

export async function completeRecordedRun(
  input: CompleteRecordedRunInput,
  options?: {
    uid?: string | null;
    uploader?: typeof uploadRunTrackJsonToStorage;
    sender?: (
      path: '/runs/complete',
      payload: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
  },
): Promise<RecordedRunSummary> {
  const prepared =
    input.storageUploadSettled || input.trackStoragePath
      ? input
      : await prepareCompleteRecordedRunInput(input, options);
  const finalPayload = buildCompleteRunRequestPayload(prepared);
  const sender = options?.sender ?? postCommunityCommand;

  const result = await sender(
    '/runs/complete',
    finalPayload as unknown as Record<string, unknown>,
  );
  if (!result.run || typeof result.run !== 'object') {
    throw new CommunityRunApiError('Server did not return a verified run summary.', 502, {
      retryable: true,
    });
  }
  return result.run as RecordedRunSummary;
}

export async function updateRecordedRun(input: {
  runId: string;
  title?: string;
  privacy?: RecordedRunPrivacy;
  requestId?: string;
}): Promise<RecordedRunSummary> {
  const runId = typeof input.runId === 'string' ? input.runId.trim() : '';
  if (!VALID_ID_RE.test(runId)) {
    throw new CommunityRunApiError('Invalid runId.', 400);
  }
  const requestId =
    input.requestId !== undefined ? input.requestId.trim() : createCommunityRequestId();
  if (!VALID_REQUEST_ID_RE.test(requestId)) {
    throw new CommunityRunApiError('Valid requestId is required.', 400);
  }

  const body: Record<string, unknown> = { requestId, runId };
  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (!trimmed || trimmed.length > 120) {
      throw new CommunityRunApiError('Run title must be between 1 and 120 characters.', 400);
    }
    body.title = trimmed;
  }
  if (input.privacy !== undefined) {
    body.privacy = input.privacy;
  }
  if (body.title === undefined && body.privacy === undefined) {
    throw new CommunityRunApiError('Provide title or privacy to update.', 400);
  }

  const result = await postCommunityCommand('/runs/update', body);
  if (!result.run || typeof result.run !== 'object') {
    throw new CommunityRunApiError('Server did not return updated run details.', 502, {
      retryable: true,
    });
  }
  return result.run as RecordedRunSummary;
}

export async function deleteRecordedRun(
  runId: string,
  requestId?: string,
): Promise<{ deleted: true; runId: string }> {
  const trimmedRunId = typeof runId === 'string' ? runId.trim() : '';
  if (!VALID_ID_RE.test(trimmedRunId)) {
    throw new CommunityRunApiError('Invalid runId.', 400);
  }
  const resolvedRequestId =
    requestId !== undefined ? requestId.trim() : createCommunityRequestId();
  if (!VALID_REQUEST_ID_RE.test(resolvedRequestId)) {
    throw new CommunityRunApiError('Valid requestId is required.', 400);
  }

  await postCommunityCommand('/runs/delete', {
    requestId: resolvedRequestId,
    runId: trimmedRunId,
  });
  return { deleted: true, runId: trimmedRunId };
}

export function subscribeMyRecordedRuns(
  uid: string,
  onUpdate: (runs: RecordedRunSummary[], loaded: boolean, error: string | null) => void,
): () => void {
  if (!uid) {
    onUpdate([], true, null);
    return () => undefined;
  }

  const runsQuery = query(
    collection(db, 'recordedRuns'),
    where('uid', '==', uid),
    orderBy('startedAt', 'desc'),
    limit(60),
  );

  return onSnapshot(
    runsQuery,
    (snapshot) => {
      const runs = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as RecordedRunSummary;
        return {
          ...data,
          runId: data.runId || docSnap.id,
        };
      });
      onUpdate(runs, true, null);
    },
    (error) => {
      console.warn('[communityRunsClient] recordedRuns subscription failed', error);
      onUpdate([], true, 'Unable to load recorded runs.');
    },
  );
}
