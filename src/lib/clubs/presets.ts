import type {
  ClubBillingProvider,
  ClubBillingTier,
  ClubJoinPolicy,
  ClubModuleKey,
  ClubModuleMap,
  ClubSubscriptionStatus,
} from './types';

export const CLUB_MODULES: readonly ClubModuleKey[] = [
  'chat',
  'leaderboard',
  'events',
  'badges',
  'routeLibrary',
  'announcements',
  'memberSpotlight',
  'customTheme',
] as const;

export const DEFAULT_CLUB_MODULES: Readonly<ClubModuleMap> = {
  chat: true,
  leaderboard: true,
  events: true,
  badges: true,
  routeLibrary: false,
  announcements: true,
  memberSpotlight: false,
  customTheme: true,
};

export const CLUB_JOIN_POLICIES: readonly ClubJoinPolicy[] = [
  'open',
  'approval',
  'invite_only',
] as const;

export const CLUB_BILLING_TIERS: readonly ClubBillingTier[] = [
  'free',
  'community',
  'pro',
] as const;

export const CLUB_SUBSCRIPTION_STATUSES: readonly ClubSubscriptionStatus[] = [
  'active',
  'trial',
  'past_due',
  'canceled',
] as const;

export const CLUB_BILLING_PROVIDERS: readonly ClubBillingProvider[] = [
  'admin_manual',
  'paymongo',
] as const;

export const CLUB_MODULE_META: Readonly<
  Record<ClubModuleKey, { label: string; description: string }>
> = {
  chat: {
    label: 'Club Chat',
    description: 'Dedicated group room inside Runner Inbox for meetup coordination.',
  },
  leaderboard: {
    label: 'Leaderboard',
    description: 'Monthly and all-time verified kilometer rankings for club members.',
  },
  events: {
    label: 'Meetups & Events',
    description: 'Scheduled group runs paired with official RacePulsePH races.',
  },
  badges: {
    label: 'Linked Badges',
    description: 'Curated club achievement crests shown on member cards.',
  },
  routeLibrary: {
    label: 'Route Library',
    description: 'Featured training loops and race courses pinned for the club.',
  },
  announcements: {
    label: 'Announcements',
    description: 'Pinned notices posted by club captains and race stewards.',
  },
  memberSpotlight: {
    label: 'Member Spotlight',
    description: 'Rotating highlight for pacers, finishers, and consistent club runners.',
  },
  customTheme: {
    label: 'Custom Colors',
    description: 'Custom club primary and accent palette tokens on cards and headers.',
  },
};

export const CLUB_JOIN_POLICY_META: Readonly<Record<ClubJoinPolicy, { label: string; hint: string }>> = {
  open: {
    label: 'Open Join',
    hint: 'Any active runner can join immediately with one tap.',
  },
  approval: {
    label: 'Captain Approval',
    hint: 'Memberships wait in Pending until a club captain or admin approves.',
  },
  invite_only: {
    label: 'Invite Only',
    hint: 'Hidden from open self-join; admins and captains onboard members.',
  },
};

export const CLUB_BILLING_META: Readonly<Record<ClubBillingTier, { label: string; summary: string }>> = {
  free: {
    label: 'Free Starter',
    summary: 'Admin-created community hub with core roster and meetup modules.',
  },
  community: {
    label: 'Community Club',
    summary: 'Expanded roster limits, custom theme colors, and route library.',
  },
  pro: {
    label: 'Pro Club',
    summary: 'Full module suite prepared for automated PayMongo club billing.',
  },
};

export function slugifyClubId(rawName: string): string {
  const cleaned = rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
    .replace(/_+$/g, '');
  if (cleaned.length < 2 || cleaned === '__proto__' || cleaned === 'constructor' || cleaned === 'prototype') {
    return 'club';
  }
  return cleaned;
}
