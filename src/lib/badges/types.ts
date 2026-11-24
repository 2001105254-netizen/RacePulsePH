export type BadgeTier =
  | 'common'
  | 'rare'
  | 'special'
  | 'epic'
  | 'legendary'
  | 'alamat';

export type BadgeCategory =
  | 'onboarding'
  | 'distance'
  | 'elevation'
  | 'races'
  | 'exploration'
  | 'community'
  | 'streaks'
  | 'special';

export type BadgeBorderStyle =
  | 'solid-ring'
  | 'double-crest'
  | 'laurel-wreath'
  | 'hex-tactical'
  | 'sunburst-ph'
  | 'ribbon-medal'
  | 'diamond-cut'
  | 'cyber-bezel'
  | 'alamat-gold';

export type BadgeAnimationEffect =
  | 'none'
  | 'shimmer-sweep'
  | 'gentle-float'
  | 'pulse-glow'
  | 'prism-tilt'
  | 'sparkle-orbit'
  | 'flame-aura';

export type BadgeEmblemId =
  | 'sunrise-burst'
  | 'mountain-peak'
  | 'lightning-bolt'
  | 'trophy-crest'
  | 'laurel-crown'
  | 'compass-rose'
  | 'flame-spirit'
  | 'shoe-wings'
  | 'stopwatch-gold'
  | 'island-archipelago'
  | 'jeepney-star'
  | 'volcano-summit'
  | 'wave-runner'
  | 'heart-pulse'
  | 'shield-vanguard'
  | 'flag-finish'
  | 'moon-night'
  | 'diamond-alamat';

export type BadgeRuleType =
  | 'welcome'
  | 'profile_complete'
  | 'race_joined'
  | 'race_finished'
  | 'run_count'
  | 'run_single_distance_km'
  | 'run_total_distance_km'
  | 'run_total_elevation_m'
  | 'run_time_window'
  | 'regions_explored'
  | 'club_joined'
  | 'friends_count'
  | 'social_posts_count'
  | 'kudos_received'
  | 'run_streak_weeks'
  | 'inbox_streak_days'
  | 'manual_grant';

export type BadgeArtworkType = 'emblem' | 'upload';
export type BadgeStatus = 'active' | 'archived';
export type BadgeAwardSource = 'auto' | 'manual' | 'retroactive' | 'run';
export type XpEventSourceType = 'run' | 'badge';
export type AthleteRankTitle =
  | 'Pacer'
  | 'Road Runner'
  | 'Trail Blazer'
  | 'Marathoner'
  | 'Ultra Strider'
  | 'Alamat';

export interface BadgeRuleConfig {
  type: BadgeRuleType;
  threshold?: number;
  raceId?: string;
  startHourPht?: number;
  endHourPht?: number;
  targetRegions?: string[];
}

export interface BadgeDefinition {
  badgeId: string;
  name: string;
  description: string;
  tier: BadgeTier;
  customTierLabel?: string;
  category: BadgeCategory;
  artworkType: BadgeArtworkType;
  emblemId?: BadgeEmblemId | '';
  artworkUrl: string;
  artworkStoragePath?: string;
  borderStyle: BadgeBorderStyle;
  primaryColor: string;
  secondaryColor: string;
  animationEffect: BadgeAnimationEffect;
  xpReward: number;
  rule: BadgeRuleConfig;
  activeFrom?: string | null;
  activeUntil?: string | null;
  hiddenUntilEarned: boolean;
  status: BadgeStatus;
  sortOrder: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface UserBadgeAward {
  id: string;
  uid: string;
  badgeId: string;
  earnedAt: string;
  seenByUser: boolean;
  source: BadgeAwardSource;
  xpAwarded: number;
  grantedBy?: string;
  note?: string;
  runId?: string;
  badgeName?: string;
  tier?: BadgeTier;
  category?: BadgeCategory;
}

export interface XpEventRecord {
  id: string;
  uid: string;
  source: XpEventSourceType;
  refId: string;
  xp: number;
  createdAt: string;
  label?: string;
}

export interface LevelProgressSummary {
  totalXp: number;
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  rankTitle: AthleteRankTitle;
}

export interface AthleteProgression extends LevelProgressSummary {
  uid: string;
  badgesCount: number;
  runStreakWeeks: number;
  runStreakGraceRemaining: number;
  inboxStreakDays?: number;
  updatedAt: string;
}

export type SvgColorToken = 'primary' | 'secondary' | 'none' | 'currentColor';

export type SvgPrimitive =
  | {
      kind: 'path';
      d: string;
      fill?: SvgColorToken;
      stroke?: SvgColorToken;
      strokeWidth?: number;
      strokeLinecap?: 'round' | 'butt' | 'square';
      strokeLinejoin?: 'round' | 'miter' | 'bevel';
      opacity?: number;
    }
  | {
      kind: 'circle';
      cx: number;
      cy: number;
      r: number;
      fill?: SvgColorToken;
      stroke?: SvgColorToken;
      strokeWidth?: number;
      opacity?: number;
    }
  | {
      kind: 'polygon';
      points: string;
      fill?: SvgColorToken;
      stroke?: SvgColorToken;
      strokeWidth?: number;
      strokeLinejoin?: 'round' | 'miter' | 'bevel';
      opacity?: number;
    }
  | {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      rx?: number;
      fill?: SvgColorToken;
      stroke?: SvgColorToken;
      strokeWidth?: number;
      opacity?: number;
    }
  | {
      kind: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke?: SvgColorToken;
      strokeWidth?: number;
      strokeLinecap?: 'round' | 'butt' | 'square';
      opacity?: number;
    };

export interface BadgeEmblemPreset {
  id: BadgeEmblemId;
  label: string;
  summary: string;
  viewBox: string;
  primitives: readonly SvgPrimitive[];
}
