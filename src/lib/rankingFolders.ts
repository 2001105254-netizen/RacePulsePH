import { RunnerResult } from '../types';
import { entryCategoryLabels, runnerEntryCategory } from './raceEntry';

export interface RankingSubcategory {
  id: string;
  label: string;
  ranking: 'overall' | 'age';
  results: RunnerResult[];
}

export interface RankingFolder {
  distance: string;
  finisherCount: number;
  subcategories: RankingSubcategory[];
}

export function groupRankingFolders(results: RunnerResult[], search = ''): RankingFolder[] {
  const term = search.trim().toLowerCase().replace(/^#/, '');
  const folders = new Map<string, RankingFolder>();
  for (const result of results) {
    if (result.rank === undefined) continue;
    const runner = result.runnerProfile;
    if (term) {
      const searchableValues = [result.bibNumber, `Bib ${result.bibNumber}`];
      if (runner && !runner.isFreeSlot) {
        searchableValues.push(runner.fullName, ...(runner.teamMembers || []));
      }
      if (!searchableValues.some((value) => value.toLowerCase().includes(term))) continue;
    }
    const distance = runner?.distance || 'Unknown';
    const entry = runnerEntryCategory(runner);
    const divisionId = `${entry}${runner?.isFreeSlot ? '-free' : ''}`;
    const divisionLabel = `${entryCategoryLabels[entry]}${runner?.isFreeSlot ? ' Free Slots' : ''}`;
    let folder = folders.get(distance);
    if (!folder) {
      folder = { distance, finisherCount: 0, subcategories: [] };
      folders.set(distance, folder);
    }
    folder.finisherCount += 1;

    const addResult = (id: string, label: string, ranking: RankingSubcategory['ranking']) => {
      let category = folder.subcategories.find((item) => item.id === id);
      if (!category) {
        category = { id, label, ranking, results: [] };
        folder.subcategories.push(category);
      }
      category.results.push(result);
    };
    addResult(divisionId, `${divisionLabel} rankings`, 'overall');
    // Only use official age places; team captains and anonymous slots do not
    // qualify for the Solo age-category rankings.
    if (entry === 'solo' && !runner?.isFreeSlot && result.categoryRank !== undefined && result.categoryLabel) {
      addResult(`${divisionId}-age-${result.categoryLabel}`, `${divisionLabel} · ${result.categoryLabel}`, 'age');
    }
  }

  for (const folder of folders.values()) {
    folder.subcategories.sort((a, b) => {
      if (a.ranking !== b.ranking) return a.ranking === 'overall' ? -1 : 1;
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });
    for (const category of folder.subcategories) {
      const rank = (result: RunnerResult) => category.ranking === 'age'
        ? result.categoryRank! : (result.overallRank ?? result.rank!);
      category.results.sort((a, b) => rank(a) - rank(b) || a.bibNumber.localeCompare(b.bibNumber));
    }
  }
  return [...folders.values()].sort((a, b) => a.distance.localeCompare(b.distance, undefined, { numeric: true }));
}
