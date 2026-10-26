import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Race, RunnerResult } from '../types';
import { runnerDivisionLabel, runnerEntryCategory } from './raceEntry';
import { orderFemaleOverallResults } from './timing';

function runnerName(result: RunnerResult): string {
  return result.runnerProfile?.isFreeSlot ? 'FREE SLOT' : (result.runnerProfile?.fullName || `Bib ${result.bibNumber}`);
}

function appendFooter(pdf: jsPDF): void {
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setFontSize(7);
    pdf.setTextColor(115, 115, 115);
    pdf.text('RacePulsePH • Official race-day report', 14, 291);
    pdf.text(`Page ${page} of ${pages}`, 196, 291, { align: 'right' });
  }
}

// Produces one printable document containing every completed division and
// every configured age-category standing. It uses the same result/rank values
// already visible in the timing console, so the report cannot diverge from
// the live leaderboard.
export function generateRankingsReportPdf(race: Race, results: RunnerResult[], distanceFilter?: string): boolean {
  const finishers = results.filter((result) => (result.overallRank !== undefined || result.rank !== undefined)
    && (!distanceFilter || result.runnerProfile.distance === distanceFilter));
  if (finishers.length === 0) return false;

  const pdf = new jsPDF();
  const generatedAt = new Date().toLocaleString('en-PH');
  const sanitizedName = race.name.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'Race';

  const header = (title: string, subtitle: string) => {
    pdf.setFillColor(20, 20, 20);
    pdf.rect(0, 0, 210, 26, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(15);
    pdf.setTextColor(255, 255, 255);
    pdf.text(race.name.toUpperCase(), 14, 11);
    pdf.setFontSize(8.5);
    pdf.setTextColor(245, 158, 11);
    pdf.text(`${title}  |  ${subtitle}  |  GENERATED ${generatedAt}`, 14, 18);
  };

  const reportScope = distanceFilter ? `${distanceFilter.toUpperCase()} • ${finishers.length} FINISHERS` : `${finishers.length} FINISHERS`;
  header('OFFICIAL RANKINGS REPORT', reportScope);
  let cursorY = 34;

  const divisionGroups = new Map<string, RunnerResult[]>();
  for (const result of finishers) {
    const division = runnerDivisionLabel(result.runnerProfile);
    const group = divisionGroups.get(division) || [];
    group.push(result);
    divisionGroups.set(division, group);
  }

  Array.from(divisionGroups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([division, group]) => {
      if (cursorY > 250) {
        pdf.addPage();
        header('OFFICIAL RANKINGS REPORT', reportScope);
        cursorY = 34;
      }
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.setTextColor(220, 38, 38);
      pdf.text(`${division.toUpperCase()} • OVERALL STANDINGS`, 14, cursorY);
      autoTable(pdf, {
        startY: cursorY + 4,
        head: [['Rank', 'Bib', 'Runner / Team', 'Finish Time', 'Method']],
        body: group
          .sort((a, b) => (a.overallRank ?? a.rank ?? 999999) - (b.overallRank ?? b.rank ?? 999999))
          .map((result) => [
            `#${result.overallRank ?? result.rank}`,
            result.bibNumber,
            runnerName(result),
            result.finishTime || '—',
            result.timingMethod === 'gun' ? 'Gun time' : 'Chip time',
          ]),
        styles: { fontSize: 8, cellPadding: 2.5, textColor: [40, 40, 40] },
        headStyles: { fillColor: [30, 30, 35], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 248, 250] },
        columnStyles: { 0: { halign: 'center', cellWidth: 17 }, 1: { halign: 'center', cellWidth: 28 }, 3: { halign: 'center', cellWidth: 28 }, 4: { halign: 'center', cellWidth: 25 } },
        margin: { left: 14, right: 14 },
      });
      cursorY = (pdf as any).lastAutoTable.finalY + 10;
    });

  const ageGroups = new Map<string, RunnerResult[]>();
  for (const result of finishers) {
    if (!result.categoryLabel || result.categoryRank === undefined) continue;
    const key = `${runnerDivisionLabel(result.runnerProfile)}|||${result.categoryLabel}`;
    const group = ageGroups.get(key) || [];
    group.push(result);
    ageGroups.set(key, group);
  }

  if (ageGroups.size > 0) {
    pdf.addPage();
    header('AGE-CATEGORY STANDINGS', `${reportScope} • OVERALL WINNERS EXCLUDED`);
    cursorY = 34;

    Array.from(ageGroups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([key, group]) => {
        const [division, category] = key.split('|||');
        if (cursorY > 250) {
          pdf.addPage();
          header('AGE-CATEGORY STANDINGS', `${reportScope} • OVERALL WINNERS EXCLUDED`);
          cursorY = 34;
        }
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10.5);
        pdf.setTextColor(180, 83, 9);
        pdf.text(`${division.toUpperCase()} • ${category.toUpperCase()}`, 14, cursorY);
        autoTable(pdf, {
          startY: cursorY + 4,
          head: [['Category Rank', 'Overall', 'Bib', 'Runner', 'Finish Time']],
          body: group
            .sort((a, b) => a.categoryRank! - b.categoryRank!)
            .map((result) => [
              `#${result.categoryRank}`,
              `#${result.overallRank ?? result.rank}`,
              result.bibNumber,
              runnerName(result),
              result.finishTime || '—',
            ]),
          styles: { fontSize: 8, cellPadding: 2.5, textColor: [40, 40, 40] },
          headStyles: { fillColor: [146, 64, 14], textColor: [255, 255, 255], fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [255, 251, 235] },
          columnStyles: { 0: { halign: 'center', cellWidth: 28 }, 1: { halign: 'center', cellWidth: 19 }, 2: { halign: 'center', cellWidth: 28 }, 4: { halign: 'center', cellWidth: 28 } },
          margin: { left: 14, right: 14 },
        });
        cursorY = (pdf as any).lastAutoTable.finalY + 10;
      });
  }

  const femaleGroups = new Map<string, RunnerResult[]>();
  for (const result of finishers) {
    if (result.runnerProfile?.gender !== 'female' || result.runnerProfile.isFreeSlot) continue;
    if (runnerEntryCategory(result.runnerProfile) !== 'solo') continue;
    const division = runnerDivisionLabel(result.runnerProfile);
    const group = femaleGroups.get(division) || [];
    group.push(result);
    femaleGroups.set(division, group);
  }

  if (femaleGroups.size > 0) {
    pdf.addPage();
    header('FEMALE OVERALL STANDINGS', reportScope);
    cursorY = 34;
    Array.from(femaleGroups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([division, group]) => {
        if (cursorY > 250) {
          pdf.addPage();
          header('FEMALE OVERALL STANDINGS', reportScope);
          cursorY = 34;
        }
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10.5);
        pdf.setTextColor(192, 38, 211);
        pdf.text(`${division.toUpperCase()} • FEMALE OVERALL`, 14, cursorY);
        const sorted = orderFemaleOverallResults(group, division, race);
        autoTable(pdf, {
          startY: cursorY + 4,
          head: [['Female Rank', 'Overall', 'Bib', 'Runner', 'Corrected Gun Time']],
          body: sorted.map((result, index) => [
            `#${index + 1}`,
            `#${result.overallRank ?? result.rank}`,
            result.bibNumber,
            runnerName(result),
            result.gunTime || result.finishTime || '—',
          ]),
          styles: { fontSize: 8, cellPadding: 2.5, textColor: [40, 40, 40] },
          headStyles: { fillColor: [162, 28, 175], textColor: [255, 255, 255], fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [253, 244, 255] },
          columnStyles: { 0: { halign: 'center', cellWidth: 27 }, 1: { halign: 'center', cellWidth: 19 }, 2: { halign: 'center', cellWidth: 28 }, 4: { halign: 'center', cellWidth: 28 } },
          margin: { left: 14, right: 14 },
        });
        cursorY = (pdf as any).lastAutoTable.finalY + 10;
      });
  }

  appendFooter(pdf);
  const distanceSuffix = distanceFilter ? `_${distanceFilter.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
  pdf.save(`${sanitizedName}${distanceSuffix}_Official_Rankings.pdf`);
  return true;
}
