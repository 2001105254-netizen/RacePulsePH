import { useId, useMemo, useState } from 'react';
import { Award, CalendarClock, Lock, RotateCcw, ShieldQuestion, Sparkles, X } from 'lucide-react';
import {
  BADGE_CATEGORY_META,
  BADGE_TIER_META,
  BADGE_TIERS,
  computeLevelXpWindow,
  formatBadgeRuleSummary,
} from '../../lib/badges/presets';
import type {
  AthleteProgression,
  BadgeCategory,
  BadgeDefinition,
  BadgeTier,
  UserBadgeAward,
} from '../../lib/badges/types';
import { cn } from '../../lib/utils';
import BadgeArtwork from '../badges/BadgeArtwork';
import DialogSurface from '../ui/DialogSurface';
import { Select, type SelectOption } from '../ui/Select';
import { RunnerQueueSkeleton } from './RunnerMobilePrimitives';

type BadgeStatusFilter = 'all' | 'earned' | 'locked';

export interface RunnerBadgesPanelProps {
  badges: BadgeDefinition[];
  badgesLoaded: boolean;
  badgesError: string | null;
  userBadges: UserBadgeAward[];
  userBadgesLoaded: boolean;
  athleteProgression: AthleteProgression;
}

interface TrophyCaseEntry {
  badge: BadgeDefinition;
  award: UserBadgeAward | null;
  isMystery: boolean;
}

export function buildAwardFallbackBadge(award: UserBadgeAward): BadgeDefinition {
  const safeTier: BadgeTier =
    award.tier && BADGE_TIER_META[award.tier] ? award.tier : 'common';
  const safeCategory: BadgeCategory =
    award.category && BADGE_CATEGORY_META[award.category] ? award.category : 'special';
  const tierDefaults = BADGE_TIER_META[safeTier];
  return {
    badgeId: award.badgeId,
    name: award.badgeName?.trim() || award.badgeId,
    description: 'Earned milestone preserved on your RacePulsePH athlete record.',
    tier: safeTier,
    category: safeCategory,
    artworkType: 'emblem',
    emblemId: 'trophy-crest',
    artworkUrl: '',
    borderStyle: 'solid-ring',
    primaryColor: tierDefaults.defaultPrimary,
    secondaryColor: tierDefaults.defaultSecondary,
    animationEffect: 'none',
    xpReward: award.xpAwarded,
    rule: { type: 'manual_grant' },
    hiddenUntilEarned: false,
    status: 'archived',
    sortOrder: 9999,
    createdAt: award.earnedAt,
    createdBy: award.grantedBy || 'system',
    updatedAt: award.earnedAt,
    updatedBy: award.grantedBy || 'system',
  };
}

function formatEarnedAtPht(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'Recorded on RacePulsePH';
  try {
    const formatted = new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ms));
    return `${formatted} PHT`;
  } catch {
    return new Date(ms).toISOString();
  }
}

export default function RunnerBadgesPanel({
  badges,
  badgesLoaded,
  badgesError,
  userBadges,
  userBadgesLoaded,
  athleteProgression,
}: RunnerBadgesPanelProps) {
  const baseId = useId();
  const modalTitleId = `${baseId}-modal-title`;
  const modalDescId = `${baseId}-modal-desc`;

  const [statusFilter, setStatusFilter] = useState<BadgeStatusFilter>('all');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null);

  const xpWindow = useMemo(
    () => computeLevelXpWindow(athleteProgression),
    [athleteProgression],
  );

  const trophyEntries = useMemo<TrophyCaseEntry[]>(() => {
    const awardsByBadgeId = new Map<string, UserBadgeAward>();
    for (const award of userBadges) {
      if (award?.badgeId && !awardsByBadgeId.has(award.badgeId)) {
        awardsByBadgeId.set(award.badgeId, award);
      }
    }

    const entries: TrophyCaseEntry[] = [];
    const seenIds = new Set<string>();

    for (const badge of badges) {
      if (!badge?.badgeId || seenIds.has(badge.badgeId)) continue;
      seenIds.add(badge.badgeId);
      const award = awardsByBadgeId.get(badge.badgeId) ?? null;
      entries.push({
        badge,
        award,
        isMystery: Boolean(!award && badge.hiddenUntilEarned),
      });
    }

    for (const award of userBadges) {
      if (!award?.badgeId || seenIds.has(award.badgeId)) continue;
      seenIds.add(award.badgeId);
      entries.push({
        badge: buildAwardFallbackBadge(award),
        award,
        isMystery: false,
      });
    }

    entries.sort((a, b) => {
      const aEarned = a.award ? 0 : 1;
      const bEarned = b.award ? 0 : 1;
      if (aEarned !== bEarned) return aEarned - bEarned;
      const sortDiff = (a.badge.sortOrder ?? 0) - (b.badge.sortOrder ?? 0);
      if (sortDiff !== 0) return sortDiff;
      return a.badge.badgeId.localeCompare(b.badge.badgeId);
    });

    return entries;
  }, [badges, userBadges]);

  const earnedCount = useMemo(
    () => trophyEntries.filter((entry) => Boolean(entry.award)).length,
    [trophyEntries],
  );

  const tierOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'all', label: 'All Tiers' },
      ...BADGE_TIERS.map((tier) => ({
        value: tier,
        label: BADGE_TIER_META[tier].label,
        accentDot: BADGE_TIER_META[tier].defaultPrimary,
      })),
    ],
    [],
  );

  const filteredEntries = useMemo(() => {
    return trophyEntries.filter((entry) => {
      if (statusFilter === 'earned' && !entry.award) return false;
      if (statusFilter === 'locked' && entry.award) return false;
      if (tierFilter !== 'all' && entry.badge.tier !== tierFilter) return false;
      return true;
    });
  }, [trophyEntries, statusFilter, tierFilter]);

  const selectedEntry = useMemo(
    () =>
      selectedBadgeId
        ? trophyEntries.find((entry) => entry.badge.badgeId === selectedBadgeId) ?? null
        : null,
    [trophyEntries, selectedBadgeId],
  );

  const isLoading = !badgesLoaded || !userBadgesLoaded;
  const hasActiveFilters = statusFilter !== 'all' || tierFilter !== 'all';

  return (
    <div className="space-y-4">
      <section
        aria-label="Athlete XP and level progression"
        className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 sm:p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)] leading-tight">
              Level {athleteProgression.level}: {athleteProgression.rankTitle}
            </h2>
            <p className="text-xs font-normal text-[var(--text-secondary)] mt-0.5 tabular-nums">
              {xpWindow.xpIntoLevel.toLocaleString('en-US')} /{' '}
              {xpWindow.xpForNextLevel.toLocaleString('en-US')} XP to Level{' '}
              {athleteProgression.level + 1}
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-950/70 dark:text-emerald-200 text-xs font-mono font-semibold tabular-nums">
            {athleteProgression.totalXp.toLocaleString('en-US')} Total XP
          </span>
        </div>

        <div
          role="progressbar"
          aria-label="Level XP progress"
          aria-valuenow={xpWindow.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2.5 w-full rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] overflow-hidden"
        >
          <div
            className="h-full rounded-full bg-red-600 dark:bg-red-500 transition-all duration-200"
            style={{ width: `${xpWindow.percent}%` }}
          />
        </div>

        <div className="grid grid-cols-3 divide-x divide-[var(--border-default)] rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] py-2">
          <div className="px-2 sm:px-3 text-center">
            <p className="text-xs font-normal text-[var(--text-secondary)]">Earned</p>
            <p className="text-sm font-mono font-semibold tabular-nums text-[var(--text-primary)]">
              {earnedCount}/{trophyEntries.length}
            </p>
          </div>
          <div className="px-2 sm:px-3 text-center">
            <p className="text-xs font-normal text-[var(--text-secondary)]">Run Streak</p>
            <p className="text-sm font-mono font-semibold tabular-nums text-[var(--text-primary)]">
              {athleteProgression.runStreakWeeks}w
            </p>
          </div>
          <div className="px-2 sm:px-3 text-center">
            <p className="text-xs font-normal text-[var(--text-secondary)]">Grace Left</p>
            <p className="text-sm font-mono font-semibold tabular-nums text-[var(--text-primary)]">
              {athleteProgression.runStreakGraceRemaining}
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
        <div
          role="group"
          aria-label="Filter badges by unlock status"
          className="inline-grid grid-cols-3 gap-1 p-1 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)]"
        >
          {(
            [
              { key: 'all', label: `All (${trophyEntries.length})` },
              { key: 'earned', label: `Earned (${earnedCount})` },
              { key: 'locked', label: `Locked (${Math.max(0, trophyEntries.length - earnedCount)})` },
            ] as const
          ).map((item) => {
            const active = statusFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => setStatusFilter(item.key)}
                className={cn(
                  'min-h-11 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap',
                  active
                    ? 'bg-red-700 hover:bg-red-600 text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]',
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="w-full sm:w-52">
          <Select
            ariaLabel="Filter badges by tier"
            value={tierFilter}
            options={tierOptions}
            onChange={setTierFilter}
            size="md"
          />
        </div>
      </div>

      {badgesError && (
        <div
          role="alert"
          className="rounded-xl border border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-400/40 dark:bg-amber-950/60 dark:text-amber-200 px-3 py-2 text-xs font-normal"
        >
          {badgesError}
        </div>
      )}

      {isLoading ? (
        <RunnerQueueSkeleton rows={4} />
      ) : filteredEntries.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5 text-center space-y-3">
          <div className="w-11 h-11 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] mx-auto flex items-center justify-center text-[var(--text-secondary)]">
            <Award className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h3 className="font-display font-semibold text-base text-[var(--text-primary)]">
              No badges match these filters
            </h3>
            <p className="text-xs font-normal text-[var(--text-secondary)]">
              {trophyEntries.length === 0
                ? 'Active RacePulsePH milestones appear here once published by race stewards.'
                : 'Try switching status or tier filters to inspect other milestones.'}
            </p>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter('all');
                setTierFilter('all');
              }}
              className="min-h-11 px-4 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reset filters</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredEntries.map((entry) => {
            const { badge, award, isMystery } = entry;
            const isEarned = Boolean(award);
            const tierMeta = BADGE_TIER_META[badge.tier];
            const tierLabel = isMystery
              ? 'Secret'
              : badge.customTierLabel?.trim() || tierMeta?.label || badge.tier;
            const titleText = isMystery ? 'Secret Milestone' : badge.name;
            const summaryText = isMystery
              ? 'Complete hidden requirements to reveal this milestone.'
              : badge.description;

            return (
              <button
                key={badge.badgeId}
                type="button"
                onClick={() => setSelectedBadgeId(badge.badgeId)}
                className={cn(
                  'min-h-11 text-left rounded-2xl border p-3.5 flex items-start gap-3 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400',
                  isEarned
                    ? 'border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)]'
                    : 'border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)]',
                )}
              >
                <div className="shrink-0">
                  <BadgeArtwork badge={badge} size="md" locked={!isEarned} mystery={isMystery} />
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {isEarned ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-950/70 dark:text-emerald-200 text-xs font-semibold">
                        <Sparkles className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>Earned</span>
                      </span>
                    ) : isMystery ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-zinc-300 bg-zinc-200 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 text-xs font-semibold">
                        <ShieldQuestion className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>Secret</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 text-xs font-semibold">
                        <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>Locked</span>
                      </span>
                    )}

                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)]">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{
                          backgroundColor: isMystery ? '#71717A' : badge.primaryColor,
                        }}
                        aria-hidden="true"
                      />
                      <span>{tierLabel}</span>
                    </span>
                  </div>

                  <p className="font-display font-semibold text-sm text-[var(--text-primary)] leading-snug truncate">
                    {titleText}
                  </p>

                  <p className="text-xs font-normal text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
                    {summaryText}
                  </p>

                  <p className="text-xs font-mono font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">
                    +{award ? award.xpAwarded : badge.xpReward} XP
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedEntry && (
        <DialogSurface
          variant="sheet"
          dismissOnBackdropClick
          maxWidthCss="32rem"
          titleId={modalTitleId}
          descriptionId={modalDescId}
          onRequestClose={() => setSelectedBadgeId(null)}
        >
          <div className="p-4 sm:p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3
                id={modalTitleId}
                className="font-display font-semibold text-lg text-[var(--text-primary)] leading-snug"
              >
                {selectedEntry.isMystery ? 'Secret Milestone' : selectedEntry.badge.name}
              </h3>

              <button
                type="button"
                aria-label="Close badge details"
                onClick={() => setSelectedBadgeId(null)}
                className="shrink-0 min-h-11 min-w-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 flex flex-col items-center text-center gap-3">
              <BadgeArtwork
                badge={selectedEntry.badge}
                size="xl"
                locked={!selectedEntry.award}
                mystery={selectedEntry.isMystery}
              />

              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)]">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      backgroundColor: selectedEntry.isMystery
                        ? '#71717A'
                        : selectedEntry.badge.primaryColor,
                    }}
                    aria-hidden="true"
                  />
                  <span>
                    {selectedEntry.isMystery
                      ? 'Secret'
                      : selectedEntry.badge.customTierLabel?.trim() ||
                        BADGE_TIER_META[selectedEntry.badge.tier]?.label ||
                        selectedEntry.badge.tier}
                  </span>
                </span>

                <span className="px-2.5 py-1 rounded-full border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-secondary)]">
                  {selectedEntry.isMystery
                    ? 'Hidden Category'
                    : BADGE_CATEGORY_META[selectedEntry.badge.category]?.label ||
                      selectedEntry.badge.category}
                </span>

                <span className="px-2.5 py-1 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-950/70 dark:text-emerald-200 text-xs font-mono font-semibold tabular-nums">
                  +{selectedEntry.award ? selectedEntry.award.xpAwarded : selectedEntry.badge.xpReward} XP
                </span>
              </div>

              <p id={modalDescId} className="text-xs font-normal text-[var(--text-secondary)] leading-relaxed">
                {selectedEntry.isMystery
                  ? 'Complete hidden requirements on courses or community events to unlock this secret badge.'
                  : selectedEntry.badge.description}
              </p>
            </div>

            {!selectedEntry.isMystery && (
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 space-y-1">
                <p className="text-xs font-semibold text-[var(--text-secondary)]">Unlock requirement</p>
                <p className="text-sm font-normal text-[var(--text-primary)]">
                  {formatBadgeRuleSummary(selectedEntry.badge.rule)}
                </p>
              </div>
            )}

            {selectedEntry.award && (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50/70 dark:border-emerald-400/40 dark:bg-emerald-950/40 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                  <CalendarClock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Earned on {formatEarnedAtPht(selectedEntry.award.earnedAt)}</span>
                </div>
                {selectedEntry.award.note?.trim() && (
                  <p className="text-xs font-normal text-emerald-900 dark:text-emerald-200">
                    Steward note: {selectedEntry.award.note.trim()}
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedBadgeId(null)}
                className="min-h-11 w-full sm:w-auto px-5 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </DialogSurface>
      )}
    </div>
  );
}
