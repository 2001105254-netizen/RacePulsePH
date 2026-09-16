import { jsPDF } from 'jspdf';
import { Race, RunnerProfile, RunnerResult } from '../types';

// A public result contains only the fields printed on the certificate. Keeping
// this narrow lets an official finisher download the same verified record from
// the public results page without exposing private runner profile data.
type CertificateRunner = Pick<RunnerProfile, 'fullName' | 'bibNumber' | 'distance'>;

function safeFilename(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_') || 'RacePulsePH';
}

function loadCertificateLogo(): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    // Public assets work on both localhost and the installed PWA URL. The
    // logo is optional at runtime so a certificate can still download if an
    // older cached PWA cannot retrieve the current asset.
    image.src = '/assets/racepulse-mark.png';
  });
}

// Creates the certificate on the runner's own device. No additional personal
// data is stored: the certified details are the official result already shown
// in the runner's private My Races view.
export async function downloadFinisherCertificate(race: Race, runner: CertificateRunner, result: RunnerResult): Promise<void> {
  if (!result.finishTime) return;

  const logo = await loadCertificateLogo();

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
  if (logo) pdf.addImage(logo, 'PNG', 18, 15.5, 9.5, 9.5);
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text('RACEPULSEPH', logo ? 31 : 22, 22.5);
  pdf.setFontSize(7.5);
  pdf.text('OFFICIAL DIGITAL FINISHER RECORD', pageWidth - 22, 22.5, { align: 'right' });

  pdf.setTextColor(198, 40, 40);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.text('CERTIFICATE OF ACHIEVEMENT', center, 51, { align: 'center' });

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
  pdf.roundedRect(52, raceBottom + 13, 193, 26, 4, 4, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.text('DISTANCE', 75, raceBottom + 22, { align: 'center' });
  pdf.text('OFFICIAL TIME', 117, raceBottom + 22, { align: 'center' });
  pdf.text('OVERALL RANK', 157, raceBottom + 22, { align: 'center' });
  pdf.text('CATEGORY RANK', 198, raceBottom + 22, { align: 'center' });
  pdf.text('BIB NUMBER', 227, raceBottom + 22, { align: 'center' });
  pdf.setTextColor(255, 230, 230);
  pdf.setFontSize(11.5);
  pdf.text(runner.distance, 75, raceBottom + 32, { align: 'center' });
  pdf.text(result.finishTime, 117, raceBottom + 32, { align: 'center' });
  pdf.text(result.overallRank || result.rank ? `#${result.overallRank || result.rank}` : '—', 157, raceBottom + 32, { align: 'center' });
  pdf.text(result.categoryRank ? `#${result.categoryRank}` : '—', 198, raceBottom + 32, { align: 'center' });
  pdf.text(`#${runner.bibNumber}`, 227, raceBottom + 32, { align: 'center' });

  pdf.setTextColor(75, 75, 78);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  const rankText = result.categoryRank && result.categoryLabel
    ? `${result.categoryLabel} category rank #${result.categoryRank}`
    : 'Category rank is not configured for this race';
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
