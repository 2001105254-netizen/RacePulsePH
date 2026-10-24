import { Race, RaceBibLayout, RaceBibTemplate, RunnerProfile } from '../types';

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

// Prefer the template assigned to the runner's own distance. Existing races
// retain their original single-template behaviour as a safe fallback.
export function resolveRaceBibTemplate(race: Race, distance: string): ResolvedRaceBibTemplate | null {
  const distanceTemplate: RaceBibTemplate | undefined = race.raceBibTemplatesByDistance?.[distance];
  const image = distanceTemplate?.image || race.raceBibTemplateImage;
  if (!image) return null;

  return {
    image,
    layout: distanceTemplate?.layout || race.raceBibLayout || defaultLayout,
  };
}

export function hasRaceBibTemplate(race: Race): boolean {
  return Boolean(race.raceBibTemplateImage || Object.values(race.raceBibTemplatesByDistance || {}).some((template) => template?.image));
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
