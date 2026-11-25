import type { ClubDefinition, ClubMemberRecord } from './types';

export type ClubDirectoryScope = 'all' | 'mine';

export type RunnerClubModuleTab =
  | 'overview'
  | 'leaderboard'
  | 'events'
  | 'announcements'
  | 'roster';

export interface FilterClubsOptions {
  scope: ClubDirectoryScope;
  query?: string;
}

export function filterClubsForRunner(
  clubs: readonly ClubDefinition[],
  myMemberships: readonly ClubMemberRecord[],
  options: FilterClubsOptions,
): ClubDefinition[] {
  const memberClubIds = new Set(
    myMemberships
      .filter((m) => m.status === 'active' || m.status === 'pending')
      .map((m) => m.clubId),
  );
  const term = (options.query || '').trim().toLowerCase();

  return clubs.filter((club) => {
    if (club.status === 'archived') return false;
    if (options.scope === 'mine' && !memberClubIds.has(club.clubId)) {
      return false;
    }
    if (!term) return true;
    return `${club.name} ${club.city} ${club.scheduleSummary} ${club.clubId}`
      .toLowerCase()
      .includes(term);
  });
}

export function resolveEnabledClubModules(club: ClubDefinition): RunnerClubModuleTab[] {
  const tabs: RunnerClubModuleTab[] = ['overview'];
  if (club.modules.leaderboard) tabs.push('leaderboard');
  if (club.modules.events) tabs.push('events');
  if (club.modules.announcements) tabs.push('announcements');
  tabs.push('roster');
  return tabs;
}

export function canManageClubAsRunner(
  club: Pick<ClubDefinition, 'captainUids'> | null | undefined,
  uid: string,
  canAdminManage: boolean,
): boolean {
  if (canAdminManage) return true;
  if (!club || !uid) return false;
  return Array.isArray(club.captainUids) && club.captainUids.includes(uid);
}
