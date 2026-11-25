import {
  isSafeClubAssetUrl,
  isValidClubAssetStoragePath,
  type SaveClubDefinitionInput,
} from './client';
import { DEFAULT_CLUB_MODULES, slugifyClubId } from './presets';
import type {
  ClubBillingProvider,
  ClubBillingTier,
  ClubDefinition,
  ClubJoinPolicy,
  ClubModuleMap,
  ClubRequestRecord,
  ClubStatus,
  ClubSubscriptionStatus,
} from './types';

export const CLUB_STUDIO_COLOR_SWATCHES = [
  '#DC2626',
  '#F59E0B',
  '#0EA5E9',
  '#10B981',
  '#2563EB',
  '#64748B',
  '#EA580C',
  '#0F172A',
] as const;

const CLUB_ID_RE = /^[a-zA-Z0-9_-]{2,64}$/;
const ENTITY_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const UID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);

export type ClubDraftFieldKey =
  | 'clubId'
  | 'name'
  | 'description'
  | 'city'
  | 'scheduleSummary'
  | 'primaryColor'
  | 'accentColor'
  | 'memberLimit';

export interface ClubFormDraft {
  clubId: string;
  name: string;
  description: string;
  city: string;
  scheduleSummary: string;
  joinPolicy: ClubJoinPolicy;
  modules: ClubModuleMap;
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  logoStoragePath: string;
  coverUrl: string;
  coverStoragePath: string;
  captainUids: string[];
  linkedBadgeIds: string[];
  featuredRouteIds: string[];
  linkedRaceIds: string[];
  memberLimit: string;
  billingTier: ClubBillingTier;
  subscriptionStatus: ClubSubscriptionStatus;
  billingProvider: ClubBillingProvider;
  paymongoCustomerId: string;
  paymongoSubscriptionId: string;
  status: ClubStatus;
}

export type ClubDraftValidationResult =
  | { ok: true; payload: SaveClubDefinitionInput }
  | {
      ok: false;
      errors: string[];
      fieldErrors: Partial<Record<ClubDraftFieldKey, string>>;
    };

export function normalizeStudioHexColor(value: string, fallback = '#DC2626'): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed.split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback.toUpperCase();
}

export function createBlankClubDraft(): ClubFormDraft {
  return {
    clubId: '',
    name: '',
    description: '',
    city: '',
    scheduleSummary: '',
    joinPolicy: 'open',
    modules: { ...DEFAULT_CLUB_MODULES },
    primaryColor: '#DC2626',
    accentColor: '#F59E0B',
    logoUrl: '',
    logoStoragePath: '',
    coverUrl: '',
    coverStoragePath: '',
    captainUids: [],
    linkedBadgeIds: [],
    featuredRouteIds: [],
    linkedRaceIds: [],
    memberLimit: '',
    billingTier: 'free',
    subscriptionStatus: 'active',
    billingProvider: 'admin_manual',
    paymongoCustomerId: '',
    paymongoSubscriptionId: '',
    status: 'active',
  };
}

export function clubDefinitionToDraft(club: ClubDefinition): ClubFormDraft {
  return {
    clubId: club.clubId,
    name: club.name,
    description: club.description,
    city: club.city,
    scheduleSummary: club.scheduleSummary || '',
    joinPolicy: club.joinPolicy || 'open',
    modules: { ...DEFAULT_CLUB_MODULES, ...(club.modules || {}) },
    primaryColor: normalizeStudioHexColor(club.primaryColor, '#DC2626'),
    accentColor: normalizeStudioHexColor(club.accentColor, '#F59E0B'),
    logoUrl: club.logoUrl || '',
    logoStoragePath: club.logoStoragePath || '',
    coverUrl: club.coverUrl || '',
    coverStoragePath: club.coverStoragePath || '',
    captainUids: Array.isArray(club.captainUids) ? [...club.captainUids] : [],
    linkedBadgeIds: Array.isArray(club.linkedBadgeIds) ? [...club.linkedBadgeIds] : [],
    featuredRouteIds: Array.isArray(club.featuredRouteIds) ? [...club.featuredRouteIds] : [],
    linkedRaceIds: Array.isArray(club.linkedRaceIds) ? [...club.linkedRaceIds] : [],
    memberLimit:
      typeof club.memberLimit === 'number' && Number.isInteger(club.memberLimit)
        ? String(club.memberLimit)
        : '',
    billingTier: club.billingTier || 'free',
    subscriptionStatus: club.subscriptionStatus || 'active',
    billingProvider: club.billingProvider || 'admin_manual',
    paymongoCustomerId: club.paymongoCustomerId || '',
    paymongoSubscriptionId: club.paymongoSubscriptionId || '',
    status: club.status || 'active',
  };
}

export function clubRequestToDraft(req: ClubRequestRecord): ClubFormDraft {
  const base = createBlankClubDraft();
  return {
    ...base,
    clubId: slugifyClubId(req.clubName),
    name: req.clubName.trim(),
    description: req.notes.trim() || `${req.clubName.trim()} community running group in ${req.city.trim()}.`,
    city: req.city.trim(),
    scheduleSummary: req.scheduleSummary.trim(),
    modules: { ...DEFAULT_CLUB_MODULES, ...(req.desiredModules || {}) },
    captainUids: req.requesterUid ? [req.requesterUid] : [],
  };
}

export function draftToPreviewClub(draft: ClubFormDraft, actorUid = 'admin'): ClubDefinition {
  const nowIso = new Date().toISOString();
  const parsedLimit = draft.memberLimit.trim() ? Number(draft.memberLimit.trim()) : null;
  const memberLimit =
    parsedLimit !== null && Number.isInteger(parsedLimit) && parsedLimit >= 2 && parsedLimit <= 5000
      ? parsedLimit
      : null;

  return {
    clubId: draft.clubId.trim() || 'new_club',
    name: draft.name.trim() || 'Untitled Running Club',
    description: draft.description.trim() || 'Describe weekly pace groups, meetup points, and coaching focus.',
    city: draft.city.trim() || 'Manila',
    scheduleSummary: draft.scheduleSummary.trim() || 'Sat 05:30 AM PHT',
    joinPolicy: draft.joinPolicy,
    modules: { ...DEFAULT_CLUB_MODULES, ...draft.modules },
    primaryColor: normalizeStudioHexColor(draft.primaryColor, '#DC2626'),
    accentColor: normalizeStudioHexColor(draft.accentColor, '#F59E0B'),
    logoUrl: draft.logoUrl.trim(),
    logoStoragePath: draft.logoStoragePath.trim(),
    coverUrl: draft.coverUrl.trim(),
    coverStoragePath: draft.coverStoragePath.trim(),
    captainUids: [...draft.captainUids],
    linkedBadgeIds: [...draft.linkedBadgeIds],
    featuredRouteIds: [...draft.featuredRouteIds],
    linkedRaceIds: [...draft.linkedRaceIds],
    memberLimit,
    billingTier: draft.billingTier,
    subscriptionStatus: draft.subscriptionStatus,
    billingProvider: draft.billingProvider,
    paymongoCustomerId: draft.paymongoCustomerId.trim() || undefined,
    paymongoSubscriptionId: draft.paymongoSubscriptionId.trim() || undefined,
    status: draft.status,
    memberCount: draft.captainUids.length,
    requestCount: 0,
    createdAt: nowIso,
    createdBy: actorUid,
    updatedAt: nowIso,
    updatedBy: actorUid,
  };
}

function cleanUniqueIds(list: readonly string[], re: RegExp, max: number): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const trimmed = typeof item === 'string' ? item.trim() : '';
    if (!re.test(trimmed) || FORBIDDEN_IDS.has(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
    if (unique.length >= max) break;
  }
  return unique;
}

export function validateAndBuildClubSavePayload(draft: ClubFormDraft): ClubDraftValidationResult {
  const errors: string[] = [];
  const fieldErrors: Partial<Record<ClubDraftFieldKey, string>> = {};

  const clubId = draft.clubId.trim();
  if (!CLUB_ID_RE.test(clubId) || FORBIDDEN_IDS.has(clubId)) {
    const msg = 'Club ID must be 2 to 64 letters, digits, underscores, or hyphens.';
    fieldErrors.clubId = msg;
    errors.push(msg);
  }

  const name = draft.name.trim();
  if (name.length < 2 || name.length > 80) {
    const msg = 'Club name must be 2 to 80 characters.';
    fieldErrors.name = msg;
    errors.push(msg);
  }

  const description = draft.description.trim();
  if (description.length < 1 || description.length > 500) {
    const msg = 'Club description must be 1 to 500 characters.';
    fieldErrors.description = msg;
    errors.push(msg);
  }

  const city = draft.city.trim();
  if (city.length < 1 || city.length > 80) {
    const msg = 'Home city is required (up to 80 characters).';
    fieldErrors.city = msg;
    errors.push(msg);
  }

  const scheduleSummary = draft.scheduleSummary.trim();
  if (scheduleSummary.length > 140) {
    const msg = 'Schedule summary must stay within 140 characters.';
    fieldErrors.scheduleSummary = msg;
    errors.push(msg);
  }

  const rawPrimary = draft.primaryColor.trim();
  if (!HEX_COLOR_RE.test(rawPrimary)) {
    const msg = 'Primary color must be a valid hex code like #DC2626.';
    fieldErrors.primaryColor = msg;
    errors.push(msg);
  }
  const rawAccent = draft.accentColor.trim();
  if (!HEX_COLOR_RE.test(rawAccent)) {
    const msg = 'Accent color must be a valid hex code like #F59E0B.';
    fieldErrors.accentColor = msg;
    errors.push(msg);
  }

  let memberLimit: number | null = null;
  const rawLimit = draft.memberLimit.trim();
  if (rawLimit !== '') {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 2 || parsed > 5000) {
      const msg = 'Member limit must be empty or a whole number between 2 and 5000.';
      fieldErrors.memberLimit = msg;
      errors.push(msg);
    } else {
      memberLimit = parsed;
    }
  }

  const logoUrl = draft.logoUrl.trim();
  const logoStoragePath = draft.logoStoragePath.trim();
  if ((logoUrl || logoStoragePath) && CLUB_ID_RE.test(clubId)) {
    if (!isValidClubAssetStoragePath(logoStoragePath, clubId) || !isSafeClubAssetUrl(logoUrl, logoStoragePath)) {
      errors.push('Club logo asset reference is invalid. Re-upload the logo image.');
    }
  }

  const coverUrl = draft.coverUrl.trim();
  const coverStoragePath = draft.coverStoragePath.trim();
  if ((coverUrl || coverStoragePath) && CLUB_ID_RE.test(clubId)) {
    if (!isValidClubAssetStoragePath(coverStoragePath, clubId) || !isSafeClubAssetUrl(coverUrl, coverStoragePath)) {
      errors.push('Club cover image reference is invalid. Re-upload the cover image.');
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, fieldErrors };
  }

  return {
    ok: true,
    payload: {
      clubId,
      name,
      description,
      city,
      scheduleSummary,
      joinPolicy: draft.joinPolicy,
      modules: { ...DEFAULT_CLUB_MODULES, ...draft.modules },
      primaryColor: normalizeStudioHexColor(rawPrimary, '#DC2626'),
      accentColor: normalizeStudioHexColor(rawAccent, '#F59E0B'),
      logoUrl,
      logoStoragePath,
      coverUrl,
      coverStoragePath,
      captainUids: cleanUniqueIds(draft.captainUids, UID_RE, 25),
      linkedBadgeIds: cleanUniqueIds(draft.linkedBadgeIds, ENTITY_ID_RE, 50),
      featuredRouteIds: cleanUniqueIds(draft.featuredRouteIds, ENTITY_ID_RE, 30),
      linkedRaceIds: cleanUniqueIds(draft.linkedRaceIds, ENTITY_ID_RE, 30),
      memberLimit,
      billingTier: draft.billingTier,
      subscriptionStatus: draft.subscriptionStatus,
      billingProvider: draft.billingProvider,
      ...(draft.paymongoCustomerId.trim()
        ? { paymongoCustomerId: draft.paymongoCustomerId.trim().slice(0, 128) }
        : {}),
      ...(draft.paymongoSubscriptionId.trim()
        ? { paymongoSubscriptionId: draft.paymongoSubscriptionId.trim().slice(0, 128) }
        : {}),
      status: draft.status,
    },
  };
}
