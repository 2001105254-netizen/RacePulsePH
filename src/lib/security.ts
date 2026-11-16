export const SAFE_IFRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox';

export const SAFE_RASTER_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export const MAX_XLSX_BYTES = 5 * 1024 * 1024;
export const MAX_BACKUP_JSON_BYTES = 5 * 1024 * 1024;
export const MAX_ROSTER_SHEETS = 20;
export const MAX_ROSTER_ROWS = 5000;

const FORMULA_TRIGGER_RE = /^[\t\r\n ]*[=+\-@]/;
const RASTER_EXT_RE = /\.(png|jpe?g|webp|gif|avif)$/i;
const RASTER_DATA_URL_RE = /^data:image\/(?:png|jpeg|jpg|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i;
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function sanitizeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = FORMULA_TRIGGER_RE.test(raw) || raw.startsWith('\t') || raw.startsWith('\r')
    ? `'${raw}`
    : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function isSafeRasterImageType(mimeType: string, fileName?: string): boolean {
  const normalized = (mimeType || '').trim().toLowerCase();
  if (!SAFE_RASTER_IMAGE_TYPES.has(normalized)) return false;
  if (fileName && !RASTER_EXT_RE.test(fileName.trim())) return false;
  return true;
}

export function sanitizePhotoReference(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  if (RASTER_DATA_URL_RE.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export function sanitizeHttpUrl(rawUrl: string, httpsOnly = false): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') return parsed.toString();
    if (!httpsOnly && parsed.protocol === 'http:') return parsed.toString();
    return '';
  } catch {
    return '';
  }
}

export function stripUnsafeKeys<T>(value: T, depth = 0): T {
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripUnsafeKeys(item, depth + 1)) as unknown as T;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const clean: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!FORBIDDEN_OBJECT_KEYS.has(key)) {
      clean[key] = stripUnsafeKeys(entry, depth + 1);
    }
  }
  return clean as T;
}

export function randomShortCode(
  length: number,
  alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
): string {
  if (!Number.isInteger(length) || length <= 0) return '';
  if (!alphabet.length || alphabet.length > 256) {
    throw new Error('Alphabet length must be between 1 and 256.');
  }
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure random number generation is unavailable.');
  }
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  const bytes = new Uint8Array(Math.max(16, length * 2));
  let result = '';
  while (result.length < length) {
    cryptoApi.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit) {
        result += alphabet[byte % alphabet.length];
        if (result.length === length) break;
      }
    }
  }
  return result;
}

export function assertSafeImportFile(
  file: { name?: string; size?: number },
  maxBytes: number,
  allowedExtensionPattern: RegExp,
  invalidTypeMessage: string,
): void {
  const name = file.name || '';
  if (!allowedExtensionPattern.test(name)) {
    throw new Error(invalidTypeMessage);
  }
  if (typeof file.size === 'number' && file.size > maxBytes) {
    const maxMb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
    throw new Error(`File exceeds the ${maxMb} MB safety limit.`);
  }
}
