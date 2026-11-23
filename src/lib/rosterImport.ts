import { MAX_ROSTER_ROWS, MAX_ROSTER_SHEETS, randomShortCode, stripUnsafeKeys } from './security';
import type { SpreadsheetSheet } from './spreadsheet';
import type { Race, RaceEntryCategory, RunnerProfile } from '../types';

export type ImportedRunner = Pick<
  RunnerProfile,
  'fullName' | 'bibNumber' | 'distance' | 'gender' | 'age' | 'ageNotProvided' | 'shirtSize' | 'entryCategory' | 'teamMembers'
> & {
  source: string;
  sourceRows: number[];
};

export interface RosterImportPreview {
  fileName: string;
  detectedSheets: string[];
  runners: ImportedRunner[];
  skipped: string[];
  combinedTeams: number;
}

function spreadsheetText(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '').trim();
}

function spreadsheetHeader(value: unknown): string {
  return spreadsheetText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function headerIndex(headers: unknown[], candidates: string[]): number {
  const normalized = headers.map(spreadsheetHeader);
  return normalized.findIndex((header) => candidates.some((candidate) => header === candidate || header.includes(candidate)));
}

export function normalizeImportBib(value: unknown): string {
  return spreadsheetText(value).replace(/^#\s*/, '').replace(/\s+/g, '').toUpperCase();
}

// Older CSV imports were interpreted as spreadsheet dates by legacy parsers. For
// example a valid physical bib `12-20-01` arrived as `12/20/01`. This helper
// is intentionally used only when locating an existing imported row so a
// re-import repairs old records without treating slash-form bibs as canonical.
export function importBibMatchKey(value: unknown): string {
  const bib = normalizeImportBib(value);
  return /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(bib) ? bib.replaceAll('/', '-') : bib;
}

function importGender(value: unknown): RunnerProfile['gender'] | null {
  const normalized = spreadsheetText(value).toLowerCase();
  if (normalized.startsWith('m')) return 'male';
  if (normalized.startsWith('f')) return 'female';
  return null;
}

function importEntryCategory(value: unknown): RaceEntryCategory {
  const category = spreadsheetText(value).toLowerCase();
  if (category.includes('group') || category.includes('team')) return 'group';
  if (category.includes('trio')) return 'trio';
  if (category.includes('duo') || category.includes('pair')) return 'duo';
  return 'solo';
}

function ageFromSpreadsheetValue(value: unknown): number | null {
  const text = spreadsheetText(value);
  const directAge = Number.parseInt(text, 10);
  if (/^\d{1,3}$/.test(text)) return directAge >= 1 && directAge <= 120 ? directAge : null;

  const birthDate = value instanceof Date ? value : new Date(text);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const birthdayThisYear = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());
  if (today < birthdayThisYear) age -= 1;
  return age >= 1 && age <= 120 ? age : null;
}

function matchImportDistance(value: unknown, race: Race): string | null {
  const source = spreadsheetText(value).toUpperCase().replace(/\s+/g, '');
  if (!source) return null;
  const exact = race.distances.find((distance) => distance.label.toUpperCase().replace(/\s+/g, '') === source);
  if (exact) return exact.label;

  const numeric = Number.parseFloat(source.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(numeric)) return null;
  const matchingKm = race.distances.find((distance) => Math.abs(distance.km - numeric) < 0.15);
  return matchingKm?.label || null;
}

export function importedRunnerUid(): string {
  const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : randomShortCode(16);
  return `import_${randomPart}`;
}

export function parseRosterSheets(
  sheets: SpreadsheetSheet[],
  fileName: string,
  race: Race,
): RosterImportPreview {
  const rowsByBib = new Map<string, ImportedRunner>();
  const detectedSheets: string[] = [];
  const skipped: string[] = [];
  let combinedTeams = 0;

  for (const entry of sheets.slice(0, MAX_ROSTER_SHEETS)) {
    const sheetName = entry.sheet;
    const rows = stripUnsafeKeys(entry.rows);
    const headers = rows[0] || [];
    const nameColumn = headerIndex(headers, ['fullname', 'runnername', 'participantname', 'name']);
    const bibColumn = headerIndex(headers, ['racebibnumber', 'bibnumber', 'racebib', 'bib']);
    const distanceColumn = headerIndex(headers, ['distance', 'racedistance', 'categorydistance']);
    const categoryColumn = headerIndex(headers, ['entrycategory', 'teamcategory', 'category']);
    const genderColumn = headerIndex(headers, ['sex', 'gender']);
    const ageColumn = headerIndex(headers, ['age']);
    const dateOfBirthColumn = headerIndex(headers, ['dateofbirth', 'birthdate', 'dob']);
    const shirtSizeColumn = headerIndex(headers, ['shirtsize', 'shirttsize', 'apparelsize', 'size']);

    // Use only prepared bib-assignment sheets with required identification columns.
    if (nameColumn < 0 || bibColumn < 0 || distanceColumn < 0) continue;
    detectedSheets.push(sheetName);

    rows.slice(1, MAX_ROSTER_ROWS + 1).forEach((row, index) => {
      const sourceRow = index + 2;
      const fullName = spreadsheetText(row[nameColumn]);
      const bibNumber = normalizeImportBib(row[bibColumn]);
      const distance = matchImportDistance(row[distanceColumn], race);
      const entryCategory = importEntryCategory(categoryColumn >= 0 ? row[categoryColumn] : '');
      const gender = importGender(genderColumn >= 0 ? row[genderColumn] : '');
      const age = ageFromSpreadsheetValue(ageColumn >= 0 ? row[ageColumn] : '')
        ?? ageFromSpreadsheetValue(dateOfBirthColumn >= 0 ? row[dateOfBirthColumn] : '');
      const shirtSize = shirtSizeColumn >= 0 ? spreadsheetText(row[shirtSizeColumn]).toUpperCase() : '';
      const genderIsRequired = entryCategory === 'solo';
      const ageIsRequired = entryCategory !== 'group';
      const ageNotProvided = age === null;

      if (!fullName && !bibNumber) return;
      if (!fullName || !bibNumber || !distance || (genderIsRequired && !gender) || (ageIsRequired && age === null)) {
        const missing = [
          !fullName && 'name',
          !bibNumber && 'bib',
          !distance && 'a matching race distance',
          genderIsRequired && !gender && 'sex/gender (Solo only)',
          ageIsRequired && age === null && 'valid age or date of birth (Group optional)',
        ].filter(Boolean).join(', ');
        skipped.push(`${sheetName} row ${sourceRow}: missing ${missing}`);
        return;
      }

      const key = `${distance}|${bibNumber}`;
      const existing = rowsByBib.get(key);
      if (existing) {
        const names = existing.fullName.split(' & ');
        if (!names.includes(fullName)) existing.fullName = `${existing.fullName} & ${fullName}`;
        existing.teamMembers = [...(existing.teamMembers || names), fullName].filter(
          (name, memberIndex, list) => list.indexOf(name) === memberIndex,
        );
        existing.sourceRows.push(sourceRow);
        combinedTeams += 1;
        return;
      }

      rowsByBib.set(key, {
        fullName,
        bibNumber,
        distance,
        entryCategory,
        gender: gender || 'male',
        age: age ?? 18,
        ageNotProvided,
        ...(entryCategory !== 'solo' ? { teamMembers: [fullName] } : {}),
        ...(shirtSize ? { shirtSize } : {}),
        source: sheetName,
        sourceRows: [sourceRow],
      });
    });
  }

  return {
    fileName,
    detectedSheets,
    runners: [...rowsByBib.values()].sort((a, b) => a.bibNumber.localeCompare(b.bibNumber, undefined, { numeric: true })),
    skipped,
    combinedTeams,
  };
}
