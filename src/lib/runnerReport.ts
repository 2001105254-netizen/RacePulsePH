import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AgeCategory, Gender, Race, RunnerProfile } from '../types';

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

export interface DistanceGroup {
  distance: string;
  runners: RunnerProfile[];
}

// Simple distance-only bucketing for the on-screen roster (the PDF report
// further splits each of these by age category - see groupRunnersForReport).
export function groupRunnersByDistance(runners: RunnerProfile[]): DistanceGroup[] {
  const groups = new Map<string, RunnerProfile[]>();
  for (const runner of runners) {
    const list = groups.get(runner.distance) ?? [];
    list.push(runner);
    groups.set(runner.distance, list);
  }
  return Array.from(groups.entries())
    .map(([distance, groupRunners]) => ({
      distance,
      runners: groupRunners.sort((a, b) => a.bibNumber.localeCompare(b.bibNumber)),
    }))
    .sort((a, b) => a.distance.localeCompare(b.distance));
}

// Renders and downloads the runner roster PDF (grouped by distance, then age
// category). Returns false if there were no runners to report on.
export function generateRunnerRosterPdf(race: Race, runners: RunnerProfile[]): boolean {
  if (runners.length === 0) return false;

  const groups = groupRunnersForReport(runners, race.ageCategories || []);
  const pdf = new jsPDF();

  pdf.setFillColor(20, 20, 20);
  pdf.rect(0, 0, 210, 26, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(15);
  pdf.setFont('helvetica', 'bold');
  pdf.text(race.name.toUpperCase(), 14, 12);
  pdf.setFontSize(8.5);
  pdf.setTextColor(245, 158, 11);
  pdf.text(`RUNNER ROSTER BY DISTANCE & AGE CATEGORY  |  ${runners.length} TOTAL RUNNERS  |  GENERATED ${new Date().toLocaleString()}`, 14, 19);

  let cursorY = 34;
  let currentDistance = '';

  groups.forEach((group) => {
    if (cursorY > 265) {
      pdf.addPage();
      cursorY = 20;
    }
    if (group.distance !== currentDistance) {
      currentDistance = group.distance;
      pdf.setFontSize(12);
      pdf.setTextColor(220, 38, 38);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`DISTANCE: ${group.distance.toUpperCase()}`, 14, cursorY);
      cursorY += 6;
    }
    pdf.setFontSize(9.5);
    pdf.setTextColor(80, 80, 80);
    pdf.setFont('helvetica', 'bolditalic');
    pdf.text(group.categoryLabel.toUpperCase(), 14, cursorY);
    cursorY += 2;

    autoTable(pdf, {
      startY: cursorY,
      head: [['#', 'Bib', 'Runner Name', 'Gender', 'Age']],
      body: group.runners.map((r, idx) => [idx + 1, r.bibNumber, r.fullName, r.gender.toUpperCase(), r.age]),
      styles: { fontSize: 8, cellPadding: 2.5, textColor: [40, 40, 40] },
      headStyles: { fillColor: [30, 30, 35], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 248, 250] },
      margin: { left: 14, right: 14 },
    });
    cursorY = (pdf as any).lastAutoTable.finalY + 8;
  });

  const sanitizedName = race.name.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'Race';
  pdf.save(`${sanitizedName}_Runner_Roster.pdf`);
  return true;
}
