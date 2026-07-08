import { AgeCategory, Gender, RunnerProfile } from '../types';

export function findAgeCategory(ageCategories: AgeCategory[], gender: Gender, age: number): AgeCategory | undefined {
  return ageCategories.find((c) => c.gender === gender && age >= c.minAge && age <= c.maxAge);
}

export interface RunnerReportGroup {
  distance: string;
  categoryLabel: string;
  runners: RunnerProfile[];
}

// Buckets runners by distance, then by age category within that distance -
// exactly the shape the roster PDF renders section by section.
export function groupRunnersForReport(runners: RunnerProfile[], ageCategories: AgeCategory[]): RunnerReportGroup[] {
  const groups = new Map<string, RunnerProfile[]>();

  for (const runner of runners) {
    const category = findAgeCategory(ageCategories, runner.gender, runner.age);
    const categoryLabel = category?.label || 'Unclassified';
    const key = `${runner.distance}|||${categoryLabel}`;
    const list = groups.get(key) ?? [];
    list.push(runner);
    groups.set(key, list);
  }

  return Array.from(groups.entries())
    .map(([key, groupRunners]) => {
      const [distance, categoryLabel] = key.split('|||');
      return {
        distance,
        categoryLabel,
        runners: groupRunners.sort((a, b) => a.fullName.localeCompare(b.fullName)),
      };
    })
    .sort((a, b) => a.distance.localeCompare(b.distance) || a.categoryLabel.localeCompare(b.categoryLabel));
}
