import { useEffect, useState } from 'react';
import { Race, RunnerProfile } from '../../types';

const DESKTOP_QUERY = '(min-width: 1024px)';

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia(DESKTOP_QUERY).matches : true,
  );

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isDesktop;
}

export const standardShirtSizes = ['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'] as const;
export const usernamePattern = /^[a-z0-9][a-z0-9_.-]{2,23}$/;

export function philippineTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
}

export function mostRecent(profiles: RunnerProfile[]): RunnerProfile | undefined {
  return [...profiles].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

export function formatFeeRangePH(distances: Race['distances'] | undefined): string {
  const prices = (distances || []).map((d) => Number(d.price) || 0);
  if (prices.length === 0) return 'Free / TBA';
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max <= 0) return 'Free';
  if (min === max) return `₱${min.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
  return `₱${min.toLocaleString('en-PH', { maximumFractionDigits: 0 })} - ₱${max.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
}

export function sortedRaceDistances(race: Race): Race['distances'] {
  return [...(race.distances || [])].sort((a, b) => {
    if (Number.isFinite(a.km) && Number.isFinite(b.km) && a.km !== b.km) return a.km - b.km;
    return a.label.localeCompare(b.label, undefined, { numeric: true });
  });
}

function loadDirectImage(source: string, useCors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (useCors && !source.startsWith('data:') && !source.startsWith('blob:')) {
      image.crossOrigin = 'anonymous';
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load the race bib template.'));
    image.src = source;
  });
}

export async function loadDataImage(source: string): Promise<HTMLImageElement> {
  try {
    return await loadDirectImage(source, true);
  } catch {
    if (source.startsWith('data:') || source.startsWith('blob:')) {
      throw new Error('Unable to load the race bib template.');
    }
    const response = await fetch(source, { mode: 'cors', cache: 'reload' });
    if (!response.ok) {
      throw new Error('Unable to load the race bib template.');
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await loadDirectImage(objectUrl, false);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

// The download is drawn directly onto the original bib artwork rather than
// screenshotting the responsive preview so long names shrink-to-fit cleanly.
export function drawFittedRaceBibText(
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

export function drawFittedRaceBibTextLines(
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
    drawFittedRaceBibText(ctx, lines[0] || '', width, height, xPercent, yPercent, sizePercent, color, strokeColor, strokeWidthPercent, fontFamily);
    return;
  }

  const maxWidth = width * 0.9;
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

export function drawFallbackRaceBibCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  race: Race,
  runnerProfile: RunnerProfile,
): void {
  ctx.fillStyle = '#141418';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#991b1b';
  ctx.fillRect(0, 0, width, Math.round(height * 0.14));

  ctx.strokeStyle = '#3f3f46';
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, width - 24, height - 24);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 28px system-ui, sans-serif';
  ctx.fillText((race.name || 'RACEPULSE PH').toUpperCase(), 38, Math.round(height * 0.07));

  ctx.textAlign = 'right';
  ctx.fillStyle = '#fca5a5';
  ctx.font = '700 24px monospace';
  ctx.fillText(runnerProfile.distance || '', width - 38, Math.round(height * 0.07));

  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, Math.round(height * 0.91), width, Math.round(height * 0.09));
  ctx.textAlign = 'center';
  ctx.fillStyle = '#d4d4d8';
  ctx.font = '600 18px system-ui, sans-serif';
  ctx.fillText('RACEPULSE PH OFFICIAL DIGITAL RACE BIB', width / 2, Math.round(height * 0.955));
}
