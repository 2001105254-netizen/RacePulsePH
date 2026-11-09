import { Race, RaceBibLayout, RaceBibTemplate, RaceEntryCategory, RunnerProfile } from '../types';

const defaultLayout: RaceBibLayout = {
  bibNumberX: 50,
  bibNumberY: 48,
  runnerNameX: 50,
  runnerNameY: 70,
};

export interface ResolvedRaceBibTemplate {
  image: string;
  layout: RaceBibLayout;
}

// Entry-category artwork is the most specific option, followed by distance,
// then the original default template. Existing races remain compatible.
export function resolveRaceBibTemplate(race: Race, distance: string, entryCategory: RaceEntryCategory = 'solo'): ResolvedRaceBibTemplate | null {
  const entryCategoryTemplate: RaceBibTemplate | undefined = race.raceBibTemplatesByEntryCategory?.[entryCategory];
  const distanceTemplate: RaceBibTemplate | undefined = race.raceBibTemplatesByDistance?.[distance];
  const selectedTemplate = entryCategoryTemplate || distanceTemplate;
  const image = selectedTemplate?.image || race.raceBibTemplateImage;
  if (!image) return null;

  return {
    image,
    layout: selectedTemplate?.layout || race.raceBibLayout || defaultLayout,
  };
}

export function hasRaceBibTemplate(race: Race): boolean {
  return Boolean(
    race.raceBibTemplateImage
    || Object.values(race.raceBibTemplatesByDistance || {}).some((template) => template?.image)
    || Object.values(race.raceBibTemplatesByEntryCategory || {}).some((template) => template?.image),
  );
}

// Team entries share one bib/chip, but every team member needs to stay
// readable on that bib. Prefer the structured member list over the combined
// display name retained by older roster imports.
export function raceBibNameLines(runner: Pick<RunnerProfile, 'fullName' | 'teamMembers'>): string[] {
  const members = (runner.teamMembers || [])
    .map((member) => member.trim())
    .filter((member, index, list) => Boolean(member) && list.indexOf(member) === index);
  return members.length > 1 ? members : [runner.fullName.trim()];
}
