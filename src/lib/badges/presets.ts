import type { RecordedRunSummary } from '../runs/types';
import type {
  AthleteProgression,
  AthleteRankTitle,
  BadgeAnimationEffect,
  BadgeBorderStyle,
  BadgeCategory,
  BadgeDefinition,
  BadgeEmblemId,
  BadgeEmblemPreset,
  BadgeRuleConfig,
  BadgeRuleType,
  BadgeTier,
  LevelProgressSummary,
  UserBadgeAward,
} from './types';

export const BADGE_TIERS: readonly BadgeTier[] = [
  'common',
  'rare',
  'special',
  'epic',
  'legendary',
  'alamat',
] as const;

export const BADGE_CATEGORIES: readonly BadgeCategory[] = [
  'onboarding',
  'distance',
  'elevation',
  'races',
  'exploration',
  'community',
  'streaks',
  'special',
] as const;

export const BADGE_BORDER_STYLES: readonly BadgeBorderStyle[] = [
  'solid-ring',
  'double-crest',
  'laurel-wreath',
  'hex-tactical',
  'sunburst-ph',
  'ribbon-medal',
  'diamond-cut',
  'cyber-bezel',
  'alamat-gold',
] as const;

export const BADGE_ANIMATION_EFFECTS: readonly BadgeAnimationEffect[] = [
  'none',
  'shimmer-sweep',
  'gentle-float',
  'pulse-glow',
  'prism-tilt',
  'sparkle-orbit',
  'flame-aura',
] as const;

export const BADGE_EMBLEM_IDS: readonly BadgeEmblemId[] = [
  'sunrise-burst',
  'mountain-peak',
  'lightning-bolt',
  'trophy-crest',
  'laurel-crown',
  'compass-rose',
  'flame-spirit',
  'shoe-wings',
  'stopwatch-gold',
  'island-archipelago',
  'jeepney-star',
  'volcano-summit',
  'wave-runner',
  'heart-pulse',
  'shield-vanguard',
  'flag-finish',
  'moon-night',
  'diamond-alamat',
] as const;

export const BADGE_RULE_TYPES: readonly BadgeRuleType[] = [
  'welcome',
  'profile_complete',
  'race_joined',
  'race_finished',
  'run_count',
  'run_single_distance_km',
  'run_total_distance_km',
  'run_total_elevation_m',
  'run_time_window',
  'regions_explored',
  'club_joined',
  'friends_count',
  'social_posts_count',
  'kudos_received',
  'run_streak_weeks',
  'inbox_streak_days',
  'manual_grant',
] as const;

export const BADGE_TIER_META: Readonly<
  Record<
    BadgeTier,
    {
      id: BadgeTier;
      label: string;
      rankOrder: number;
      defaultPrimary: string;
      defaultSecondary: string;
    }
  >
> = {
  common: {
    id: 'common',
    label: 'Common',
    rankOrder: 1,
    defaultPrimary: '#64748B',
    defaultSecondary: '#94A3B8',
  },
  rare: {
    id: 'rare',
    label: 'Rare',
    rankOrder: 2,
    defaultPrimary: '#0EA5E9',
    defaultSecondary: '#38BDF8',
  },
  special: {
    id: 'special',
    label: 'Special',
    rankOrder: 3,
    defaultPrimary: '#DC2626',
    defaultSecondary: '#FBBF24',
  },
  epic: {
    id: 'epic',
    label: 'Epic',
    rankOrder: 4,
    defaultPrimary: '#10B981',
    defaultSecondary: '#A3E635',
  },
  legendary: {
    id: 'legendary',
    label: 'Legendary',
    rankOrder: 5,
    defaultPrimary: '#2563EB',
    defaultSecondary: '#22D3EE',
  },
  alamat: {
    id: 'alamat',
    label: 'Alamat',
    rankOrder: 6,
    defaultPrimary: '#F59E0B',
    defaultSecondary: '#EF4444',
  },
};

export const BADGE_CATEGORY_META: Readonly<
  Record<BadgeCategory, { id: BadgeCategory; label: string; description: string }>
> = {
  onboarding: {
    id: 'onboarding',
    label: 'Onboarding',
    description: 'Starter milestones for new Ka-RacePulse athletes.',
  },
  distance: {
    id: 'distance',
    label: 'Distance',
    description: 'Single-run and lifetime kilometer achievements.',
  },
  elevation: {
    id: 'elevation',
    label: 'Elevation',
    description: 'Verified vertical gain and mountain climb totals.',
  },
  races: {
    id: 'races',
    label: 'Official Races',
    description: 'Event registrations and verified finish-mat results.',
  },
  exploration: {
    id: 'exploration',
    label: 'Exploration',
    description: 'Runs logged across Philippine island groups and regions.',
  },
  community: {
    id: 'community',
    label: 'Community',
    description: 'Running clubs, friends, route posts, and kudos.',
  },
  streaks: {
    id: 'streaks',
    label: 'Streaks',
    description: 'Weekly run consistency and daily friend chat streaks.',
  },
  special: {
    id: 'special',
    label: 'Special',
    description: 'Timed windows, seasonal drops, and admin honors.',
  },
};

export const BADGE_BORDER_META: Readonly<
  Record<BadgeBorderStyle, { id: BadgeBorderStyle; label: string; summary: string }>
> = {
  'solid-ring': {
    id: 'solid-ring',
    label: 'Solid Ring',
    summary: 'Clean circular bezel with crisp outer stroke.',
  },
  'double-crest': {
    id: 'double-crest',
    label: 'Double Crest',
    summary: 'Dual concentric ring with contrasting inner trim.',
  },
  'laurel-wreath': {
    id: 'laurel-wreath',
    label: 'Laurel Wreath',
    summary: 'Championship botanical frame inspired by marathon medals.',
  },
  'hex-tactical': {
    id: 'hex-tactical',
    label: 'Hex Tactical',
    summary: 'Six-sided trail shield with sharp geometric facets.',
  },
  'sunburst-ph': {
    id: 'sunburst-ph',
    label: 'Sunburst PH',
    summary: 'Eight-ray Philippine sun crown around the emblem.',
  },
  'ribbon-medal': {
    id: 'ribbon-medal',
    label: 'Ribbon Medal',
    summary: 'Official finisher medallion hung from a top race ribbon.',
  },
  'diamond-cut': {
    id: 'diamond-cut',
    label: 'Diamond Cut',
    summary: 'Rotated four-corner bevel for prestige milestones.',
  },
  'cyber-bezel': {
    id: 'cyber-bezel',
    label: 'Cyber Bezel',
    summary: 'Chamfered telemetry bracket frame with corner notches.',
  },
  'alamat-gold': {
    id: 'alamat-gold',
    label: 'Alamat Gold',
    summary: 'Sovereign dual-tone crest reserved for flagship awards.',
  },
};

export const BADGE_ANIMATION_META: Readonly<
  Record<BadgeAnimationEffect, { id: BadgeAnimationEffect; label: string; summary: string }>
> = {
  none: {
    id: 'none',
    label: 'Static',
    summary: 'Zero motion overlay for calm presentation.',
  },
  'shimmer-sweep': {
    id: 'shimmer-sweep',
    label: 'Shimmer Sweep',
    summary: 'Subtle diagonal specular glint across the crest.',
  },
  'gentle-float': {
    id: 'gentle-float',
    label: 'Gentle Float',
    summary: 'Soft vertical hover rhythm on GPU transform.',
  },
  'pulse-glow': {
    id: 'pulse-glow',
    label: 'Pulse Glow',
    summary: 'Calibrated outer aura fade using GPU opacity.',
  },
  'prism-tilt': {
    id: 'prism-tilt',
    label: 'Prism Tilt',
    summary: 'Slow metallic facet angle oscillation.',
  },
  'sparkle-orbit': {
    id: 'sparkle-orbit',
    label: 'Sparkle Orbit',
    summary: 'Orbiting star points rotating around the frame.',
  },
  'flame-aura': {
    id: 'flame-aura',
    label: 'Flame Aura',
    summary: 'Warm Alamat crest flare animated on transform and opacity.',
  },
};

export const BADGE_RULE_META: Readonly<
  Record<
    BadgeRuleType,
    {
      id: BadgeRuleType;
      label: string;
      description: string;
      usesThreshold: boolean;
      thresholdLabel?: string;
      unit?: string;
    }
  >
> = {
  welcome: {
    id: 'welcome',
    label: 'Welcome Account',
    description: 'Awarded automatically to active runner accounts.',
    usesThreshold: false,
  },
  profile_complete: {
    id: 'profile_complete',
    label: 'Complete Profile',
    description: 'Awarded when username and athlete profile details are saved.',
    usesThreshold: false,
  },
  race_joined: {
    id: 'race_joined',
    label: 'Race Registration',
    description: 'Counts confirmed event registrations or claimed race bibs.',
    usesThreshold: true,
    thresholdLabel: 'Races joined',
    unit: 'races',
  },
  race_finished: {
    id: 'race_finished',
    label: 'Official Race Finish',
    description: 'Requires finalized race results with a clean official finish.',
    usesThreshold: true,
    thresholdLabel: 'Races finished',
    unit: 'races',
  },
  run_count: {
    id: 'run_count',
    label: 'Verified Run Count',
    description: 'Counts server-verified GPS runs.',
    usesThreshold: true,
    thresholdLabel: 'Verified runs',
    unit: 'runs',
  },
  run_single_distance_km: {
    id: 'run_single_distance_km',
    label: 'Single Run Distance',
    description: 'Longest verified single session distance in kilometers.',
    usesThreshold: true,
    thresholdLabel: 'Target distance',
    unit: 'km',
  },
  run_total_distance_km: {
    id: 'run_total_distance_km',
    label: 'Cumulative Distance',
    description: 'Lifetime verified GPS distance across all runs.',
    usesThreshold: true,
    thresholdLabel: 'Total distance',
    unit: 'km',
  },
  run_total_elevation_m: {
    id: 'run_total_elevation_m',
    label: 'Cumulative Elevation',
    description: 'Lifetime verified elevation gain in meters.',
    usesThreshold: true,
    thresholdLabel: 'Total elevation gain',
    unit: 'm',
  },
  run_time_window: {
    id: 'run_time_window',
    label: 'PHT Time Window',
    description: 'Verified runs started within a Philippine Standard Time hour range.',
    usesThreshold: true,
    thresholdLabel: 'Qualifying runs',
    unit: 'runs',
  },
  regions_explored: {
    id: 'regions_explored',
    label: 'Regions Explored',
    description: 'Distinct Philippine island groups or published course regions.',
    usesThreshold: true,
    thresholdLabel: 'Regions required',
    unit: 'regions',
  },
  club_joined: {
    id: 'club_joined',
    label: 'Club Membership',
    description: 'Active memberships across RacePulsePH running clubs.',
    usesThreshold: true,
    thresholdLabel: 'Clubs joined',
    unit: 'clubs',
  },
  friends_count: {
    id: 'friends_count',
    label: 'Running Friends',
    description: 'Accepted athlete friend connections.',
    usesThreshold: true,
    thresholdLabel: 'Friends count',
    unit: 'friends',
  },
  social_posts_count: {
    id: 'social_posts_count',
    label: 'Community Posts',
    description: 'Active run stories or route snaps shared on Home.',
    usesThreshold: true,
    thresholdLabel: 'Posts shared',
    unit: 'posts',
  },
  kudos_received: {
    id: 'kudos_received',
    label: 'Kudos Received',
    description: 'Total community kudos earned on shared posts.',
    usesThreshold: true,
    thresholdLabel: 'Kudos total',
    unit: 'kudos',
  },
  run_streak_weeks: {
    id: 'run_streak_weeks',
    label: 'Weekly Run Streak',
    description: 'Consecutive PHT weeks with at least one verified run.',
    usesThreshold: true,
    thresholdLabel: 'Streak weeks',
    unit: 'weeks',
  },
  inbox_streak_days: {
    id: 'inbox_streak_days',
    label: 'Daily Chat Streak',
    description: 'Longest consecutive PHT day streak with a running friend.',
    usesThreshold: true,
    thresholdLabel: 'Streak days',
    unit: 'days',
  },
  manual_grant: {
    id: 'manual_grant',
    label: 'Manual Admin Grant',
    description: 'Issued directly by RacePulsePH admins or superadmins.',
    usesThreshold: false,
  },
};

export const BADGE_EMBLEM_PRESETS: readonly BadgeEmblemPreset[] = [
  {
    id: 'sunrise-burst',
    label: 'Sunrise Burst',
    summary: 'Eight-ray Philippine dawn over the horizon.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'circle', cx: 32, cy: 36, r: 11, fill: 'primary' },
      { kind: 'line', x1: 32, y1: 10, x2: 32, y2: 19, stroke: 'secondary', strokeWidth: 3.5, strokeLinecap: 'round' },
      { kind: 'line', x1: 14, y1: 18, x2: 20, y2: 24, stroke: 'secondary', strokeWidth: 3.5, strokeLinecap: 'round' },
      { kind: 'line', x1: 50, y1: 18, x2: 44, y2: 24, stroke: 'secondary', strokeWidth: 3.5, strokeLinecap: 'round' },
      { kind: 'line', x1: 9, y1: 36, x2: 17, y2: 36, stroke: 'secondary', strokeWidth: 3.5, strokeLinecap: 'round' },
      { kind: 'line', x1: 47, y1: 36, x2: 55, y2: 36, stroke: 'secondary', strokeWidth: 3.5, strokeLinecap: 'round' },
      { kind: 'path', d: 'M12 49 H52', stroke: 'primary', strokeWidth: 3.5, strokeLinecap: 'round' },
    ],
  },
  {
    id: 'mountain-peak',
    label: 'Mountain Peak',
    summary: 'Twin Cordillera ridgeline with snow-lit summit facet.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'polygon', points: '8,49 27,16 46,49', fill: 'primary' },
      { kind: 'polygon', points: '30,49 43,25 56,49', fill: 'secondary', opacity: 0.9 },
      { kind: 'polygon', points: '27,16 21,27 27,25 33,27', fill: 'secondary' },
    ],
  },
  {
    id: 'lightning-bolt',
    label: 'Lightning Bolt',
    summary: 'High-tempo speedwork and interval split bolt.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'polygon', points: '35,8 16,35 30,35 26,56 48,27 33,27', fill: 'primary', stroke: 'secondary', strokeWidth: 2, strokeLinejoin: 'round' },
    ],
  },
  {
    id: 'trophy-crest',
    label: 'Trophy Crest',
    summary: 'Official podium cup with twin handles and base.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'path', d: 'M20 14 H44 V26 C44 34 38.5 39 32 39 C25.5 39 20 34 20 26 Z', fill: 'primary' },
      { kind: 'path', d: 'M20 18 H13 C13 26 16 29 20 29', fill: 'none', stroke: 'secondary', strokeWidth: 3, strokeLinecap: 'round' },
      { kind: 'path', d: 'M44 18 H51 C51 26 48 29 44 29', fill: 'none', stroke: 'secondary', strokeWidth: 3, strokeLinecap: 'round' },
      { kind: 'rect', x: 29, y: 39, width: 6, height: 9, fill: 'secondary' },
      { kind: 'rect', x: 22, y: 48, width: 20, height: 5, rx: 2, fill: 'primary' },
    ],
  },
  {
    id: 'laurel-crown',
    label: 'Laurel Crown',
    summary: 'Victorious marathon leaves framing a central star.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'path', d: 'M24 49 C14 42 12 26 21 15', fill: 'none', stroke: 'primary', strokeWidth: 4, strokeLinecap: 'round' },
      { kind: 'path', d: 'M40 49 C50 42 52 26 43 15', fill: 'none', stroke: 'primary', strokeWidth: 4, strokeLinecap: 'round' },
      { kind: 'polygon', points: '32,16 35,25 44,25 37,30 39,39 32,34 25,39 27,30 20,25 29,25', fill: 'secondary' },
    ],
  },
  {
    id: 'compass-rose',
    label: 'Compass Rose',
    summary: 'Four-point expedition needle for route navigators.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'circle', cx: 32, cy: 32, r: 21, fill: 'none', stroke: 'primary', strokeWidth: 3 },
      { kind: 'polygon', points: '32,13 38,32 32,30 26,32', fill: 'secondary' },
      { kind: 'polygon', points: '32,51 38,32 32,34 26,32', fill: 'primary' },
      { kind: 'circle', cx: 32, cy: 32, r: 3.5, fill: 'secondary' },
    ],
  },
  {
    id: 'flame-spirit',
    label: 'Flame Spirit',
    summary: 'Twin-tongue streak flame for unbroken consistency.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'path', d: 'M34 9 C38 20 48 25 48 37 C48 47 41 54 32 54 C23 54 16 47 16 37 C16 28 22 23 26 17 C27 23 30 25 31 25 C30 18 32 13 34 9 Z', fill: 'primary' },
      { kind: 'path', d: 'M32 30 C36 35 39 38 39 43 C39 47 36 50 32 50 C28 50 25 47 25 43 C25 38 29 35 32 30 Z', fill: 'secondary' },
    ],
  },
  {
    id: 'shoe-wings',
    label: 'Shoe Wings',
    summary: 'Winged cadence emblem for road and track strides.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'path', d: 'M14 44 L48 44 C51 44 53 41 51 38 L42 33 L35 24 L25 28 L20 35 L13 37 C11 38 11 44 14 44 Z', fill: 'primary' },
      { kind: 'path', d: 'M24 26 L12 16 L18 26 L10 23 L19 31', fill: 'none', stroke: 'secondary', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' },
    ],
  },
  {
    id: 'stopwatch-gold',
    label: 'Stopwatch Gold',
    summary: 'Precision chronometer dial calibrated for race pace.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'rect', x: 27, y: 10, width: 10, height: 5, rx: 1.5, fill: 'secondary' },
      { kind: 'circle', cx: 32, cy: 36, r: 18, fill: 'none', stroke: 'primary', strokeWidth: 4 },
      { kind: 'line', x1: 32, y1: 36, x2: 32, y2: 24, stroke: 'secondary', strokeWidth: 3, strokeLinecap: 'round' },
      { kind: 'line', x1: 32, y1: 36, x2: 41, y2: 40, stroke: 'primary', strokeWidth: 3, strokeLinecap: 'round' },
      { kind: 'circle', cx: 32, cy: 36, r: 3, fill: 'secondary' },
    ],
  },
  {
    id: 'island-archipelago',
    label: 'Island Archipelago',
    summary: 'Three-star silhouette honoring Luzon, Visayas, and Mindanao.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'path', d: 'M22 14 L30 18 L28 29 L20 26 Z', fill: 'primary' },
      { kind: 'path', d: 'M27 32 L38 30 L36 39 L26 38 Z', fill: 'secondary' },
      { kind: 'path', d: 'M34 42 L48 41 L46 53 L31 50 Z', fill: 'primary' },
      { kind: 'circle', cx: 18, cy: 19, r: 2.5, fill: 'secondary' },
      { kind: 'circle', cx: 45, cy: 27, r: 2.5, fill: 'secondary' },
      { kind: 'circle', cx: 24, cy: 48, r: 2.5, fill: 'secondary' },
    ],
  },
  {
    id: 'jeepney-star',
    label: 'Jeepney Star',
    summary: 'Festive Filipino crest inspired by jeepney ornament geometry.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'polygon', points: '32,10 38,24 53,26 42,36 45,51 32,44 19,51 22,36 11,26 26,24', fill: 'primary' },
      { kind: 'circle', cx: 32, cy: 32, r: 7, fill: 'secondary' },
    ],
  },
  {
    id: 'volcano-summit',
    label: 'Volcano Summit',
    summary: 'Symmetrical Mayon-inspired cone with glowing crater.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'polygon', points: '10,50 27,20 37,20 54,50', fill: 'primary' },
      { kind: 'path', d: 'M26 16 C28 11 36 11 38 16', fill: 'none', stroke: 'secondary', strokeWidth: 3.5, strokeLinecap: 'round' },
      { kind: 'line', x1: 27, y1: 20, x2: 37, y2: 20, stroke: 'secondary', strokeWidth: 3, strokeLinecap: 'round' },
    ],
  },
  {
    id: 'wave-runner',
    label: 'Wave Runner',
    summary: 'Twin coastal tide swells for baywalk and island runs.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'path', d: 'M10 30 C16 22 24 22 30 30 C36 38 44 38 54 28', fill: 'none', stroke: 'primary', strokeWidth: 4.5, strokeLinecap: 'round' },
      { kind: 'path', d: 'M10 43 C16 35 24 35 30 43 C36 51 44 51 54 41', fill: 'none', stroke: 'secondary', strokeWidth: 4.5, strokeLinecap: 'round' },
      { kind: 'circle', cx: 46, cy: 17, r: 4, fill: 'secondary' },
    ],
  },
  {
    id: 'heart-pulse',
    label: 'Heart Pulse',
    summary: 'Cardio crest crossed by a crisp effort waveform.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'path', d: 'M32 51 L14 33 C9 28 9 19 15 15 C20 11 28 13 32 19 C36 13 44 11 49 15 C55 19 55 28 50 33 Z', fill: 'primary' },
      { kind: 'path', d: 'M17 31 H25 L29 22 L35 39 L39 31 H47', fill: 'none', stroke: 'secondary', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' },
    ],
  },
  {
    id: 'shield-vanguard',
    label: 'Shield Vanguard',
    summary: 'Protective starter shield with diagonal race stripe.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'path', d: 'M16 14 L32 10 L48 14 V31 C48 42 41 50 32 54 C23 50 16 42 16 31 Z', fill: 'primary' },
      { kind: 'path', d: 'M24 32 L30 38 L42 24', fill: 'none', stroke: 'secondary', strokeWidth: 4, strokeLinecap: 'round', strokeLinejoin: 'round' },
    ],
  },
  {
    id: 'flag-finish',
    label: 'Flag Finish',
    summary: 'Finish chute pennant raised beside a vertical pole.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'line', x1: 18, y1: 12, x2: 18, y2: 53, stroke: 'secondary', strokeWidth: 4, strokeLinecap: 'round' },
      { kind: 'polygon', points: '20,14 50,21 20,31', fill: 'primary' },
      { kind: 'rect', x: 25, y: 19, width: 6, height: 6, fill: 'secondary' },
    ],
  },
  {
    id: 'moon-night',
    label: 'Moon Night',
    summary: 'Crescent moon and beacon stars for late-evening runners.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'path', d: 'M39 14 C27 15 19 25 20 37 C21 46 29 52 39 51 C30 48 26 39 28 30 C30 22 34 17 39 14 Z', fill: 'primary' },
      { kind: 'polygon', points: '44,18 46,23 51,23 47,26 48,31 44,28 40,31 41,26 37,23 42,23', fill: 'secondary' },
    ],
  },
  {
    id: 'diamond-alamat',
    label: 'Diamond Alamat',
    summary: 'Faceted championship gem for Alamat-tier legends.',
    viewBox: '0 0 64 64',
    primitives: [
      { kind: 'polygon', points: '20,14 44,14 54,27 32,52 10,27', fill: 'primary' },
      { kind: 'polygon', points: '20,14 32,27 44,14', fill: 'secondary', opacity: 0.9 },
      { kind: 'line', x1: 10, y1: 27, x2: 54, y2: 27, stroke: 'secondary', strokeWidth: 2.5 },
      { kind: 'line', x1: 32, y1: 27, x2: 32, y2: 52, stroke: 'secondary', strokeWidth: 2.5 },
    ],
  },
] as const;

const EMBLEM_BY_ID = new Map<BadgeEmblemId, BadgeEmblemPreset>(
  BADGE_EMBLEM_PRESETS.map((preset) => [preset.id, preset]),
);

const RANK_THRESHOLDS: ReadonlyArray<{ minLevel: number; title: AthleteRankTitle }> = [
  { minLevel: 25, title: 'Alamat' },
  { minLevel: 15, title: 'Ultra Strider' },
  { minLevel: 10, title: 'Marathoner' },
  { minLevel: 6, title: 'Trail Blazer' },
  { minLevel: 3, title: 'Road Runner' },
  { minLevel: 1, title: 'Pacer' },
];

export function getBadgeEmblemPreset(id: string | undefined): BadgeEmblemPreset {
  if (id && EMBLEM_BY_ID.has(id as BadgeEmblemId)) {
    return EMBLEM_BY_ID.get(id as BadgeEmblemId)!;
  }
  return BADGE_EMBLEM_PRESETS[0];
}

export function sanitizeHexColor(input: string | undefined | null, fallback = '#FF3B30'): string {
  const rawFallback = typeof fallback === 'string' ? fallback.trim() : '';
  const safeFallback = /^#[0-9a-fA-F]{6}$/.test(rawFallback)
    ? rawFallback.toUpperCase()
    : '#FF3B30';
  const trimmed = typeof input === 'string' ? input.trim() : '';
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed.split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return safeFallback;
}

export function xpForLevel(level: number): number {
  if (typeof level !== 'number' || !Number.isFinite(level) || level <= 1) return 0;
  const wholeLevel = Math.floor(level);
  return 50 * (wholeLevel - 1) * wholeLevel;
}

export function computeLevelFromXp(totalXp: number): LevelProgressSummary {
  const safeXp =
    typeof totalXp === 'number' && Number.isFinite(totalXp) && totalXp > 0
      ? Math.floor(totalXp)
      : 0;

  let low = 1;
  let high = 1;
  while (xpForLevel(high) <= safeXp) {
    low = high;
    high *= 2;
  }
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (xpForLevel(mid) <= safeXp) low = mid;
    else high = mid;
  }

  let rankTitle: AthleteRankTitle = 'Pacer';
  for (const tier of RANK_THRESHOLDS) {
    if (low >= tier.minLevel) {
      rankTitle = tier.title;
      break;
    }
  }

  return {
    totalXp: safeXp,
    level: low,
    currentLevelXp: xpForLevel(low),
    nextLevelXp: xpForLevel(low + 1),
    rankTitle,
  };
}

export function computeRunCompletionXp(
  runSummary: Pick<RecordedRunSummary, 'distanceM' | 'elevationGainM' | 'verificationStatus'> | null | undefined,
): number {
  if (!runSummary || runSummary.verificationStatus !== 'verified') return 0;
  const distanceM =
    typeof runSummary.distanceM === 'number' &&
    Number.isFinite(runSummary.distanceM) &&
    runSummary.distanceM > 0
      ? runSummary.distanceM
      : 0;
  const elevationGainM =
    typeof runSummary.elevationGainM === 'number' &&
    Number.isFinite(runSummary.elevationGainM) &&
    runSummary.elevationGainM > 0
      ? runSummary.elevationGainM
      : 0;
  const distanceXp = Math.round((distanceM / 1000) * 10);
  const elevationXp = Math.floor(elevationGainM / 10);
  return Math.min(1500, Math.max(15, distanceXp + elevationXp));
}

function pad2(num: number): string {
  const safe = typeof num === 'number' && Number.isFinite(num) ? Math.floor(num) : 0;
  return String(Math.max(0, Math.min(23, safe))).padStart(2, '0');
}

export function formatBadgeRuleSummary(rule: BadgeRuleConfig): string {
  const t = typeof rule.threshold === 'number' && Number.isFinite(rule.threshold) ? rule.threshold : 1;
  switch (rule.type) {
    case 'welcome':
      return 'Join RacePulsePH as an active runner';
    case 'profile_complete':
      return 'Complete your athlete profile and handle';
    case 'race_joined':
      return rule.raceId
        ? `Register for event ${rule.raceId}`
        : `Join ${t} official ${t === 1 ? 'race' : 'races'}`;
    case 'race_finished':
      return rule.raceId
        ? `Finish official event ${rule.raceId}`
        : `Finish ${t} finalized ${t === 1 ? 'race' : 'races'}`;
    case 'run_count':
      return `Complete ${t} verified ${t === 1 ? 'run' : 'runs'}`;
    case 'run_single_distance_km':
      return `Run ${t} km in a single verified session`;
    case 'run_total_distance_km':
      return `Log ${t.toLocaleString('en-US')} km total verified distance`;
    case 'run_total_elevation_m':
      return `Climb ${t.toLocaleString('en-US')} m total verified elevation`;
    case 'run_time_window': {
      const start = pad2(rule.startHourPht ?? 0);
      const end = pad2(rule.endHourPht ?? 23);
      return `Start ${t} verified ${t === 1 ? 'run' : 'runs'} between ${start}:00 and ${end}:59 PHT`;
    }
    case 'regions_explored':
      if (Array.isArray(rule.targetRegions) && rule.targetRegions.length > 0) {
        return `Explore ${t} of ${rule.targetRegions.join(', ')}`;
      }
      return `Explore ${t} Philippine ${t === 1 ? 'region' : 'regions'}`;
    case 'club_joined':
      return `Join ${t} running ${t === 1 ? 'club' : 'clubs'}`;
    case 'friends_count':
      return `Connect with ${t} running ${t === 1 ? 'friend' : 'friends'}`;
    case 'social_posts_count':
      return `Share ${t} community ${t === 1 ? 'post' : 'posts'}`;
    case 'kudos_received':
      return `Receive ${t.toLocaleString('en-US')} community kudos`;
    case 'run_streak_weeks':
      return `Hold a ${t}-week PHT run streak`;
    case 'inbox_streak_days':
      return `Hold a ${t}-day friend chat streak`;
    case 'manual_grant':
      return 'Awarded manually by RacePulsePH stewards';
  }
}

function lookupBadge(
  badgesById: ReadonlyMap<string, BadgeDefinition> | Readonly<Record<string, BadgeDefinition>>,
  badgeId: string,
): BadgeDefinition | undefined {
  if (badgesById instanceof Map) return badgesById.get(badgeId);
  const record = badgesById as Readonly<Record<string, BadgeDefinition>>;
  return Object.prototype.hasOwnProperty.call(record, badgeId) ? record[badgeId] : undefined;
}

export function selectNextToastBadge(
  awards: readonly UserBadgeAward[],
  badgesById: ReadonlyMap<string, BadgeDefinition> | Readonly<Record<string, BadgeDefinition>>,
): { award: UserBadgeAward; badge: BadgeDefinition } | null {
  const candidates: Array<{
    award: UserBadgeAward;
    badge: BadgeDefinition;
    tierOrder: number;
    xp: number;
    awardedMs: number;
  }> = [];

  for (const award of awards) {
    if (!award || award.seenByUser) continue;
    const badge = lookupBadge(badgesById, award.badgeId);
    if (!badge || badge.status === 'archived') continue;
    const tierOrder = BADGE_TIER_META[badge.tier]?.rankOrder ?? 0;
    const xp = Number.isFinite(badge.xpReward) ? badge.xpReward : award.xpAwarded;
    const parsedMs = Date.parse(award.earnedAt);
    candidates.push({
      award,
      badge,
      tierOrder,
      xp,
      awardedMs: Number.isFinite(parsedMs) ? parsedMs : 0,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.tierOrder !== a.tierOrder) return b.tierOrder - a.tierOrder;
    if (b.xp !== a.xp) return b.xp - a.xp;
    if (b.awardedMs !== a.awardedMs) return b.awardedMs - a.awardedMs;
    if (a.badge.sortOrder !== b.badge.sortOrder) return a.badge.sortOrder - b.badge.sortOrder;
    return a.badge.badgeId.localeCompare(b.badge.badgeId);
  });

  return { award: candidates[0].award, badge: candidates[0].badge };
}

export interface LevelXpWindow {
  xpIntoLevel: number;
  xpForNextLevel: number;
  percent: number;
}

export function computeLevelXpWindow(
  progression: Pick<AthleteProgression, 'totalXp' | 'currentLevelXp' | 'nextLevelXp'>,
): LevelXpWindow {
  const floor =
    typeof progression.currentLevelXp === 'number' &&
    Number.isFinite(progression.currentLevelXp) &&
    progression.currentLevelXp > 0
      ? Math.floor(progression.currentLevelXp)
      : 0;
  const ceil =
    typeof progression.nextLevelXp === 'number' && Number.isFinite(progression.nextLevelXp)
      ? Math.floor(progression.nextLevelXp)
      : 0;
  if (ceil <= floor) {
    return { xpIntoLevel: 0, xpForNextLevel: 0, percent: 0 };
  }
  const span = ceil - floor;
  const total =
    typeof progression.totalXp === 'number' && Number.isFinite(progression.totalXp)
      ? Math.floor(progression.totalXp)
      : 0;
  const intoLevel = Math.max(0, total - floor);
  const percent = Math.max(0, Math.min(100, Math.floor((intoLevel * 100) / span)));
  return {
    xpIntoLevel: intoLevel,
    xpForNextLevel: span,
    percent,
  };
}

export function computeXpProgressPercent(
  progression: Pick<AthleteProgression, 'totalXp' | 'currentLevelXp' | 'nextLevelXp'>,
): number {
  return computeLevelXpWindow(progression).percent;
}

export function formatAchievementToastAnnouncement(
  badgeName: string,
  xpAwarded: number,
  hasAction: boolean,
): string {
  const name = (badgeName || 'Achievement').trim() || 'Achievement';
  const safeXp = Number.isFinite(xpAwarded) && xpAwarded > 0 ? Math.floor(xpAwarded) : 0;
  return `${name} unlocked. +${safeXp} XP.${hasAction ? ' Actions available.' : ''}`;
}
