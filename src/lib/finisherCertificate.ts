import { jsPDF } from 'jspdf';
import { Race, RunnerProfile, RunnerResult } from '../types';

function safeFilename(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_') || 'RacePulsePH';
}

// Creates the certificate on the runner's own device. No additional personal
// data is stored: the certified details are the official result already shown
// in the runner's private My Races view.
export function downloadFinisherCertificate(race: Race, runner: RunnerProfile, result: RunnerResult): void {
  if (!result.finishTime) return;

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = 297;
  const pageHeight = 210;
  const center = pageWidth / 2;
  const raceDate = new Date(`${race.date}T12:00:00`).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  pdf.setFillColor(255, 253, 248);
  pdf.rect(0, 0, pageWidth, pageHeight, 'F');
  pdf.setDrawColor(198, 40, 40);
  pdf.setLineWidth(1.4);
  pdf.rect(8, 8, pageWidth - 16, pageHeight - 16);
  pdf.setDrawColor(28, 28, 30);
  pdf.setLineWidth(0.35);
  pdf.rect(12, 12, pageWidth - 24, pageHeight - 24);

  pdf.setFillColor(198, 40, 40);
  pdf.rect(14, 14, pageWidth - 28, 13, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text('RACEPULSEPH', 22, 22.5);
  pdf.setFontSize(7.5);
  pdf.text('OFFICIAL DIGITAL FINISHER RECORD', pageWidth - 22, 22.5, { align: 'right' });

  pdf.setTextColor(198, 40, 40);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.text('CERTIFICATE OF ACHIEVEMENT', center, 51, { align: 'center', charSpace: 1.5 });

  pdf.setTextColor(32, 32, 34);
  pdf.setFontSize(29);
  pdf.setFont('times', 'bolditalic');
  pdf.text('This is proudly presented to', center, 70, { align: 'center' });

  pdf.setTextColor(198, 40, 40);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(25);
  const nameLines = pdf.splitTextToSize(runner.fullName.toUpperCase(), 230);
  pdf.text(nameLines, center, 87, { align: 'center' });
  const nameBottom = 87 + (nameLines.length - 1) * 10;
  pdf.setDrawColor(198, 40, 40);
  pdf.setLineWidth(0.7);
  pdf.line(69, nameBottom + 7, pageWidth - 69, nameBottom + 7);

  pdf.setTextColor(60, 60, 62);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.text('for successfully completing', center, nameBottom + 21, { align: 'center' });
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  const raceLines = pdf.splitTextToSize(race.name.toUpperCase(), 235);
  pdf.text(raceLines, center, nameBottom + 32, { align: 'center' });
  const raceBottom = nameBottom + 32 + (raceLines.length - 1) * 6.5;

  pdf.setFillColor(30, 30, 32);
  pdf.roundedRect(68, raceBottom + 13, 161, 26, 4, 4, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.text('DISTANCE', 93, raceBottom + 22, { align: 'center' });
  pdf.text('OFFICIAL TIME', center, raceBottom + 22, { align: 'center' });
  pdf.text('BIB NUMBER', 204, raceBottom + 22, { align: 'center' });
  pdf.setTextColor(255, 230, 230);
  pdf.setFontSize(14);
  pdf.text(runner.distance, 93, raceBottom + 32, { align: 'center' });
  pdf.text(result.finishTime, center, raceBottom + 32, { align: 'center' });
  pdf.text(`#${runner.bibNumber}`, 204, raceBottom + 32, { align: 'center' });

  pdf.setTextColor(75, 75, 78);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  const rankText = result.rank ? `Official rank #${result.rank} in ${runner.distance}` : 'Official finisher result';
  pdf.text(`${raceDate}  •  ${rankText}`, center, raceBottom + 51, { align: 'center' });

  pdf.setDrawColor(190, 190, 190);
  pdf.setLineWidth(0.3);
  pdf.line(22, 181, pageWidth - 22, 181);
  pdf.setTextColor(115, 115, 118);
  pdf.setFontSize(7.5);
  pdf.text('Verified from the RacePulsePH official timing record', 22, 189);
  pdf.text(`Certificate ref: ${safeFilename(race.id).slice(0, 18)}-${safeFilename(runner.bibNumber).slice(0, 18)}`, pageWidth - 22, 189, { align: 'right' });

  pdf.save(`${safeFilename(race.name)}_${safeFilename(runner.bibNumber)}_E-Certificate.pdf`);
}
