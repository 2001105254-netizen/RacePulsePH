import { jsPDF } from 'jspdf';
import { Race, RunnerProfile } from '../types';
import { raceBibNameLines, resolveRaceBibTemplate } from './raceBib';
import { ensureRaceBibCustomFont, raceBibFontFamily } from './raceBibFont';

interface PrintableRaceBib {
  runner: RunnerProfile;
  runnerName: string;
}

function safeFilename(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_') || 'RacePulsePH';
}

async function loadImage(source: string): Promise<HTMLImageElement> {
  // A Storage download URL is cross-origin. Fetch it first and render the
  // resulting local blob URL instead, so Canvas can safely include it in the
  // printable PDF even when a browser is strict about cross-origin images.
  let objectUrl: string | null = null;
  let imageSource = source;
  if (!source.startsWith('data:') && !source.startsWith('blob:')) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Unable to download the race bib template (HTTP ${response.status}).`);
    objectUrl = URL.createObjectURL(await response.blob());
    imageSource = objectUrl;
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(new Error('Unable to load the race bib template.'));
    };
    image.src = imageSource;
  });
}

function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  xPercent: number,
  yPercent: number,
  sizePercent: number,
  color: string,
  strokeColor: string,
  strokeWidthPercent: number,
  fontFamily: string,
): void {
  let fontSize = Math.max(12, (width * sizePercent) / 100);
  const maxWidth = width * 0.9;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  do {
    ctx.font = `900 ${fontSize}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth || fontSize <= 12) break;
    fontSize -= 1;
  } while (fontSize > 12);

  const x = Math.min(width * 0.95, Math.max(width * 0.05, (width * xPercent) / 100));
  const safeHalfHeight = fontSize * 0.62;
  const y = Math.min(height - safeHalfHeight - 6, Math.max(safeHalfHeight + 6, (height * yPercent) / 100));
  const strokeWidth = Math.max(0, (width * strokeWidthPercent) / 100);
  if (strokeWidth > 0) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = strokeWidth * 2;
    ctx.strokeStyle = strokeColor;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = Math.max(1.5, fontSize * 0.035);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.max(1, fontSize * 0.025);
  ctx.fillText(text, x, y);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function drawFittedTextLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  width: number,
  height: number,
  xPercent: number,
  yPercent: number,
  sizePercent: number,
  color: string,
  strokeColor: string,
  strokeWidthPercent: number,
  fontFamily: string,
): void {
  if (lines.length <= 1) {
    drawFittedText(ctx, lines[0] || '', width, height, xPercent, yPercent, sizePercent, color, strokeColor, strokeWidthPercent, fontFamily);
    return;
  }

  const maxWidth = width * 0.9;
  // Reserve generous space around the name block because many templates have
  // inclusions/medal artwork along the lower third of the bib. Five-member
  // Group names must stay clear of that artwork.
  const maxBlockHeight = height * 0.18;
  let fontSize = Math.max(12, Math.min((width * sizePercent) / 100, maxBlockHeight / (lines.length * 1.16)));
  do {
    ctx.font = `900 ${fontSize}px ${fontFamily}`;
    if (lines.every((line) => ctx.measureText(line).width <= maxWidth) || fontSize <= 12) break;
    fontSize -= 1;
  } while (fontSize > 12);

  const x = Math.min(width * 0.95, Math.max(width * 0.05, (width * xPercent) / 100));
  const lineHeight = fontSize * 1.16;
  const blockHalfHeight = (lineHeight * (lines.length - 1)) / 2 + fontSize * 0.62;
  const centerY = Math.min(height - blockHalfHeight - 6, Math.max(blockHalfHeight + 6, (height * yPercent) / 100));
  const firstY = centerY - (lineHeight * (lines.length - 1)) / 2;
  const strokeWidth = Math.max(0, (width * strokeWidthPercent) / 100);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = Math.max(1.5, fontSize * 0.035);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.max(1, fontSize * 0.025);
  if (strokeWidth > 0) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = strokeWidth * 2;
    ctx.strokeStyle = strokeColor;
  }
  for (const [index, line] of lines.entries()) {
    const y = firstY + lineHeight * index;
    if (strokeWidth > 0) ctx.strokeText(line, x, y);
    ctx.fillText(line, x, y);
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function sortByBib(runners: RunnerProfile[]): RunnerProfile[] {
  return [...runners].sort((a, b) => a.bibNumber.localeCompare(b.bibNumber, undefined, { numeric: true, sensitivity: 'base' }));
}

function printableRaceBibs(runners: RunnerProfile[]): PrintableRaceBib[] {
  return sortByBib(runners).flatMap((runner) => {
    // Free slots are printed as a clean numbered bib ready for late/on-site
    // runners. No placeholder name should appear on the physical bib.
    if (runner.isFreeSlot) return [{ runner, runnerName: '' }];
    const memberNames = raceBibNameLines(runner);
    // A Group has one shared timing chip and bib number, but each person gets
    // a physical identification bib showing their own name. Duo/Trio keep
    // their shared team-name layout unless an organizer requests otherwise.
    if (runner.entryCategory === 'group' && memberNames.length > 1) {
      return memberNames.map((runnerName) => ({ runner, runnerName }));
    }
    return [{ runner, runnerName: runner.fullName }];
  });
}

// Generates two full-bleed personalized bibs per A4 sheet. Each bib fills one
// exact half of a portrait A4, so an organizer can use borderless printing and
// make one straight centre cut after printing.
export async function generateRaceBibsPdf(race: Race, runners: RunnerProfile[], distanceLabel?: string): Promise<number> {
  if (runners.length === 0) return 0;

  await ensureRaceBibCustomFont(race.raceBibCustomFont);
  await document.fonts?.ready;
  const canvas = document.createElement('canvas');
  // 1200 × 800 is crisp for half-A4 printing while keeping large rosters
  // manageable on a timing laptop.
  canvas.width = 1200;
  canvas.height = 800;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is not supported by this browser.');

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  // A4 portrait is 210 × 297 mm. Full-width, half-page bibs deliberately use
  // the whole page with no PDF footer or outer margin for Epson borderless
  // printing. The 3:2 artwork is scaled very slightly in height to fit the
  // exact half-A4 cut line.
  const bibWidth = 210;
  const bibHeight = 148.5;
  const x = 0;
  const yPositions = [0, 148.5];
  const printableBibs = printableRaceBibs(runners);
  const loadedTemplates = new Map<string, HTMLImageElement>();

  for (let index = 0; index < printableBibs.length; index += 1) {
    const { runner, runnerName } = printableBibs[index];
    const bibTemplate = resolveRaceBibTemplate(race, runner.distance);
    if (!bibTemplate) {
      throw new Error(`No race bib template is configured for ${runner.distance}. Upload a template for that distance or add a default template.`);
    }
    let template = loadedTemplates.get(bibTemplate.image);
    if (!template) {
      template = await loadImage(bibTemplate.image);
      loadedTemplates.set(bibTemplate.image, template);
    }
    if (index > 0 && index % 2 === 0) pdf.addPage();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(template, 0, 0, canvas.width, canvas.height);
    const { layout } = bibTemplate;
    drawFittedText(ctx, runner.bibNumber, canvas.width, canvas.height, layout.bibNumberX, layout.bibNumberY, layout.bibNumberSize ?? 12, layout.bibNumberColor ?? '#FFFFFF', layout.bibNumberStrokeColor ?? '#000000', layout.bibNumberStrokeWidth ?? 0, raceBibFontFamily(layout.bibNumberFont, race.raceBibCustomFont, true));
    const nameLines = runner.isFreeSlot ? [] : runner.entryCategory === 'group' ? [runnerName] : raceBibNameLines(runner);
    if (nameLines.length > 0) {
      drawFittedTextLines(ctx, nameLines, canvas.width, canvas.height, layout.runnerNameX, layout.runnerNameY, layout.runnerNameSize ?? 5, layout.runnerNameColor ?? '#FFFFFF', layout.runnerNameStrokeColor ?? '#000000', layout.runnerNameStrokeWidth ?? 0, raceBibFontFamily(layout.runnerNameFont, race.raceBibCustomFont, true));
    }

    const pageSlot = index % 2;
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', x, yPositions[pageSlot], bibWidth, bibHeight, `bib-${index}`, 'FAST');

    // Let the browser repaint periodically when making a large 500+ bib file.
    if (index > 0 && index % 8 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  const scope = distanceLabel ? safeFilename(distanceLabel) : 'All';
  pdf.save(`${safeFilename(race.name)}_${scope}_Race_Bibs_A4.pdf`);
  return printableBibs.length;
}
