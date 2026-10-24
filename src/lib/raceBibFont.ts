import { RaceBibCustomFont, RaceBibFont } from '../types';

const browserFallbacks: Record<Exclude<RaceBibFont, 'custom'>, string> = {
  display: '"Space Grotesk", Arial, sans-serif',
  sans: 'Inter, Arial, sans-serif',
  mono: '"JetBrains Mono", "Courier New", monospace',
  condensed: 'Impact, "Arial Narrow Bold", sans-serif',
};

const canvasFallbacks: Record<Exclude<RaceBibFont, 'custom'>, string> = {
  display: 'Space Grotesk, Arial, sans-serif',
  sans: 'Inter, Arial, sans-serif',
  mono: 'JetBrains Mono, Courier New, monospace',
  condensed: 'Impact, Arial Narrow Bold, sans-serif',
};

const loadedFonts = new Map<string, Promise<void>>();

export function raceBibFontFamily(font: RaceBibFont | undefined, customFont?: RaceBibCustomFont, canvas = false): string {
  if (font === 'custom' && customFont?.family) {
    return canvas ? `${customFont.family}, Arial, sans-serif` : `"${customFont.family}", Arial, sans-serif`;
  }
  const selected = font === 'custom' ? 'mono' : (font || 'mono');
  return canvas ? canvasFallbacks[selected] : browserFallbacks[selected];
}

// Register the uploaded font once per browser session so previews, downloaded
// bib PNGs, and the canvas used for the bulk PDF all use the same typeface.
export async function ensureRaceBibCustomFont(customFont?: RaceBibCustomFont): Promise<void> {
  if (!customFont || typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  const key = `${customFont.family}:${customFont.url}`;
  const existing = loadedFonts.get(key);
  if (existing) return existing;

  const loading = (async () => {
    const font = new FontFace(customFont.family, `url("${customFont.url}")`);
    await font.load();
    document.fonts.add(font);
  })();
  loadedFonts.set(key, loading);
  try {
    await loading;
  } catch (error) {
    loadedFonts.delete(key);
    throw error;
  }
}
