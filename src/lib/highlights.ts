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
import { sanitizePhotoReference } from './security';
import {
  ChipRead,
  HighlightBorderPreset,
  HighlightCardEffect,
  HighlightCardLayoutMode,
  HighlightCornerGeometry,
  HighlightFlowDirection,
  HighlightGroupMember,
  HighlightGroupPhotoLayout,
  HighlightHeaderStyle,
  HighlightHoverBehavior,
  HighlightParticipatedEvent,
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
  defaultSecondaryAccent: string;
}> = [
  {
    id: 'liquid-gold',
    label: 'Liquid Gold',
    summary: 'Dual molten gold metallic frame with warm championship aura.',
    defaultAccent: '#f5b731',
    defaultSecondaryAccent: '#ff3b30',
  },
  {
    id: 'cyber-hud',
    label: 'Cyber HUD',
    summary: '45 deg targeting brackets with live race-code edge ticker.',
    defaultAccent: '#22d3ee',
    defaultSecondaryAccent: '#0ea5e9',
  },
  {
    id: 'sonic-wave',
    label: 'Sonic Wave',
    summary: 'Pace-synced perimeter neon pulse calibrated to split rhythm.',
    defaultAccent: '#ff3b30',
    defaultSecondaryAccent: '#fb7185',
  },
  {
    id: 'holo-foil',
    label: 'Holo Foil',
    summary: 'Iridescent spectrum bezel blending violet, cyan, and gold.',
    defaultAccent: '#a855f7',
    defaultSecondaryAccent: '#22d3ee',
  },
  {
    id: 'carbon-minimal',
    label: 'Carbon Minimal',
    summary: 'Woven carbon matte frame with top and bottom laser rules.',
    defaultAccent: '#ff3b30',
    defaultSecondaryAccent: '#f43f5e',
  },
  {
    id: 'neon-circuit',
    label: 'Neon Circuit',
    summary: 'Arcade laser perimeter traces with luminous corner nodes.',
    defaultAccent: '#38bdf8',
    defaultSecondaryAccent: '#f472b6',
  },
  {
    id: 'obsidian-chrome',
    label: 'Obsidian Chrome',
    summary: 'Brushed dark chrome steel bezel with specular silver trim.',
    defaultAccent: '#e4e4e7',
    defaultSecondaryAccent: '#71717a',
  },
  {
    id: 'crimson-inferno',
    label: 'Crimson Inferno',
    summary: 'High-heat crimson and ember forge double gradient border.',
    defaultAccent: '#ef4444',
    defaultSecondaryAccent: '#f97316',
  },
  {
    id: 'aurora-borealis',
    label: 'Aurora Borealis',
    summary: 'Northern lights emerald-to-indigo shimmering collector rim.',
    defaultAccent: '#34d399',
    defaultSecondaryAccent: '#818cf8',
  },
  {
    id: 'vintage-prestige',
    label: 'Vintage Prestige',
    summary: 'Heritage double brass hairline inlay with marathon crest trim.',
    defaultAccent: '#eab308',
    defaultSecondaryAccent: '#b45309',
  },
  {
    id: 'titanium-blade',
    label: 'Titanium Blade',
    summary: 'Razor-edged brushed titanium bezel with cool cyan core.',
    defaultAccent: '#94a3b8',
    defaultSecondaryAccent: '#22d3ee',
  },
  {
    id: 'emerald-matrix',
    label: 'Emerald Matrix',
    summary: 'Precision timing console terminal border with lime edge glow.',
    defaultAccent: '#10b981',
    defaultSecondaryAccent: '#a3e635',
  },
];

export const HIGHLIGHT_CORNER_GEOMETRIES: ReadonlyArray<{
  id: HighlightCornerGeometry;
  label: string;
  detail: string;
}> = [
  { id: 'rounded', label: 'Rounded', detail: '16px broadcast collector radius' },
  { id: 'sharp', label: 'Sharp', detail: '0px crisp editorial slab edges' },
  { id: 'tactical', label: 'Tactical Cut', detail: '45 deg chamfered telemetry corners' },
  { id: 'hex-crest', label: 'Hex Crest', detail: 'Beveled crown + stepped base cut' },
  { id: 'ticket-notch', label: 'Ticket Notch', detail: 'Race pass inward corner cutouts' },
];

export const HIGHLIGHT_SURFACE_FINISHES: ReadonlyArray<{
  id: HighlightSurfaceFinish;
  label: string;
}> = [
  { id: 'matte', label: 'Matte' },
  { id: 'glossy', label: 'Glossy Sweep' },
  { id: 'topo', label: 'Topo Map' },
  { id: 'carbon-weave', label: 'Carbon Weave' },
  { id: 'halftone', label: 'Halftone' },
];

export const HIGHLIGHT_CARD_EFFECTS: ReadonlyArray<{
  id: HighlightCardEffect;
  label: string;
  detail: string;
}> = [
  { id: 'sheen-sweep', label: 'Holo Sheen', detail: 'Diagonal specular glaze pass' },
  { id: 'prism-glint', label: 'Prism Glint', detail: 'Iridescent refraction band' },
  { id: 'ember-rise', label: 'Rising Sparks', detail: 'Podium spark particles on GPU' },
  { id: 'radar-scan', label: 'Radar Scan', detail: 'Laser telemetry sweep line' },
  { id: 'pulse-aura', label: 'Pace Pulse', detail: 'Pace-synced inner perimeter glow' },
  { id: 'none', label: 'Clean Static', detail: 'No motion overlay on surface' },
];

export const HIGHLIGHT_HEADER_STYLES: ReadonlyArray<{
  id: HighlightHeaderStyle;
  label: string;
  detail: string;
}> = [
  { id: 'crown-bezel', label: 'Crown Bezel', detail: 'Top telemetry rail clears photo' },
  { id: 'floating-notch', label: 'Floating Notch', detail: 'Edge-docked top tabs lift on hover' },
  { id: 'bottom-dock', label: 'Bottom Dock', detail: 'Zero top badges; docks below' },
];

export const HIGHLIGHT_PLACEMENTS: readonly HighlightPlacement[] = [
  '1st',
  '2nd',
  '3rd',
  'Top 10',
  'Finisher',
  'Record Holder',
];

export const HIGHLIGHT_ACHIEVEMENT_PRESETS: readonly string[] = [
  'RACE CHAMPION',
  'PODIUM FINISHER',
  'TOP 10 CONTENDER',
  'COURSE RECORD',
  'MULTI-EVENT ATHLETE',
  'PERSONAL BEST',
];

export const HIGHLIGHT_DISTANCES = ['5K', '10K', '16K', '21K', '32K', '42K', '50K'] as const;

export const HIGHLIGHT_CAPS = {
  runnerName: 36,
  teamName: 36,
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
  const mode = draft.mode === 'duo' ? 'duo' : draft.mode === 'group' ? 'group' : 'solo';

  const cleanedMembers: HighlightGroupMember[] =
    mode === 'group' && Array.isArray(draft.groupMembers)
      ? draft.groupMembers
          .slice(0, 6)
          .map((member): HighlightGroupMember | null => {
            const name = capText(member?.name, HIGHLIGHT_CAPS.runnerName);
            const bibNumber = capText(member?.bibNumber, HIGHLIGHT_CAPS.bibNumber);
            const photoUrl = sanitizePhotoReference(member?.photoUrl || '');
            const uid = (member?.uid || '').trim().slice(0, 128);
            if (!name && !bibNumber && !photoUrl) return null;
            const entry: HighlightGroupMember = { name: name || 'Member' };
            if (bibNumber) entry.bibNumber = bibNumber;
            if (photoUrl) entry.photoUrl = photoUrl;
            if (uid) entry.uid = uid;
            return entry;
          })
          .filter((member): member is HighlightGroupMember => member !== null)
      : [];

  const cleanTeamName = mode === 'group' ? capText(draft.teamName, HIGHLIGHT_CAPS.teamName) : '';
  const fallbackPhotoUrl =
    sanitizePhotoReference(draft.photoUrl || '') ||
    (mode === 'group' ? cleanedMembers.find((m) => m.photoUrl)?.photoUrl || '' : '');
  const resolvedRunnerName =
    capText(draft.runnerName, HIGHLIGHT_CAPS.runnerName) ||
    cleanTeamName ||
    cleanedMembers[0]?.name ||
    'Runner';
  const resolvedBibNumber =
    capText(draft.bibNumber, HIGHLIGHT_CAPS.bibNumber) ||
    cleanedMembers[0]?.bibNumber ||
    '001';

  const base: RunnerHighlight = {
    id: safeId,
    mode,
    runnerName: resolvedRunnerName,
    bibNumber: resolvedBibNumber,
    placement: capText(draft.placement, HIGHLIGHT_CAPS.placement) || 'Finisher',
    distance: capText(draft.distance, HIGHLIGHT_CAPS.distance) || '10K',
    chipTime: capText(draft.chipTime, HIGHLIGHT_CAPS.chipTime) || '00:00:00',
    pace: capText(draft.pace, HIGHLIGHT_CAPS.pace) || '5:00 /km',
    raceName: capText(draft.raceName, HIGHLIGHT_CAPS.raceName) || 'RacePulsePH Event',
    raceDate: capText(draft.raceDate, HIGHLIGHT_CAPS.raceDate) || now.slice(0, 10),
    photoUrl: fallbackPhotoUrl,
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
    const pPhoto = sanitizePhotoReference(draft.partnerPhotoUrl || '');
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

  if (mode === 'group') {
    const layout: HighlightGroupPhotoLayout = draft.groupPhotoLayout === 'single' ? 'single' : 'collage';
    if (cleanTeamName) base.teamName = cleanTeamName;
    base.groupPhotoLayout = layout;
    if (cleanedMembers.length > 0) base.groupMembers = cleanedMembers;
  }

  const gunTime = capText(draft.gunTime, HIGHLIGHT_CAPS.gunTime);
  const splitPace = capText(draft.splitPace, HIGHLIGHT_CAPS.splitPace);
  const runClub = capText(draft.runClub, HIGHLIGHT_CAPS.runClub);
  const raceId = (draft.raceId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const raceCode = capText(draft.raceCode, HIGHLIGHT_CAPS.raceCode).toUpperCase();
  const badgeStamp = capText(draft.badgeStamp, HIGHLIGHT_CAPS.badgeStamp).toUpperCase();
  const expiresAt = capText(draft.expiresAt, 24);
  const createdBy = (draft.createdBy || '').trim().slice(0, 128);
  const secondaryAccentColor = draft.secondaryAccentColor
    ? sanitizeHexColor(draft.secondaryAccentColor, base.accentColor)
    : undefined;

  if (gunTime) base.gunTime = gunTime;
  if (splitPace) base.splitPace = splitPace;
  if (runClub) base.runClub = runClub;
  if (raceId) base.raceId = raceId;
  if (raceCode) base.raceCode = raceCode;
  if (badgeStamp) base.badgeStamp = badgeStamp;
  if (secondaryAccentColor) base.secondaryAccentColor = secondaryAccentColor;
  if (draft.cardEffect) base.cardEffect = draft.cardEffect;
  if (draft.headerStyle) base.headerStyle = draft.headerStyle;
  if (typeof draft.borderWidthPx === 'number') {
    base.borderWidthPx = Math.round(clampNumber(draft.borderWidthPx, 2, 6));
  }
  if (typeof draft.scrimStrength === 'number') {
    base.scrimStrength = Math.round(clampNumber(draft.scrimStrength, 30, 95));
  }
  if (typeof draft.pinned === 'boolean') base.pinned = draft.pinned;
  if (expiresAt) base.expiresAt = expiresAt;
  if (createdBy) base.createdBy = createdBy;

  if (Array.isArray(draft.achievements)) {
    const seenAch = new Set<string>();
    const cleanAchievements: string[] = [];
    for (const rawAch of draft.achievements) {
      if (typeof rawAch !== 'string') continue;
      const clean = capText(rawAch, 28);
      const norm = clean.toLowerCase();
      if (!clean || seenAch.has(norm)) continue;
      seenAch.add(norm);
      cleanAchievements.push(clean);
      if (cleanAchievements.length >= 8) break;
    }
    if (cleanAchievements.length > 0) base.achievements = cleanAchievements;
  }

  if (Array.isArray(draft.participatedEvents)) {
    const cleanEvents: HighlightParticipatedEvent[] = [];
    for (const rawEv of draft.participatedEvents.slice(0, 8)) {
      if (!rawEv || typeof rawEv !== 'object') continue;
      const evRaceName = capText(rawEv.raceName, 56);
      const evRaceDate = capText(rawEv.raceDate, HIGHLIGHT_CAPS.raceDate);
      const evDistance = capText(rawEv.distance, 18);
      if (!evRaceName) continue;
      const evItem: HighlightParticipatedEvent = {
        raceName: evRaceName,
        raceDate: evRaceDate || base.raceDate,
        distance: evDistance || base.distance,
        placement: capText(rawEv.placement, HIGHLIGHT_CAPS.placement) || 'Finisher',
      };
      const evRaceId = (rawEv.raceId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      const evChip = capText(rawEv.chipTime, HIGHLIGHT_CAPS.chipTime);
      const evPace = capText(rawEv.pace, HIGHLIGHT_CAPS.pace);
      const evBib = capText(rawEv.bibNumber, HIGHLIGHT_CAPS.bibNumber);
      if (evRaceId) evItem.raceId = evRaceId;
      if (evChip) evItem.chipTime = evChip;
      if (evPace) evItem.pace = evPace;
      if (evBib) evItem.bibNumber = evBib;
      if (typeof rawEv.rank === 'number' && Number.isFinite(rawEv.rank) && rawEv.rank > 0) {
        evItem.rank = Math.round(rawEv.rank);
      }
      cleanEvents.push(evItem);
    }
    if (cleanEvents.length > 0) base.participatedEvents = cleanEvents;
  }

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

export function getHighlightDisplayTitle(item: RunnerHighlight): string {
  if (item.mode === 'group') {
    if (item.teamName?.trim()) return item.teamName.trim();
    const memberNames = (item.groupMembers || []).map((m) => m.name.trim()).filter(Boolean);
    if (memberNames.length > 0) return memberNames.slice(0, 4).join(' · ');
  }
  if (item.mode === 'duo' && item.partnerName) {
    return `${item.runnerName} & ${item.partnerName}`;
  }
  return item.runnerName;
}

export function getHighlightBibDisplay(item: RunnerHighlight): string {
  if (item.mode === 'group') {
    const uniqueBibs = Array.from(
      new Set(
        (item.groupMembers || [])
          .map((m) => m.bibNumber?.trim())
          .filter((b): b is string => Boolean(b)),
      ),
    );
    if (uniqueBibs.length > 1) {
      return uniqueBibs
        .slice(0, 3)
        .map((b) => `#${b}`)
        .join('/') + (uniqueBibs.length > 3 ? ` +${uniqueBibs.length - 3}` : '');
    }
    if (uniqueBibs.length === 1) return `#${uniqueBibs[0]}`;
  }
  if (item.mode === 'duo' && item.partnerBibNumber) {
    return `#${item.bibNumber} / #${item.partnerBibNumber}`;
  }
  return `#${item.bibNumber}`;
}

export function formatHighlightShareSummary(item: RunnerHighlight): string {
  const extraEvents =
    item.participatedEvents && item.participatedEvents.length > 1
      ? ` (${item.participatedEvents.length} events)`
      : '';
  const extraAch =
    item.achievements && item.achievements.length > 0
      ? ` [${item.achievements.slice(0, 3).join(', ')}]`
      : '';

  if (item.mode === 'group') {
    const memberNames = (item.groupMembers || []).map((m) => m.name.trim()).filter(Boolean);
    const title = item.teamName?.trim()
      ? memberNames.length > 0
        ? `${item.teamName.trim()} (${memberNames.join(', ')})`
        : item.teamName.trim()
      : memberNames.join(', ') || item.runnerName;
    const uniqueBibs = Array.from(
      new Set(
        (item.groupMembers || [])
          .map((m) => m.bibNumber?.trim())
          .filter((b): b is string => Boolean(b)),
      ),
    );
    const bibs =
      uniqueBibs.length > 1
        ? `Bibs ${uniqueBibs.map((b) => `#${b}`).join(' / ')}`
        : `Bib #${uniqueBibs[0] || item.bibNumber}`;
    return `${title} (${bibs}) finished ${item.distance} at ${item.raceName} in ${item.chipTime} (${item.pace}) [${item.placement}]${extraEvents}${extraAch}. Happy running ka Racepulse!`;
  }
  const names = item.mode === 'duo' && item.partnerName
    ? `${item.runnerName} & ${item.partnerName}`
    : item.runnerName;
  const bibs = item.mode === 'duo' && item.partnerBibNumber
    ? `Bibs #${item.bibNumber} / #${item.partnerBibNumber}`
    : `Bib #${item.bibNumber}`;
  return `${names} (${bibs}) finished ${item.distance} at ${item.raceName} in ${item.chipTime} (${item.pace}) [${item.placement}]${extraEvents}${extraAch}. Happy running ka Racepulse!`;
}

// ========== DATABASE RUNNER DIRECTORY & TELEMETRY AUTO-FILL ==========

export interface HighlightUserAccountPhoto {
  uid: string;
  displayName: string;
  nickname?: string;
  username?: string;
  photoURL: string;
}

export interface RunnerRaceEntry {
  fullName: string;
  raceId: string;
  raceName: string;
  raceDate: string;
  raceCode: string;
  bibNumber: string;
  distance: string;
  distanceKm: number;
  placement: string;
  rank?: number;
  categoryRank?: number;
  finishSeconds: number;
  hasOfficialFinish: boolean;
  disqualified?: boolean;
  chipTime: string;
  gunTime: string;
  pace: string;
  splitPace: string;
  entryCategory?: 'solo' | 'duo' | 'trio' | 'group';
  teamName?: string;
  teamMembers?: HighlightGroupMember[];
  partnerName?: string;
  partnerBibNumber?: string;
  partnerPhotoUrl?: string;
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

export type HighlightRunnerSortMode = 'rank' | 'time' | 'name' | 'bib';

export interface RankedRaceRunnerItem {
  runner: DirectoryRunner;
  entry: RunnerRaceEntry;
}

export interface HighlightRunnerSources {
  runners: RunnerProfile[];
  liveResultsByRace: Record<string, PublicLiveResults>;
  chipReads: ChipRead[];
  userPhotosByUid: Record<string, string>;
  userAccounts?: HighlightUserAccountPhoto[];
}

/**
 * Converts a runner's multi-race history into card-ready participated event summaries.
 */
export function entriesToParticipatedEvents(entries: RunnerRaceEntry[]): HighlightParticipatedEvent[] {
  return entries.slice(0, 8).map((entry) => {
    const ev: HighlightParticipatedEvent = {
      raceId: entry.raceId,
      raceName: capText(entry.raceName, 56) || 'RacePulsePH Event',
      raceDate: capText(entry.raceDate, HIGHLIGHT_CAPS.raceDate),
      distance: capText(entry.distance, 18) || '10K',
      placement: capText(entry.placement, HIGHLIGHT_CAPS.placement) || 'Finisher',
    };
    if (entry.chipTime) ev.chipTime = capText(entry.chipTime, HIGHLIGHT_CAPS.chipTime);
    if (entry.pace) ev.pace = capText(entry.pace, HIGHLIGHT_CAPS.pace);
    if (entry.bibNumber) ev.bibNumber = capText(entry.bibNumber, HIGHLIGHT_CAPS.bibNumber);
    if (typeof entry.rank === 'number' && entry.rank > 0) ev.rank = entry.rank;
    return ev;
  });
}

/**
 * Derives verifiable achievement honors from a runner's participated event ledger and placements.
 */
export function deriveRunnerAchievements(
  entries: RunnerRaceEntry[] | HighlightParticipatedEvent[],
  primaryPlacement?: string,
  badgeStamp?: string,
): string[] {
  const list: string[] = [];
  const seen = new Set<string>();
  const pushTag = (raw: string | undefined) => {
    const clean = capText(raw, 28).toUpperCase();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key) || list.length >= 6) return;
    seen.add(key);
    list.push(clean);
  };

  if (badgeStamp) pushTag(badgeStamp);

  let wins = 0;
  let podiums = 0;
  let top10s = 0;
  let recordHolders = 0;
  const distances = new Set<string>();
  let longestKm = 0;
  let longestLabel = '';

  for (const item of entries) {
    const p = (item.placement || '').trim().toLowerCase();
    const rank = item.rank;
    if (p.includes('record')) recordHolders += 1;
    if (p === '1st' || rank === 1) wins += 1;
    if (p === '1st' || p === '2nd' || p === '3rd' || (typeof rank === 'number' && rank >= 1 && rank <= 3)) {
      podiums += 1;
    } else if (p.includes('top 10') || (typeof rank === 'number' && rank > 3 && rank <= 10)) {
      top10s += 1;
    }
    const dist = (item.distance || '').trim();
    if (dist) {
      distances.add(dist.toLowerCase());
      const km = 'distanceKm' in item && typeof item.distanceKm === 'number' ? item.distanceKm : parseDistanceKm(dist);
      if (km > longestKm) {
        longestKm = km;
        longestLabel = dist.toUpperCase();
      }
    }
  }

  const primaryLower = (primaryPlacement || '').trim().toLowerCase();
  if (recordHolders > 0 || primaryLower.includes('record')) pushTag('COURSE RECORD');
  if (wins >= 2) pushTag(`${wins}X RACE CHAMPION`);
  else if (wins === 1 || primaryLower === '1st') pushTag('RACE CHAMPION');

  if (podiums >= 2) pushTag(`${podiums}X PODIUM`);
  else if (podiums === 1 || primaryLower === '2nd' || primaryLower === '3rd') pushTag('PODIUM FINISHER');

  if (top10s > 0 || primaryLower.includes('top 10')) pushTag('TOP 10 CONTENDER');

  if (entries.length >= 2) {
    pushTag(`${entries.length} EVENTS COMPLETED`);
  } else if (entries.length === 1) {
    pushTag('OFFICIAL FINISHER');
  }

  if (distances.size >= 2) {
    pushTag('MULTI-DISTANCE');
  } else if (longestKm >= 21 && longestLabel) {
    pushTag(`${longestLabel} FINISHER`.slice(0, 28));
  }

  return list;
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

export function resolveRunnerAccountPhoto(params: {
  uid?: string;
  fullName?: string;
  userPhotosByUid?: Record<string, string>;
  userAccounts?: HighlightUserAccountPhoto[];
}): { photoUrl?: string; account?: HighlightUserAccountPhoto } {
  const { uid, fullName, userPhotosByUid, userAccounts } = params;
  if (uid && isRealAccountUid(uid)) {
    const account = userAccounts?.find((a) => a.uid === uid);
    const url = userPhotosByUid?.[uid] || account?.photoURL;
    if (url) return { photoUrl: url, account };
  }
  const norm = normalizeRunnerKey(fullName);
  if (norm && userAccounts && userAccounts.length > 0) {
    const matches = userAccounts.filter(
      (a) =>
        normalizeRunnerKey(a.displayName) === norm ||
        (a.nickname ? normalizeRunnerKey(a.nickname) === norm : false),
    );
    if (matches.length === 1 && matches[0].photoURL) {
      return { photoUrl: matches[0].photoURL, account: matches[0] };
    }
  }
  return {};
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
  teamMembers?: HighlightGroupMember[];
  partnerName?: string;
  partnerBibNumber?: string;
  partnerPhotoUrl?: string;
  partnerResult?: PublicLeaderboardEntry | RunnerResult;
  result?: PublicLeaderboardEntry | RunnerResult;
  race?: Race;
  live?: PublicLiveResults;
  uid?: string;
  photoUrl?: string;
}): RunnerRaceEntry {
  const {
    raceId,
    bibNumber,
    distance,
    entryCategory,
    teamName,
    teamMembers,
    partnerName,
    partnerBibNumber,
    partnerPhotoUrl,
    partnerResult,
    result,
    race,
    live,
    uid,
    photoUrl,
  } = params;
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
  const finishSeconds = parseDurationToSeconds(chipTime);
  const disqualified = Boolean(result?.disqualified);
  const rawRank = !disqualified && typeof result?.overallRank === 'number' && result.overallRank > 0
    ? result.overallRank
    : !disqualified && typeof result?.rank === 'number' && result.rank > 0
      ? result.rank
      : undefined;
  const categoryRank = !disqualified && typeof result?.categoryRank === 'number' && result.categoryRank > 0
    ? result.categoryRank
    : undefined;
  const placement = deriveHighlightPlacement(rawRank, rawRank, disqualified);

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
    fullName: params.fullName.trim().replace(/\s+/g, ' '),
    raceId,
    raceName,
    raceDate,
    raceCode,
    bibNumber: capText(bibNumber, HIGHLIGHT_CAPS.bibNumber),
    distance: resolvedDistance,
    distanceKm,
    placement,
    rank: rawRank,
    categoryRank,
    finishSeconds,
    hasOfficialFinish: finishSeconds > 0 && !disqualified,
    disqualified: disqualified || undefined,
    chipTime,
    gunTime,
    pace,
    splitPace,
    entryCategory,
    teamName,
    teamMembers,
    partnerName,
    partnerBibNumber,
    partnerPhotoUrl,
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
  userAccounts?: HighlightUserAccountPhoto[];
}): DirectoryRunner[] {
  const { runners, races, liveResultsByRace, computedResultsByRace, userPhotosByUid, userAccounts } = params;
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

    // Detect Duo partner or Trio/Group squad mates in the same race
    let partnerName: string | undefined;
    let partnerBibNumber: string | undefined;
    let partnerPhotoUrl: string | undefined;
    let partnerResult: PublicLeaderboardEntry | RunnerResult | undefined;
    let teamMembers: HighlightGroupMember[] | undefined;

    const resolveMemberAccount = (uid?: string, fullName?: string) =>
      resolveRunnerAccountPhoto({ uid, fullName, userPhotosByUid, userAccounts });

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
        partnerPhotoUrl = resolveMemberAccount(linkedPartner.uid, linkedPartner.fullName).photoUrl;
        partnerResult = findResultForBib(reg.raceId, linkedPartner.bibNumber, liveResultsByRace, computedResultsByRace);
      } else if (reg.teamMembers && reg.teamMembers.length >= 2) {
        const regNorm = normalizeRunnerKey(reg.fullName);
        const otherMember = reg.teamMembers.find((m) => normalizeRunnerKey(m) !== regNorm);
        if (otherMember) {
          partnerName = otherMember;
          partnerBibNumber = reg.bibNumber;
          partnerPhotoUrl = resolveMemberAccount(undefined, otherMember).photoUrl;
        }
      }
    } else if (reg.entryCategory === 'trio' || reg.entryCategory === 'group') {
      const peers = runnersByRace.get(reg.raceId) || [];
      const teamNorm = normalizeRunnerKey(reg.teamName);
      const squadList: HighlightGroupMember[] = [];
      const seenNorms = new Set<string>();

      const pushSquadMember = (name: string, bibNumber?: string, uid?: string) => {
        const cleanName = name.trim().replace(/\s+/g, ' ');
        const norm = normalizeRunnerKey(cleanName);
        if (!cleanName || !norm || seenNorms.has(norm) || squadList.length >= 6) return;
        seenNorms.add(norm);
        const resolved = resolveMemberAccount(uid, cleanName);
        const member: HighlightGroupMember = { name: cleanName };
        if (bibNumber?.trim()) member.bibNumber = bibNumber.trim();
        if (resolved.photoUrl) member.photoUrl = resolved.photoUrl;
        const resolvedUid = isRealAccountUid(uid) ? uid : resolved.account?.uid;
        if (resolvedUid) member.uid = resolvedUid;
        squadList.push(member);
      };

      pushSquadMember(reg.fullName, reg.bibNumber, reg.uid);

      for (const other of peers) {
        if (other === reg) continue;
        const sameTeam = Boolean(teamNorm && normalizeRunnerKey(other.teamName) === teamNorm);
        const inDeclaredMembers = Boolean(
          reg.teamMembers?.some((m) => normalizeRunnerKey(m) === normalizeRunnerKey(other.fullName)),
        );
        if (sameTeam || inDeclaredMembers) {
          pushSquadMember(other.fullName, other.bibNumber, other.uid);
          if (sameTeam && other.teamMembers && other.teamMembers.length > 0) {
            for (const memberName of other.teamMembers) {
              pushSquadMember(memberName, other.bibNumber, undefined);
            }
          }
        }
      }

      if (reg.teamMembers && reg.teamMembers.length > 0) {
        for (const memberName of reg.teamMembers) {
          pushSquadMember(memberName, reg.bibNumber, undefined);
        }
      }

      if (squadList.length > 0) {
        teamMembers = squadList;
      }
    }

    const resolvedPrimary = resolveMemberAccount(reg.uid, reg.fullName);
    const photoUrl = resolvedPrimary.photoUrl;
    const resolvedUid = isRealAccountUid(reg.uid) ? reg.uid : resolvedPrimary.account?.uid;
    const entry = buildEntryRecord({
      raceId: reg.raceId,
      bibNumber: reg.bibNumber,
      fullName: reg.fullName,
      distance: reg.distance,
      entryCategory: reg.entryCategory,
      teamName: reg.teamName,
      teamMembers,
      partnerName,
      partnerBibNumber,
      partnerPhotoUrl,
      partnerResult,
      result,
      race,
      live,
      uid: resolvedUid,
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
      const fallbackPhoto = resolveRunnerAccountPhoto({
        fullName: leaderEntry.fullName,
        userPhotosByUid,
        userAccounts,
      });
      const entry = buildEntryRecord({
        raceId,
        bibNumber: leaderEntry.bibNumber,
        fullName: leaderEntry.fullName,
        distance: leaderEntry.distance,
        result: leaderEntry,
        race,
        live,
        uid: fallbackPhoto.account?.uid,
        photoUrl: fallbackPhoto.photoUrl,
      });
      addEntryToDirectory(leaderEntry.fullName, entry);
    }
  }

  const list = Array.from(directory.values());

  // Assign deterministic division ranks (raceId + distance + category) when timing results exist without explicit overallRank.
  const divisionGroups = new Map<string, RunnerRaceEntry[]>();
  for (const runner of list) {
    for (const entry of runner.entries) {
      if (!entry.hasOfficialFinish) continue;
      const cohortKey = `${entry.raceId}::${entry.distance.trim().toLowerCase()}::${entry.entryCategory || 'solo'}`;
      const bucket = divisionGroups.get(cohortKey) || [];
      bucket.push(entry);
      divisionGroups.set(cohortKey, bucket);
    }
  }
  for (const bucket of divisionGroups.values()) {
    bucket.sort((a, b) => {
      const ra = a.rank ?? Number.POSITIVE_INFINITY;
      const rb = b.rank ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return a.finishSeconds - b.finishSeconds;
    });
    let nextSeq = 1;
    const seenRanks = new Set<number>(bucket.map((e) => e.rank).filter((r): r is number => typeof r === 'number' && r > 0));
    for (const entry of bucket) {
      if (!entry.rank) {
        while (seenRanks.has(nextSeq)) nextSeq += 1;
        entry.rank = nextSeq;
        seenRanks.add(nextSeq);
        nextSeq += 1;
        entry.placement = deriveHighlightPlacement(entry.rank, entry.rank, entry.disqualified);
      }
    }
  }

  for (const runner of list) {
    runner.entries.sort((a, b) => (b.raceDate || '').localeCompare(a.raceDate || '') || a.raceName.localeCompare(b.raceName));
  }
  list.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return list;
}

/**
 * Returns race-scoped runner entries filtered by distance/query and sorted by official rank, finish time, name, or bib.
 */
export function getRaceRankedEntries(params: {
  runnerDirectory: DirectoryRunner[];
  raceId: string;
  distanceFilter?: string;
  sortBy?: HighlightRunnerSortMode;
  searchQuery?: string;
}): RankedRaceRunnerItem[] {
  const {
    runnerDirectory,
    raceId,
    distanceFilter = 'all',
    sortBy = 'rank',
    searchQuery = '',
  } = params;

  const normDist = distanceFilter.trim().toLowerCase();
  const q = normalizeRunnerKey(searchQuery);
  const results: RankedRaceRunnerItem[] = [];

  for (const runner of runnerDirectory) {
    for (const entry of runner.entries) {
      if (raceId && raceId !== 'all' && entry.raceId !== raceId) continue;
      if (normDist && normDist !== 'all' && entry.distance.trim().toLowerCase() !== normDist) continue;
      if (q) {
        const matchesQuery =
          runner.key.includes(q) ||
          entry.bibNumber.toLowerCase().includes(q) ||
          entry.placement.toLowerCase().includes(q) ||
          (entry.partnerName || '').toLowerCase().includes(q) ||
          (entry.rank ? `#${entry.rank}` === q || String(entry.rank) === q : false);
        if (!matchesQuery) continue;
      }
      results.push({ runner, entry });
    }
  }

  results.sort((a, b) => {
    const ea = a.entry;
    const eb = b.entry;

    if (sortBy === 'rank') {
      const aFin = ea.hasOfficialFinish ? 0 : 1;
      const bFin = eb.hasOfficialFinish ? 0 : 1;
      if (aFin !== bFin) return aFin - bFin;

      const aRank = ea.rank ?? (ea.hasOfficialFinish ? 900000 + placementRankWeight(ea.placement) : Number.POSITIVE_INFINITY);
      const bRank = eb.rank ?? (eb.hasOfficialFinish ? 900000 + placementRankWeight(eb.placement) : Number.POSITIVE_INFINITY);
      if (aRank !== bRank) return aRank - bRank;

      if (ea.hasOfficialFinish && eb.hasOfficialFinish && ea.finishSeconds !== eb.finishSeconds) {
        return ea.finishSeconds - eb.finishSeconds;
      }
      return a.runner.fullName.localeCompare(b.runner.fullName);
    }

    if (sortBy === 'time') {
      const aFin = ea.hasOfficialFinish ? 0 : 1;
      const bFin = eb.hasOfficialFinish ? 0 : 1;
      if (aFin !== bFin) return aFin - bFin;
      if (ea.finishSeconds !== eb.finishSeconds) return ea.finishSeconds - eb.finishSeconds;
      return a.runner.fullName.localeCompare(b.runner.fullName);
    }

    if (sortBy === 'bib') {
      return ea.bibNumber.localeCompare(eb.bibNumber, undefined, { numeric: true, sensitivity: 'base' });
    }

    return a.runner.fullName.localeCompare(b.runner.fullName);
  });

  return results;
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
  let currentAccounts: HighlightUserAccountPhoto[] = [];

  const emit = () => {
    listener({
      runners: currentRunners,
      liveResultsByRace: currentLive,
      chipReads: currentReads,
      userPhotosByUid: currentPhotos,
      userAccounts: currentAccounts,
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
          const accounts: HighlightUserAccountPhoto[] = [];
          snap.forEach((docSnap) => {
            const data = docSnap.data() as UserProfile;
            const uid = data.uid || docSnap.id;
            const photoURL = (data.photoURL || '').trim();
            if (photoURL && !data.accessRemoved) {
              map[uid] = photoURL;
              accounts.push({
                uid,
                displayName: (data.displayName || data.nickname || data.username || 'Runner').trim(),
                nickname: data.nickname?.trim() || undefined,
                username: data.username?.trim() || undefined,
                photoURL,
              });
            }
          });
          accounts.sort((a, b) => a.displayName.localeCompare(b.displayName));
          currentPhotos = map;
          currentAccounts = accounts;
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
  const img = await loadImageElement(spec.sourceUrl, 'anonymous');
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
  slot: string,
  croppedDataUrl: string,
): Promise<string> {
  if (!ownerUid) return croppedDataUrl;
  try {
    const safeSlot = slot.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'photo';
    const blob = dataUrlToBlob(croppedDataUrl);
    const assetRef = ref(storage, `highlight-assets/${ownerUid}/${highlightId}/${safeSlot}-${Date.now()}.jpg`);
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

  const tryDrawCover = async (src: string, clipX: number, clipY: number, clipW: number, clipH: number) => {
    try {
      const img = await loadImageElement(src, 'anonymous');
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipX, clipY, clipW, clipH);
      ctx.clip();
      const scale = Math.max(clipW / img.width, clipH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, clipX + (clipW - dw) / 2, clipY + (clipH - dh) / 2, dw, dh);
      ctx.restore();
    } catch {
      ctx.fillStyle = '#18181d';
      ctx.fillRect(clipX, clipY, clipW, clipH);
    }
  };

  if (item.mode === 'group') {
    const memberPhotos = (item.groupMembers || [])
      .map((m) => m.photoUrl?.trim())
      .filter((u): u is string => Boolean(u))
      .slice(0, 4);
    if (item.groupPhotoLayout !== 'single' && memberPhotos.length >= 2) {
      if (memberPhotos.length === 2) {
        await Promise.all([
          tryDrawCover(memberPhotos[0], pad, pad, frameW / 2, frameH),
          tryDrawCover(memberPhotos[1], pad + frameW / 2, pad, frameW / 2, frameH),
        ]);
        ctx.strokeStyle = '#0c0c0f';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(pad + frameW / 2, pad);
        ctx.lineTo(pad + frameW / 2, pad + frameH);
        ctx.stroke();
      } else if (memberPhotos.length === 3) {
        await Promise.all([
          tryDrawCover(memberPhotos[0], pad, pad, frameW / 2, frameH),
          tryDrawCover(memberPhotos[1], pad + frameW / 2, pad, frameW / 2, frameH / 2),
          tryDrawCover(memberPhotos[2], pad + frameW / 2, pad + frameH / 2, frameW / 2, frameH / 2),
        ]);
        ctx.strokeStyle = '#0c0c0f';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(pad + frameW / 2, pad);
        ctx.lineTo(pad + frameW / 2, pad + frameH);
        ctx.moveTo(pad + frameW / 2, pad + frameH / 2);
        ctx.lineTo(pad + frameW, pad + frameH / 2);
        ctx.stroke();
      } else {
        await Promise.all([
          tryDrawCover(memberPhotos[0], pad, pad, frameW / 2, frameH / 2),
          tryDrawCover(memberPhotos[1], pad + frameW / 2, pad, frameW / 2, frameH / 2),
          tryDrawCover(memberPhotos[2], pad, pad + frameH / 2, frameW / 2, frameH / 2),
          tryDrawCover(memberPhotos[3], pad + frameW / 2, pad + frameH / 2, frameW / 2, frameH / 2),
        ]);
        ctx.strokeStyle = '#0c0c0f';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(pad + frameW / 2, pad);
        ctx.lineTo(pad + frameW / 2, pad + frameH);
        ctx.moveTo(pad, pad + frameH / 2);
        ctx.lineTo(pad + frameW, pad + frameH / 2);
        ctx.stroke();
      }
    } else if (item.photoUrl || memberPhotos[0]) {
      await tryDrawCover(item.photoUrl || memberPhotos[0], pad, pad, frameW, frameH);
    }
  } else if (item.mode === 'duo' && item.partnerPhotoUrl) {
    await Promise.all([
      tryDrawCover(item.photoUrl, pad, pad, frameW / 2, frameH),
      tryDrawCover(item.partnerPhotoUrl, pad + frameW / 2, pad, frameW / 2, frameH),
    ]);
    // Diagonal slash line
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(pad + frameW / 2 + 45, pad);
    ctx.lineTo(pad + frameW / 2 - 45, pad + frameH);
    ctx.stroke();
  } else if (item.photoUrl) {
    await tryDrawCover(item.photoUrl, pad, pad, frameW, frameH);
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

  const exportAchievements = [
    ...(item.badgeStamp ? [item.badgeStamp.toUpperCase()] : []),
    ...(item.achievements || []),
  ]
    .filter((v, idx, arr) => Boolean(v) && arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === idx)
    .slice(0, 3);

  if (exportAchievements.length > 0) {
    ctx.font = '700 17px "JetBrains Mono", monospace';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(exportAchievements.join('  •  ').slice(0, 56), pad + 28, pad + 106);
  }

  // Bottom typography block
  const bottomY = pad + frameH - 36;
  const exportEvents = (item.participatedEvents || []).slice(0, 3);
  const nameOffsetY = exportEvents.length > 0 ? 182 : 136;
  const eventHeaderOffsetY = exportEvents.length > 0 ? 242 : 196;

  ctx.fillStyle = '#d4d4d8';
  ctx.font = '600 22px "JetBrains Mono", monospace';
  ctx.fillText(`${item.raceName.toUpperCase()}  |  ${formatReadableDate(item.raceDate)}`, pad + 28, bottomY - eventHeaderOffsetY);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 44px "Space Grotesk", Inter, sans-serif';
  const displayName = getHighlightDisplayTitle(item);
  ctx.fillText(displayName.slice(0, 34), pad + 28, bottomY - nameOffsetY);

  if (exportEvents.length > 0) {
    ctx.font = '600 16px "JetBrains Mono", monospace';
    ctx.fillStyle = '#e4e4e7';
    const ledgerSummary = exportEvents
      .map((ev) => `${ev.raceName.slice(0, 18)} (${ev.distance} · ${ev.placement})`)
      .join('  |  ');
    const extraCount = (item.participatedEvents?.length || 0) - exportEvents.length;
    ctx.fillText(
      (ledgerSummary + (extraCount > 0 ? `  +${extraCount}` : '')).slice(0, 68),
      pad + 28,
      bottomY - 134,
    );
  }

  // Metrics strip
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.strokeRect(pad + 28, bottomY - 104, frameW - 56, 86);

  const cols = [
    { label: 'DISTANCE', value: item.distance },
    { label: 'FINISH TIME', value: item.chipTime },
    { label: 'AVG PACE', value: item.mode === 'duo' && item.combinedAvgPace ? item.combinedAvgPace : item.pace },
    { label: 'BIB', value: getHighlightBibDisplay(item) },
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
