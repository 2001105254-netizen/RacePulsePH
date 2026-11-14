import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import { getWaveStartTime } from './timing';
import {
  ChipRead,
  HighlightBorderPreset,
  HighlightCardLayoutMode,
  HighlightCornerGeometry,
  HighlightFlowDirection,
  HighlightHoverBehavior,
  HighlightPlacement,
  HighlightsMarqueeConfig,
  HighlightSurfaceFinish,
  PublicLeaderboardEntry,
  PublicLiveResults,
  Race,
  RunnerHighlight,
  RunnerProfile,
  RunnerResult,
  UserProfile,
} from '../types';

export const DEFAULT_MARQUEE_CONFIG: HighlightsMarqueeConfig = {
  speedPxPerSec: 44,
  hoverBehavior: 'stop',
  direction: 'left',
  layoutMode: 'card',
  cardGapPx: 20,
  edgeFadePx: 48,
  pinPodiumFirst: true,
  filterRaceId: '',
  hideExpired: true,
};

export const HIGHLIGHT_BORDER_PRESETS: ReadonlyArray<{
  id: HighlightBorderPreset;
  label: string;
  summary: string;
  defaultAccent: string;
}> = [
  {
    id: 'liquid-gold',
    label: 'Liquid Gold',
    summary: 'Dual rotating conic frame with rising bottom ember particles.',
    defaultAccent: '#f5b731',
  },
  {
    id: 'cyber-hud',
    label: 'Cyber HUD',
    summary: '45 deg chamfered corners, locking brackets, and race-code ticker.',
    defaultAccent: '#22d3ee',
  },
  {
    id: 'sonic-wave',
    label: 'Sonic Wave',
    summary: 'Pace-synced pulsing perimeter wave tied to runner speed.',
    defaultAccent: '#ff3b30',
  },
  {
    id: 'holo-foil',
    label: 'Holo Foil',
    summary: 'Iridescent spectrum border that shifts hue across the viewport.',
    defaultAccent: '#a855f7',
  },
  {
    id: 'carbon-minimal',
    label: 'Carbon Minimal',
    summary: 'Woven carbon bezel with razor-thin top and bottom laser rules.',
    defaultAccent: '#ff3b30',
  },
];

export const HIGHLIGHT_CORNER_GEOMETRIES: ReadonlyArray<{
  id: HighlightCornerGeometry;
  label: string;
  detail: string;
}> = [
  { id: 'rounded', label: 'Rounded (16px)', detail: 'Soft broadcast trading card corners' },
  { id: 'sharp', label: 'Sharp (0px)', detail: 'Squared editorial slab geometry' },
  { id: 'tactical', label: 'Tactical Cut', detail: '45 deg chamfered telemetry polygon' },
];

export const HIGHLIGHT_SURFACE_FINISHES: ReadonlyArray<{
  id: HighlightSurfaceFinish;
  label: string;
}> = [
  { id: 'matte', label: 'Matte' },
  { id: 'glossy', label: 'Glossy Sweep' },
  { id: 'topo', label: 'Topo Map' },
];

export const HIGHLIGHT_PLACEMENTS: readonly HighlightPlacement[] = [
  '1st',
  '2nd',
  '3rd',
  'Top 10',
  'Finisher',
  'Record Holder',
];

export const HIGHLIGHT_DISTANCES = ['5K', '10K', '16K', '21K', '32K', '42K', '50K'] as const;

export const HIGHLIGHT_CAPS = {
  runnerName: 36,
  bibNumber: 16,
  placement: 24,
  distance: 16,
  chipTime: 18,
  gunTime: 18,
  pace: 18,
  splitPace: 18,
  raceName: 48,
  raceCode: 20,
  raceDate: 20,
  runClub: 34,
  badgeStamp: 22,
} as const;

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function sanitizeHexColor(input: string | undefined, fallback = '#ff3b30'): string {
  const trimmed = (input || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed.split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

export function capText(value: string | undefined, max: number): string {
  return (value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

/**
 * Parses a pace string such as "3:45 /km" or "04:12" and converts it into a
 * heartbeat animation period in milliseconds (faster pace = shorter period).
 */
export function parsePacePulseMs(pace: string | undefined): number {
  const match = (pace || '').match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
  if (!match) return 1100;
  const mins = Number(match[1]);
  const secs = Number(match[2]);
  const totalSec = mins * 60 + secs;
  // Map 180s (3:00/km) -> 560ms, 540s (9:00/km) -> 1650ms
  const normalized = clampNumber((totalSec - 180) / (540 - 180), 0, 1);
  return Math.round(560 + normalized * (1650 - 560));
}

export function placementRankWeight(placement: string | undefined): number {
  const text = (placement || '').trim().toLowerCase();
  if (text.includes('record')) return 0;
  if (text === '1st' || text.startsWith('1st ') || text.includes('champion')) return 1;
  if (text === '2nd' || text.startsWith('2nd ')) return 2;
  if (text === '3rd' || text.startsWith('3rd ')) return 3;
  if (text.includes('top 10') || text.includes('top10')) return 4;
  return 5;
}

export function isHighlightExpired(item: Pick<RunnerHighlight, 'expiresAt'>, nowIsoDate?: string): boolean {
  const exp = (item.expiresAt || '').trim();
  if (!exp) return false;
  const today = nowIsoDate || new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(exp)) {
    return exp < today;
  }
  const parsed = Date.parse(exp);
  if (Number.isNaN(parsed)) return false;
  return parsed < Date.now();
}

export function applyPlaylistRules(
  items: RunnerHighlight[],
  config: HighlightsMarqueeConfig,
  nowIsoDate?: string,
): RunnerHighlight[] {
  let list = [...items];

  if (config.hideExpired) {
    list = list.filter((item) => !isHighlightExpired(item, nowIsoDate));
  }

  const filter = (config.filterRaceId || '').trim();
  if (filter === 'latest' && list.length > 0) {
    const latestRaceDate = list.reduce((best, cur) => (cur.raceDate > best ? cur.raceDate : best), '');
    const latestRaceItem = list.find((cur) => cur.raceDate === latestRaceDate);
    if (latestRaceItem?.raceId) {
      list = list.filter((item) => item.raceId === latestRaceItem.raceId);
    } else if (latestRaceDate) {
      list = list.filter((item) => item.raceDate === latestRaceDate);
    }
  } else if (filter) {
    list = list.filter((item) => item.raceId === filter || item.raceName === filter);
  }

  list.sort((a, b) => {
    const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinDiff !== 0) return pinDiff;

    if (config.pinPodiumFirst) {
      const rankDiff = placementRankWeight(a.placement) - placementRankWeight(b.placement);
      if (rankDiff !== 0) return rankDiff;
    }

    const timeB = Date.parse(b.updatedAt || b.createdAt || '') || 0;
    const timeA = Date.parse(a.updatedAt || a.createdAt || '') || 0;
    return timeB - timeA;
  });

  return list;
}

export function normalizeHighlightConfig(raw: Partial<HighlightsMarqueeConfig> | undefined | null): HighlightsMarqueeConfig {
  const hoverBehavior: HighlightHoverBehavior =
    raw?.hoverBehavior === 'slow' || raw?.hoverBehavior === 'keep' || raw?.hoverBehavior === 'stop'
      ? raw.hoverBehavior
      : DEFAULT_MARQUEE_CONFIG.hoverBehavior;
  const direction: HighlightFlowDirection =
    raw?.direction === 'right' || raw?.direction === 'left'
      ? raw.direction
      : DEFAULT_MARQUEE_CONFIG.direction;
  const layoutMode: HighlightCardLayoutMode =
    raw?.layoutMode === 'pill' || raw?.layoutMode === 'card'
      ? raw.layoutMode
      : DEFAULT_MARQUEE_CONFIG.layoutMode;

  return {
    speedPxPerSec: clampNumber(Number(raw?.speedPxPerSec ?? DEFAULT_MARQUEE_CONFIG.speedPxPerSec), 10, 120),
    hoverBehavior,
    direction,
    layoutMode,
    cardGapPx: clampNumber(Number(raw?.cardGapPx ?? DEFAULT_MARQUEE_CONFIG.cardGapPx), 12, 32),
    edgeFadePx: clampNumber(Number(raw?.edgeFadePx ?? DEFAULT_MARQUEE_CONFIG.edgeFadePx), 0, 120),
    pinPodiumFirst: typeof raw?.pinPodiumFirst === 'boolean' ? raw.pinPodiumFirst : DEFAULT_MARQUEE_CONFIG.pinPodiumFirst,
    filterRaceId: typeof raw?.filterRaceId === 'string' ? raw.filterRaceId.slice(0, 80) : DEFAULT_MARQUEE_CONFIG.filterRaceId,
    hideExpired: typeof raw?.hideExpired === 'boolean' ? raw.hideExpired : DEFAULT_MARQUEE_CONFIG.hideExpired,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : undefined,
    updatedBy: typeof raw?.updatedBy === 'string' ? raw.updatedBy : undefined,
  };
}

export function sanitizeHighlightPayload(draft: RunnerHighlight): RunnerHighlight {
  const now = new Date().toISOString();
  const safeId = (draft.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || `hl_${Date.now().toString(36)}`;
  const mode = draft.mode === 'duo' ? 'duo' : 'solo';

  const base: RunnerHighlight = {
    id: safeId,
    mode,
    runnerName: capText(draft.runnerName, HIGHLIGHT_CAPS.runnerName) || 'Runner',
    bibNumber: capText(draft.bibNumber, HIGHLIGHT_CAPS.bibNumber) || '001',
    placement: capText(draft.placement, HIGHLIGHT_CAPS.placement) || 'Finisher',
    distance: capText(draft.distance, HIGHLIGHT_CAPS.distance) || '10K',
    chipTime: capText(draft.chipTime, HIGHLIGHT_CAPS.chipTime) || '00:00:00',
    pace: capText(draft.pace, HIGHLIGHT_CAPS.pace) || '5:00 /km',
    raceName: capText(draft.raceName, HIGHLIGHT_CAPS.raceName) || 'RacePulsePH Event',
    raceDate: capText(draft.raceDate, HIGHLIGHT_CAPS.raceDate) || now.slice(0, 10),
    photoUrl: (draft.photoUrl || '').trim(),
    borderPreset: draft.borderPreset || 'liquid-gold',
    cornerGeometry: draft.cornerGeometry || 'rounded',
    accentColor: sanitizeHexColor(draft.accentColor, '#ff3b30'),
    glowIntensity: Math.round(clampNumber(Number(draft.glowIntensity ?? 72), 0, 100)),
    surfaceFinish: draft.surfaceFinish || 'matte',
    createdAt: draft.createdAt || now,
    updatedAt: now,
  };

  if (mode === 'duo') {
    const pName = capText(draft.partnerName, HIGHLIGHT_CAPS.runnerName);
    const pBib = capText(draft.partnerBibNumber, HIGHLIGHT_CAPS.bibNumber);
    const pPhoto = (draft.partnerPhotoUrl || '').trim();
    const sSplit = capText(draft.soloSplitTime, HIGHLIGHT_CAPS.chipTime);
    const pSplit = capText(draft.partnerSplitTime, HIGHLIGHT_CAPS.chipTime);
    const avgPace = capText(draft.combinedAvgPace, HIGHLIGHT_CAPS.pace);
    if (pName) base.partnerName = pName;
    if (pBib) base.partnerBibNumber = pBib;
    if (pPhoto) base.partnerPhotoUrl = pPhoto;
    if (sSplit) base.soloSplitTime = sSplit;
    if (pSplit) base.partnerSplitTime = pSplit;
    if (avgPace) base.combinedAvgPace = avgPace;
  }

  const gunTime = capText(draft.gunTime, HIGHLIGHT_CAPS.gunTime);
  const splitPace = capText(draft.splitPace, HIGHLIGHT_CAPS.splitPace);
  const runClub = capText(draft.runClub, HIGHLIGHT_CAPS.runClub);
  const raceId = (draft.raceId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const raceCode = capText(draft.raceCode, HIGHLIGHT_CAPS.raceCode).toUpperCase();
  const badgeStamp = capText(draft.badgeStamp, HIGHLIGHT_CAPS.badgeStamp).toUpperCase();
  const expiresAt = capText(draft.expiresAt, 24);
  const createdBy = (draft.createdBy || '').trim().slice(0, 128);

  if (gunTime) base.gunTime = gunTime;
  if (splitPace) base.splitPace = splitPace;
  if (runClub) base.runClub = runClub;
  if (raceId) base.raceId = raceId;
  if (raceCode) base.raceCode = raceCode;
  if (badgeStamp) base.badgeStamp = badgeStamp;
  if (typeof draft.pinned === 'boolean') base.pinned = draft.pinned;
  if (expiresAt) base.expiresAt = expiresAt;
  if (createdBy) base.createdBy = createdBy;

  return base;
}

export function deriveRaceCode(raceName: string, raceDate: string): string {
  const words = raceName
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const prefix = words.slice(0, 3).map((w) => w.slice(0, 3)).join('-');
  const year = (raceDate || '').slice(0, 4);
  return `${prefix || 'RPPH'}${year ? `-${year}` : ''}`.slice(0, HIGHLIGHT_CAPS.raceCode);
}

export function formatReadableDate(dateStr: string): string {
  const parts = (dateStr || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return dateStr;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

export function formatHighlightShareSummary(item: RunnerHighlight): string {
  const names = item.mode === 'duo' && item.partnerName
    ? `${item.runnerName} & ${item.partnerName}`
    : item.runnerName;
  const bibs = item.mode === 'duo' && item.partnerBibNumber
    ? `Bibs #${item.bibNumber} / #${item.partnerBibNumber}`
    : `Bib #${item.bibNumber}`;
  return `${names} (${bibs}) finished ${item.distance} at ${item.raceName} in ${item.chipTime} (${item.pace}) [${item.placement}]. Happy running ka Racepulse!`;
}

// ========== DATABASE RUNNER DIRECTORY & TELEMETRY AUTO-FILL ==========

export interface RunnerRaceEntry {
  raceId: string;
  raceName: string;
  raceDate: string;
  raceCode: string;
  bibNumber: string;
  distance: string;
  distanceKm: number;
  placement: string;
  chipTime: string;
  gunTime: string;
  pace: string;
  splitPace: string;
  entryCategory?: 'solo' | 'duo' | 'trio' | 'group';
  teamName?: string;
  partnerName?: string;
  partnerBibNumber?: string;
  partnerSplitTime?: string;
  combinedAvgPace?: string;
  uid?: string;
  photoUrl?: string;
}

export interface DirectoryRunner {
  key: string;
  fullName: string;
  uid?: string;
  photoUrl?: string;
  entries: RunnerRaceEntry[];
}

export interface HighlightRunnerSources {
  runners: RunnerProfile[];
  liveResultsByRace: Record<string, PublicLiveResults>;
  chipReads: ChipRead[];
  userPhotosByUid: Record<string, string>;
}

/**
 * Normalizes a runner name for grouping registrations across multiple events
 * (including online accounts and walk-in / CSV imports).
 */
export function normalizeRunnerKey(fullName: string | undefined): string {
  return (fullName || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Formats RacePulse precise timing strings (e.g. "01:24:1834210" or "00:41:10.25")
 * into compact card-friendly "HH:MM:SS" strings.
 */
export function formatHighlightDuration(rawTime: string | undefined): string {
  const trimmed = (rawTime || '').trim();
  if (!trimmed) return '';
  if (/^[-:\s]+$/.test(trimmed)) return '';
  const upper = trimmed.toUpperCase();
  if (upper === 'DNF' || upper === 'DQ' || upper === 'DNS' || upper.includes('NO FINISH')) return '';

  const hmsMatch = /^(\d{1,3}):([0-5]\d):([0-5]\d)(?:\.\d+|\d{5})?$/.exec(trimmed);
  if (hmsMatch) {
    return `${hmsMatch[1].padStart(2, '0')}:${hmsMatch[2]}:${hmsMatch[3]}`;
  }
  const msMatch = /^(\d{1,2}):([0-5]\d)$/.exec(trimmed);
  if (msMatch) {
    return `00:${msMatch[1].padStart(2, '0')}:${msMatch[2]}`;
  }
  return /^[\d:]+$/.test(trimmed) ? capText(trimmed, HIGHLIGHT_CAPS.chipTime) : '';
}

export function parseDurationToSeconds(hms: string | undefined): number {
  const cleaned = formatHighlightDuration(hms);
  if (!cleaned) return 0;
  const parts = cleaned.split(':').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function formatHighlightClockTime(value: string | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  const clockMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
  if (clockMatch) {
    const h = Number(clockMatch[1]);
    const m = Number(clockMatch[2]);
    const s = Number(clockMatch[3] || '0');
    if (h >= 0 && h < 24 && m >= 0 && m < 60 && s >= 0 && s < 60) {
      return capText(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
        HIGHLIGHT_CAPS.gunTime,
      );
    }
    return '';
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return capText(
      `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}:${String(parsed.getSeconds()).padStart(2, '0')}`,
      HIGHLIGHT_CAPS.gunTime,
    );
  }
  return '';
}

export function computeElapsedHmsFromClockPair(
  gunStartClock: string | undefined,
  finishClock: string | undefined,
): string {
  const start = formatHighlightClockTime(gunStartClock);
  const end = formatHighlightClockTime(finishClock);
  if (!start || !end) return '';
  const startParts = start.split(':').map(Number);
  const endParts = end.split(':').map(Number);
  if (startParts.length !== 3 || endParts.length !== 3) return '';
  const startSecs = startParts[0] * 3600 + startParts[1] * 60 + startParts[2];
  const endSecs = endParts[0] * 3600 + endParts[1] * 60 + endParts[2];
  let diff = endSecs - startSecs;
  if (diff < 0) diff += 86400;
  if (diff <= 0) return '';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return capText(
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
    HIGHLIGHT_CAPS.chipTime,
  );
}

export function parseDistanceKm(distanceLabel: string | undefined, race?: Pick<Race, 'distances'>): number {
  const label = (distanceLabel || '').trim();
  if (label && race?.distances?.length) {
    const exact = race.distances.find((d) => d.label.trim().toLowerCase() === label.toLowerCase());
    if (exact && Number.isFinite(exact.km) && exact.km > 0) return exact.km;
  }
  const match = label.match(/^(\d+(?:\.\d+)?)\s*(km|k|m)?/i);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (match[2]?.toLowerCase() === 'm' && value >= 100) {
    return value / 1000;
  }
  return value;
}

export function computeHighlightPace(durationStr: string | undefined, distanceKm: number): string {
  const secs = parseDurationToSeconds(durationStr);
  if (secs <= 0 || !Number.isFinite(distanceKm) || distanceKm <= 0) return '';
  const secPerKm = secs / distanceKm;
  let mins = Math.floor(secPerKm / 60);
  let remSecs = Math.round(secPerKm % 60);
  if (remSecs === 60) {
    mins += 1;
    remSecs = 0;
  }
  return capText(`${mins}:${String(remSecs).padStart(2, '0')} /km`, HIGHLIGHT_CAPS.pace);
}

export function deriveHighlightPlacement(overallRank?: number, rank?: number, disqualified?: boolean): string {
  if (disqualified) return 'Finisher';
  const r = overallRank ?? rank;
  if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) return 'Finisher';
  if (r === 1) return '1st';
  if (r === 2) return '2nd';
  if (r === 3) return '3rd';
  if (r <= 10) return 'Top 10';
  return 'Finisher';
}

function isRealAccountUid(uid: string | undefined): boolean {
  if (!uid) return false;
  return !uid.startsWith('import_') && !uid.startsWith('walkin_') && !uid.startsWith('slot_');
}

function findResultForBib(
  raceId: string,
  bibNumber: string,
  liveResultsByRace: Record<string, PublicLiveResults>,
  computedResultsByRace?: Record<string, RunnerResult[]>,
): PublicLeaderboardEntry | RunnerResult | undefined {
  const normBib = (bibNumber || '').trim().toUpperCase();
  if (!normBib) return undefined;
  const live = liveResultsByRace[raceId];
  if (live) {
    const fromOfficial = (live.officialResults || []).find((e) => e.bibNumber.trim().toUpperCase() === normBib);
    if (fromOfficial) return fromOfficial;
    const fromLeaders = (live.leaders || []).find((e) => e.bibNumber.trim().toUpperCase() === normBib);
    if (fromLeaders) return fromLeaders;
  }
  const computed = computedResultsByRace?.[raceId];
  if (computed) {
    return computed.find((r) => r.bibNumber.trim().toUpperCase() === normBib);
  }
  return undefined;
}

function buildEntryRecord(params: {
  raceId: string;
  bibNumber: string;
  fullName: string;
  distance: string;
  entryCategory?: 'solo' | 'duo' | 'trio' | 'group';
  teamName?: string;
  partnerName?: string;
  partnerBibNumber?: string;
  partnerResult?: PublicLeaderboardEntry | RunnerResult;
  result?: PublicLeaderboardEntry | RunnerResult;
  race?: Race;
  live?: PublicLiveResults;
  uid?: string;
  photoUrl?: string;
}): RunnerRaceEntry {
  const { raceId, bibNumber, distance, entryCategory, teamName, partnerName, partnerBibNumber, partnerResult, result, race, live, uid, photoUrl } = params;
  const raceName = (race?.name || live?.raceName || 'RacePulsePH Event').slice(0, HIGHLIGHT_CAPS.raceName);
  const raceDate = (race?.date || live?.updatedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10)).slice(0, HIGHLIGHT_CAPS.raceDate);
  const raceCode = deriveRaceCode(raceName, raceDate);

  const resultDistance = result
    ? 'distance' in result
      ? result.distance
      : result.runnerProfile?.distance
    : undefined;
  const resolvedDistance = capText(distance || resultDistance || race?.distances?.[0]?.label || '10K', HIGHLIGHT_CAPS.distance);
  const distanceKm = parseDistanceKm(resolvedDistance, race);

  const startCheckpointId = race?.checkpoints?.find((cp) => cp.type === 'start')?.id;
  const finishCheckpointId = race?.checkpoints?.find((cp) => cp.type === 'finish')?.id;
  const resultSplits = result && 'splits' in result && Array.isArray(result.splits) ? result.splits : undefined;
  const startSplitIso = startCheckpointId && resultSplits
    ? resultSplits.find((s) => s.checkpointId === startCheckpointId)?.timestamp
    : undefined;
  const finishSplitIso = finishCheckpointId && resultSplits
    ? resultSplits.find((s) => s.checkpointId === finishCheckpointId)?.timestamp
    : undefined;

  const waveStartIso = race
    ? getWaveStartTime(race, resolvedDistance, entryCategory || (teamName ? 'group' : undefined))
    : undefined;
  const gunStartIso = waveStartIso || startSplitIso;
  const rawFinishReadAt = result && 'finishReadAt' in result ? result.finishReadAt : undefined;
  const finishReadIso = rawFinishReadAt || finishSplitIso;

  const gunStartClock = formatHighlightClockTime(gunStartIso);
  let finishClock = formatHighlightClockTime(finishReadIso);
  const rawDuration = formatHighlightDuration(result?.gunTime || result?.finishTime || result?.chipTime);

  if (!finishClock && gunStartIso && rawDuration) {
    const startMs = new Date(gunStartIso).getTime();
    const elapsedSecs = parseDurationToSeconds(rawDuration);
    if (Number.isFinite(startMs) && elapsedSecs > 0) {
      finishClock = formatHighlightClockTime(new Date(startMs + elapsedSecs * 1000).toISOString());
    }
  }
  if (!finishClock && gunStartClock && rawDuration) {
    const startParts = gunStartClock.split(':').map(Number);
    const startSecs = startParts[0] * 3600 + startParts[1] * 60 + startParts[2];
    const elapsedSecs = parseDurationToSeconds(rawDuration);
    if (elapsedSecs > 0) {
      const total = (startSecs + elapsedSecs) % 86400;
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      finishClock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
  }

  const elapsedFromClock = gunStartClock && finishClock
    ? computeElapsedHmsFromClockPair(gunStartClock, finishClock)
    : '';
  const chipTime = formatHighlightDuration(result?.gunTime || result?.finishTime) || elapsedFromClock || formatHighlightDuration(result?.chipTime);
  const gunTime = gunStartClock || (chipTime ? '00:00:00' : '');
  const splitPace = finishClock || chipTime;
  const pace = computeHighlightPace(elapsedFromClock || chipTime, distanceKm);
  const placement = deriveHighlightPlacement(result?.overallRank, result?.rank, result?.disqualified);

  const partnerSplitTime = formatHighlightDuration(partnerResult?.gunTime || partnerResult?.finishTime || partnerResult?.chipTime);
  let combinedAvgPace: string | undefined;
  const s1 = parseDurationToSeconds(chipTime);
  const s2 = parseDurationToSeconds(partnerSplitTime);
  if (s1 > 0 && s2 > 0 && distanceKm > 0) {
    const avgSecPerKm = ((s1 + s2) / 2) / distanceKm;
    let mins = Math.floor(avgSecPerKm / 60);
    let remSecs = Math.round(avgSecPerKm % 60);
    if (remSecs === 60) {
      mins += 1;
      remSecs = 0;
    }
    combinedAvgPace = capText(`${mins}:${String(remSecs).padStart(2, '0')} /km`, HIGHLIGHT_CAPS.pace);
  }

  return {
    raceId,
    raceName,
    raceDate,
    raceCode,
    bibNumber: capText(bibNumber, HIGHLIGHT_CAPS.bibNumber),
    distance: resolvedDistance,
    distanceKm,
    placement,
    chipTime,
    gunTime,
    pace,
    splitPace,
    entryCategory,
    teamName,
    partnerName,
    partnerBibNumber,
    partnerSplitTime: partnerSplitTime || undefined,
    combinedAvgPace,
    uid,
    photoUrl,
  };
}

/**
 * Builds an indexed, alphabetically sorted runner directory grouped by runner name,
 * containing every race they participated in (each with its own bib, distance,
 * placement, chip/gun timing, and pace).
 */
export function buildRunnerDirectory(params: {
  runners: RunnerProfile[];
  races: Race[];
  liveResultsByRace: Record<string, PublicLiveResults>;
  computedResultsByRace?: Record<string, RunnerResult[]>;
  userPhotosByUid?: Record<string, string>;
}): DirectoryRunner[] {
  const { runners, races, liveResultsByRace, computedResultsByRace, userPhotosByUid } = params;
  const raceMap = new Map<string, Race>();
  for (const r of races) raceMap.set(r.id, r);

  const runnersByRace = new Map<string, RunnerProfile[]>();
  for (const reg of runners) {
    if (reg.isFreeSlot || !reg.fullName?.trim()) continue;
    const list = runnersByRace.get(reg.raceId) || [];
    list.push(reg);
    runnersByRace.set(reg.raceId, list);
  }

  const directory = new Map<string, DirectoryRunner>();
  const seenKeysPerRunner = new Map<string, Set<string>>();

  const addEntryToDirectory = (fullName: string, entry: RunnerRaceEntry) => {
    const key = normalizeRunnerKey(fullName);
    if (!key) return;
    let existing = directory.get(key);
    if (!existing) {
      existing = {
        key,
        fullName: fullName.trim().replace(/\s+/g, ' '),
        uid: isRealAccountUid(entry.uid) ? entry.uid : undefined,
        photoUrl: entry.photoUrl,
        entries: [],
      };
      directory.set(key, existing);
      seenKeysPerRunner.set(key, new Set<string>());
    } else {
      if (!existing.uid && isRealAccountUid(entry.uid)) {
        existing.uid = entry.uid;
      }
      if (!existing.photoUrl && entry.photoUrl) {
        existing.photoUrl = entry.photoUrl;
      }
    }

    const dedup = seenKeysPerRunner.get(key)!;
    const entryDedupKey = `${entry.raceId}::${entry.bibNumber.toUpperCase()}`;
    if (!dedup.has(entryDedupKey)) {
      dedup.add(entryDedupKey);
      existing.entries.push(entry);
    }
  };

  for (const reg of runners) {
    if (reg.isFreeSlot || !reg.fullName?.trim()) continue;
    const race = raceMap.get(reg.raceId);
    const live = liveResultsByRace[reg.raceId];
    const result = findResultForBib(reg.raceId, reg.bibNumber, liveResultsByRace, computedResultsByRace);

    // Detect Duo partner in the same race via startsAfterBib, matching teamName, or shared teamMembers
    let partnerName: string | undefined;
    let partnerBibNumber: string | undefined;
    let partnerResult: PublicLeaderboardEntry | RunnerResult | undefined;

    if (reg.entryCategory === 'duo') {
      const peers = runnersByRace.get(reg.raceId) || [];
      const linkedPartner = peers.find(
        (other) =>
          other !== reg &&
          other.bibNumber !== reg.bibNumber &&
          ((reg.startsAfterBib && other.bibNumber === reg.startsAfterBib) ||
            (other.startsAfterBib && other.startsAfterBib === reg.bibNumber) ||
            (reg.teamName && other.teamName && reg.teamName === other.teamName && other.entryCategory === 'duo')),
      );
      if (linkedPartner) {
        partnerName = linkedPartner.fullName;
        partnerBibNumber = linkedPartner.bibNumber;
        partnerResult = findResultForBib(reg.raceId, linkedPartner.bibNumber, liveResultsByRace, computedResultsByRace);
      } else if (reg.teamMembers && reg.teamMembers.length >= 2) {
        const regNorm = normalizeRunnerKey(reg.fullName);
        const otherMember = reg.teamMembers.find((m) => normalizeRunnerKey(m) !== regNorm);
        if (otherMember) {
          partnerName = otherMember;
          partnerBibNumber = reg.bibNumber;
        }
      }
    }

    const photoUrl = reg.uid && userPhotosByUid ? userPhotosByUid[reg.uid] : undefined;
    const entry = buildEntryRecord({
      raceId: reg.raceId,
      bibNumber: reg.bibNumber,
      fullName: reg.fullName,
      distance: reg.distance,
      entryCategory: reg.entryCategory,
      teamName: reg.teamName,
      partnerName,
      partnerBibNumber,
      partnerResult,
      result,
      race,
      live,
      uid: reg.uid,
      photoUrl,
    });
    addEntryToDirectory(reg.fullName, entry);
  }

  // Fallback enrichment from published liveResults (covers cases where roster.view isn't granted)
  for (const [raceId, live] of Object.entries(liveResultsByRace)) {
    const race = raceMap.get(raceId);
    const combined = [...(live.officialResults || []), ...(live.leaders || [])];
    for (const leaderEntry of combined) {
      if (leaderEntry.isFreeSlot || !leaderEntry.fullName?.trim()) continue;
      const entry = buildEntryRecord({
        raceId,
        bibNumber: leaderEntry.bibNumber,
        fullName: leaderEntry.fullName,
        distance: leaderEntry.distance,
        result: leaderEntry,
        race,
        live,
      });
      addEntryToDirectory(leaderEntry.fullName, entry);
    }
  }

  const list = Array.from(directory.values());
  for (const runner of list) {
    runner.entries.sort((a, b) => (b.raceDate || '').localeCompare(a.raceDate || '') || a.raceName.localeCompare(b.raceName));
  }
  list.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return list;
}

// ========== FIRESTORE SUBSCRIPTIONS & CRUD ==========

export function subscribeRunnerHighlights(
  listener: (items: RunnerHighlight[], loaded: boolean, error: string | null) => void,
): () => void {
  return onSnapshot(
    collection(db, 'runnerHighlights'),
    (snapshot) => {
      const list: RunnerHighlight[] = [];
      snapshot.forEach((snap) => {
        list.push({ ...(snap.data() as RunnerHighlight), id: snap.id });
      });
      listener(list, true, null);
    },
    (err) => {
      listener([], false, err.message || 'Could not load runner highlights.');
    },
  );
}

export function subscribeHighlightsConfig(
  listener: (config: HighlightsMarqueeConfig, loaded: boolean) => void,
): () => void {
  return onSnapshot(
    doc(db, 'system', 'highlightsConfig'),
    (snap) => {
      if (!snap.exists()) {
        listener(DEFAULT_MARQUEE_CONFIG, true);
        return;
      }
      listener(normalizeHighlightConfig(snap.data() as Partial<HighlightsMarqueeConfig>), true);
    },
    () => {
      listener(DEFAULT_MARQUEE_CONFIG, true);
    },
  );
}

export function subscribeHighlightRunnerSources(
  options: {
    canViewRoster: boolean;
    canViewTiming: boolean;
    canViewUsers: boolean;
    allRacesScope: boolean;
    scopedRaceIds: string[];
  },
  listener: (sources: HighlightRunnerSources) => void,
): () => void {
  let currentRunners: RunnerProfile[] = [];
  let currentLive: Record<string, PublicLiveResults> = {};
  let currentReads: ChipRead[] = [];
  let currentPhotos: Record<string, string> = {};

  const emit = () => {
    listener({
      runners: currentRunners,
      liveResultsByRace: currentLive,
      chipReads: currentReads,
      userPhotosByUid: currentPhotos,
    });
  };

  const unsubs: Array<() => void> = [];

  // Public liveResults is readable by everyone and supplies official ranks & times
  unsubs.push(
    onSnapshot(
      collection(db, 'liveResults'),
      (snap) => {
        const next: Record<string, PublicLiveResults> = {};
        snap.forEach((docSnap) => {
          const data = docSnap.data() as PublicLiveResults;
          next[data.raceId || docSnap.id] = { ...data, raceId: data.raceId || docSnap.id };
        });
        currentLive = next;
        emit();
      },
      () => {
        // Keep previously emitted liveResults on transient error
      },
    ),
  );

  // Registered runners roster (all races or race-scoped batches)
  if (options.canViewRoster) {
    if (options.allRacesScope) {
      unsubs.push(
        onSnapshot(
          collection(db, 'runners'),
          (snap) => {
            const list: RunnerProfile[] = [];
            snap.forEach((docSnap) => {
              list.push(docSnap.data() as RunnerProfile);
            });
            currentRunners = list;
            emit();
          },
          () => {
            // Permission or offline fallback: liveResults remains active
          },
        ),
      );
    } else if (options.scopedRaceIds.length > 0) {
      const runnerChunks = new Map<number, RunnerProfile[]>();
      const rebuildRunners = () => {
        currentRunners = Array.from(runnerChunks.values()).flat();
        emit();
      };
      for (let i = 0; i < options.scopedRaceIds.length; i += 10) {
        const batchIdx = i;
        const batchIds = options.scopedRaceIds.slice(i, i + 10);
        unsubs.push(
          onSnapshot(
            query(collection(db, 'runners'), where('raceId', 'in', batchIds)),
            (snap) => {
              const list: RunnerProfile[] = [];
              snap.forEach((docSnap) => list.push(docSnap.data() as RunnerProfile));
              runnerChunks.set(batchIdx, list);
              rebuildRunners();
            },
            () => {
              // Ignore batch permission errors
            },
          ),
        );
      }
    }
  }

  // Raw timing chipReads (used to compute times when liveResults hasn't published yet)
  if (options.canViewTiming) {
    if (options.allRacesScope) {
      unsubs.push(
        onSnapshot(
          collection(db, 'chipReads'),
          (snap) => {
            const list: ChipRead[] = [];
            snap.forEach((docSnap) => {
              list.push({ ...(docSnap.data() as ChipRead), id: docSnap.id });
            });
            currentReads = list;
            emit();
          },
          () => {
            // Keep existing chipReads on error
          },
        ),
      );
    } else if (options.scopedRaceIds.length > 0) {
      const readChunks = new Map<number, ChipRead[]>();
      const rebuildReads = () => {
        currentReads = Array.from(readChunks.values()).flat();
        emit();
      };
      for (let i = 0; i < options.scopedRaceIds.length; i += 10) {
        const batchIdx = i;
        const batchIds = options.scopedRaceIds.slice(i, i + 10);
        unsubs.push(
          onSnapshot(
            query(collection(db, 'chipReads'), where('raceId', 'in', batchIds)),
            (snap) => {
              const list: ChipRead[] = [];
              snap.forEach((docSnap) => list.push({ ...(docSnap.data() as ChipRead), id: docSnap.id }));
              readChunks.set(batchIdx, list);
              rebuildReads();
            },
            () => {
              // Ignore batch permission errors
            },
          ),
        );
      }
    }
  }

  // Optional runner avatar lookup when users.view permission is granted
  if (options.canViewUsers) {
    unsubs.push(
      onSnapshot(
        collection(db, 'users'),
        (snap) => {
          const map: Record<string, string> = {};
          snap.forEach((docSnap) => {
            const data = docSnap.data() as UserProfile;
            if (data.photoURL) {
              map[data.uid || docSnap.id] = data.photoURL;
            }
          });
          currentPhotos = map;
          emit();
        },
        () => {
          // Optional enrichment only
        },
      ),
    );
  }

  return () => {
    for (const unsub of unsubs) unsub();
  };
}

export async function saveRunnerHighlight(item: RunnerHighlight): Promise<RunnerHighlight> {
  const payload = sanitizeHighlightPayload(item);
  await setDoc(doc(db, 'runnerHighlights', payload.id), payload);
  return payload;
}

export async function deleteRunnerHighlight(highlightId: string): Promise<void> {
  await deleteDoc(doc(db, 'runnerHighlights', highlightId));
}

export async function saveHighlightsMarqueeConfig(
  config: HighlightsMarqueeConfig,
  options: { actorUid: string; includePlaylistRules: boolean },
): Promise<void> {
  const normalized = normalizeHighlightConfig(config);
  const now = new Date().toISOString();
  const basePayload: Record<string, unknown> = {
    speedPxPerSec: normalized.speedPxPerSec,
    hoverBehavior: normalized.hoverBehavior,
    direction: normalized.direction,
    layoutMode: normalized.layoutMode,
    cardGapPx: normalized.cardGapPx,
    edgeFadePx: normalized.edgeFadePx,
    updatedAt: now,
    updatedBy: options.actorUid,
  };

  if (options.includePlaylistRules) {
    basePayload.pinPodiumFirst = normalized.pinPodiumFirst;
    basePayload.filterRaceId = normalized.filterRaceId;
    basePayload.hideExpired = normalized.hideExpired;
  }

  await setDoc(doc(db, 'system', 'highlightsConfig'), basePayload, { merge: true });
}

// ========== IMAGE SMART CROP & UPLOAD HELPERS ==========

export interface SmartCropSpec {
  sourceUrl: string;
  zoom: number;
  offsetX: number; // -1 to 1 normalized pan offset
  offsetY: number; // -1 to 1 normalized pan offset
  targetWidth: number;
  targetHeight: number;
  quality?: number;
}

export function loadImageElement(src: string, crossOrigin?: 'anonymous'): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin && !src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = crossOrigin;
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to load image.'));
    img.src = src;
  });
}

export async function bakeSmartCropToDataUrl(spec: SmartCropSpec): Promise<string> {
  const img = await loadImageElement(spec.sourceUrl);
  const { targetWidth, targetHeight } = spec;
  const zoom = clampNumber(spec.zoom, 1, 3.5);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');

  // Cover scale at zoom = 1
  const baseScale = Math.max(targetWidth / img.width, targetHeight / img.height);
  const drawScale = baseScale * zoom;
  const drawnW = img.width * drawScale;
  const drawnH = img.height * drawScale;
  const maxPanX = Math.max(0, (drawnW - targetWidth) / 2);
  const maxPanY = Math.max(0, (drawnH - targetHeight) / 2);
  const dx = (targetWidth - drawnW) / 2 + clampNumber(spec.offsetX, -1, 1) * maxPanX;
  const dy = (targetHeight - drawnH) / 2 + clampNumber(spec.offsetY, -1, 1) * maxPanY;

  ctx.fillStyle = '#0c0c0e';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(img, dx, dy, drawnW, drawnH);

  // Compress gracefully below ~260KB so Firestore fallback also stays nimble
  let q = spec.quality ?? 0.84;
  let dataUrl = canvas.toDataURL('image/jpeg', q);
  while (dataUrl.length > 290_000 && q > 0.48) {
    q -= 0.08;
    dataUrl = canvas.toDataURL('image/jpeg', q);
  }
  return dataUrl;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header?.match(/data:([^;]+);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export async function uploadHighlightAsset(
  ownerUid: string,
  highlightId: string,
  slot: 'primary' | 'partner',
  croppedDataUrl: string,
): Promise<string> {
  if (!ownerUid) return croppedDataUrl;
  try {
    const blob = dataUrlToBlob(croppedDataUrl);
    const assetRef = ref(storage, `highlight-assets/${ownerUid}/${highlightId}/${slot}-${Date.now()}.jpg`);
    await Promise.race([
      uploadBytes(assetRef, blob, { contentType: 'image/jpeg' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Storage upload timed out')), 7000)),
    ]);
    return await getDownloadURL(assetRef);
  } catch (err) {
    // Resilient fallback: the pre-cropped JPEG is already sized under 290KB so
    // Firestore stores it directly when Storage rules/network aren't available.
    console.warn('Highlight Storage upload fell back to inline JPEG:', err);
    return croppedDataUrl;
  }
}

// ========== COLLECTIBLE SOCIAL CARD PNG EXPORTER ==========

export async function exportHighlightSocialCardPng(item: RunnerHighlight): Promise<void> {
  const W = 780;
  const H = 1020;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');

  const accent = sanitizeHexColor(item.accentColor, '#ff3b30');

  // Outer card background
  ctx.fillStyle = '#0c0c0f';
  ctx.fillRect(0, 0, W, H);

  // Outer accent border
  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(18, 18, W - 36, H - 36);

  // Inner photo frame
  const pad = 34;
  const frameW = W - pad * 2;
  const frameH = H - pad * 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, pad, frameW, frameH);
  ctx.clip();

  const tryDrawCover = async (src: string, clipX: number, clipW: number) => {
    try {
      const img = await loadImageElement(src, 'anonymous');
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipX, pad, clipW, frameH);
      ctx.clip();
      const scale = Math.max(clipW / img.width, frameH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, clipX + (clipW - dw) / 2, pad + (frameH - dh) / 2, dw, dh);
      ctx.restore();
    } catch {
      ctx.fillStyle = '#18181d';
      ctx.fillRect(clipX, pad, clipW, frameH);
    }
  };

  if (item.mode === 'duo' && item.partnerPhotoUrl) {
    await Promise.all([
      tryDrawCover(item.photoUrl, pad, frameW / 2),
      tryDrawCover(item.partnerPhotoUrl, pad + frameW / 2, frameW / 2),
    ]);
    // Diagonal slash line
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(pad + frameW / 2 + 45, pad);
    ctx.lineTo(pad + frameW / 2 - 45, pad + frameH);
    ctx.stroke();
  } else if (item.photoUrl) {
    await tryDrawCover(item.photoUrl, pad, frameW);
  }

  // Bottom 52% dark scrim for contrast guard
  const scrim = ctx.createLinearGradient(0, pad + frameH * 0.42, 0, pad + frameH);
  scrim.addColorStop(0, 'rgba(8, 8, 11, 0)');
  scrim.addColorStop(0.45, 'rgba(8, 8, 11, 0.72)');
  scrim.addColorStop(1, 'rgba(8, 8, 11, 0.96)');
  ctx.fillStyle = scrim;
  ctx.fillRect(pad, pad, frameW, frameH);

  // Top scrim
  const topScrim = ctx.createLinearGradient(0, pad, 0, pad + 180);
  topScrim.addColorStop(0, 'rgba(8, 8, 11, 0.85)');
  topScrim.addColorStop(1, 'rgba(8, 8, 11, 0)');
  ctx.fillStyle = topScrim;
  ctx.fillRect(pad, pad, frameW, 180);

  // Header brand + placement
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 24px "Space Grotesk", Inter, sans-serif';
  ctx.fillText('RACEPULSEPH', pad + 28, pad + 56);

  ctx.fillStyle = accent;
  ctx.fillRect(pad + 28, pad + 72, 92, 5);

  // Placement badge
  const placementText = item.placement.toUpperCase();
  ctx.font = '700 22px "JetBrains Mono", monospace';
  const badgeW = Math.max(120, ctx.measureText(placementText).width + 36);
  ctx.fillStyle = accent;
  ctx.fillRect(pad + frameW - badgeW - 28, pad + 30, badgeW, 44);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(placementText, pad + frameW - badgeW / 2 - 28, pad + 60);
  ctx.textAlign = 'left';

  if (item.badgeStamp) {
    ctx.font = '700 18px "JetBrains Mono", monospace';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(item.badgeStamp.toUpperCase(), pad + 28, pad + 106);
  }

  // Bottom typography block
  const bottomY = pad + frameH - 36;
  ctx.fillStyle = '#d4d4d8';
  ctx.font = '600 22px "JetBrains Mono", monospace';
  ctx.fillText(`${item.raceName.toUpperCase()}  |  ${formatReadableDate(item.raceDate)}`, pad + 28, bottomY - 196);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 44px "Space Grotesk", Inter, sans-serif';
  const displayName = item.mode === 'duo' && item.partnerName
    ? `${item.runnerName} & ${item.partnerName}`
    : item.runnerName;
  ctx.fillText(displayName.slice(0, 34), pad + 28, bottomY - 136);

  // Metrics strip
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.strokeRect(pad + 28, bottomY - 104, frameW - 56, 86);

  const cols = [
    { label: 'DISTANCE', value: item.distance },
    { label: 'FINISH TIME', value: item.chipTime },
    { label: 'AVG PACE', value: item.mode === 'duo' && item.combinedAvgPace ? item.combinedAvgPace : item.pace },
    { label: 'BIB', value: item.mode === 'duo' && item.partnerBibNumber ? `#${item.bibNumber}/#${item.partnerBibNumber}` : `#${item.bibNumber}` },
  ];
  const colW = (frameW - 56) / cols.length;
  cols.forEach((col, i) => {
    const cx = pad + 42 + i * colW;
    ctx.fillStyle = '#a1a1aa';
    ctx.font = '600 16px "JetBrains Mono", monospace';
    ctx.fillText(col.label, cx, bottomY - 72);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 24px "JetBrains Mono", monospace';
    ctx.fillText(col.value.slice(0, 14), cx, bottomY - 36);
  });

  ctx.restore();

  const pngUrl = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  const slug = item.runnerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'runner';
  link.download = `RacePulsePH-${slug}-${item.bibNumber}.png`;
  link.href = pngUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
