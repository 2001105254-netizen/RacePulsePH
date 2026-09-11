import { Race } from '../types';

// RacePulsePH operates in Philippine time. A race remains open throughout its
// listed closing date unless an organizer explicitly closes it earlier.
export function philippineDate(today = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(today);
}

export function isRaceRegistrationOpen(race: Race, today = philippineDate()): boolean {
  if (race.registrationOpen === false) return false;
  return (race.registrationCloseDate || race.date) >= today;
}
