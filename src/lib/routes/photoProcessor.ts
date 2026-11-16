import type { RoutePhotoAsset } from './types';

export const MAX_LANDMARK_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_LANDMARK_MEGAPIXELS = 24_000_000;
export const MAX_PHOTOS_PER_MARKER = 3;
export const MAX_MARKERS_PER_ROUTE = 200;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

async function computeSha256Hex(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv_${(hash >>> 0).toString(16)}`;
}

function resizeCanvasToDataUrl(
  img: HTMLImageElement,
  maxWidth: number,
  quality: number,
): { dataUrl: string; width: number; height: number } {
  const scale = Math.min(1, maxWidth / Math.max(1, img.naturalWidth));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Image processing canvas is unavailable in this browser.');
  }
  // Drawing to a fresh canvas strips all EXIF, GPS, and embedded metadata.
  ctx.drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return { dataUrl, width, height };
}

export async function processLandmarkPhotoFile(
  file: File,
  metadata: {
    caption: string;
    altText: string;
    credit: string;
    rightsConfirmed: boolean;
  },
): Promise<RoutePhotoAsset> {
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
    throw new Error('Upload a JPEG, PNG, or WebP landmark photo.');
  }
  if (file.size > MAX_LANDMARK_IMAGE_BYTES) {
    throw new Error('Landmark photo exceeds the 8 MB limit.');
  }

  const caption = metadata.caption.trim();
  const altText = metadata.altText.trim();
  const credit = metadata.credit.trim();
  if (!caption || !altText || !credit) {
    throw new Error('Caption, alt text, and photographer or organization credit are required.');
  }
  if (!metadata.rightsConfirmed) {
    throw new Error('Confirm that you hold publication rights before attaching this photo.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('This image file could not be decoded.'));
      el.src = objectUrl;
    });

    const totalPixels = img.naturalWidth * img.naturalHeight;
    if (totalPixels <= 0 || totalPixels > MAX_LANDMARK_MEGAPIXELS) {
      throw new Error('Image dimensions exceed the 24 megapixel processing limit.');
    }

    const thumb = resizeCanvasToDataUrl(img, 320, 0.78);
    const detail = resizeCanvasToDataUrl(img, 1280, 0.84);
    const sha256 = await computeSha256Hex(detail.dataUrl);

    return {
      id: `photo_${Date.now().toString(36)}_${sha256.slice(0, 8)}`,
      thumbnailUrl: thumb.dataUrl,
      detailUrl: detail.dataUrl,
      width: detail.width,
      height: detail.height,
      byteSize: Math.round((detail.dataUrl.length * 3) / 4),
      sha256,
      caption,
      altText,
      credit,
      rightsConfirmed: true,
      capturedOrReviewedAt: new Date().toISOString(),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function createSyntheticLandmarkPhoto(metadata: {
  caption: string;
  altText: string;
  credit: string;
  title: string;
}): Promise<RoutePhotoAsset> {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable.');
  const grad = ctx.createLinearGradient(0, 0, 640, 360);
  grad.addColorStop(0, '#18181b');
  grad.addColorStop(1, '#7f1d1d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillText(metadata.title.slice(0, 36), 32, 180);
  ctx.font = '400 15px system-ui, sans-serif';
  ctx.fillStyle = '#e4e4e7';
  ctx.fillText(metadata.caption.slice(0, 54), 32, 214);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const sha256 = await computeSha256Hex(dataUrl);
  return {
    id: `photo_${sha256.slice(0, 10)}`,
    thumbnailUrl: dataUrl,
    detailUrl: dataUrl,
    width: 640,
    height: 360,
    byteSize: Math.round((dataUrl.length * 3) / 4),
    sha256,
    caption: metadata.caption,
    altText: metadata.altText,
    credit: metadata.credit,
    rightsConfirmed: true,
    capturedOrReviewedAt: new Date().toISOString(),
  };
}
