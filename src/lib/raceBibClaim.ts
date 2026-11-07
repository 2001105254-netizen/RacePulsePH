import { authenticatedFetch } from './access';
import { RaceEntryCategory, RunnerProfile } from '../types';

export interface RaceBibQrPayload {
  raceId: string;
  bibNumber: string;
}

export interface RaceBibClaimPreview {
  race: { id: string; name: string; date: string };
  runner: RunnerProfile;
  alreadyLinked?: boolean;
}

// Keep this format in sync with the QR printed by raceBibPdf.ts. A bib QR is
// deliberately distinct from an organizer's event-registration URL.
export function parseRaceBibQr(text: string): RaceBibQrPayload | null {
  const parts = text.trim().split('|');
  if (parts.length !== 3 || parts[0] !== 'RPCHIPv1') return null;
  const raceId = parts[1].trim();
  const bibNumber = parts[2].trim().toUpperCase();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(raceId) || !bibNumber || bibNumber.length > 20) return null;
  return { raceId, bibNumber };
}

const claimApiUrl = (import.meta.env.VITE_RACE_BIB_CLAIM_API_URL || 'https://asia-southeast1-racepulseph.cloudfunctions.net/raceBibClaimApi').replace(/\/$/, '');

async function requestClaim<T>(path: '/preview' | '/claim', payload: RaceBibQrPayload): Promise<T> {
  const response = await authenticatedFetch(`${claimApiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to verify this race bib.');
  return body as T;
}

export function previewRaceBibClaim(payload: RaceBibQrPayload): Promise<RaceBibClaimPreview> {
  return requestClaim<RaceBibClaimPreview>('/preview', payload);
}

export function claimRaceBib(payload: RaceBibQrPayload): Promise<RaceBibClaimPreview> {
  return requestClaim<RaceBibClaimPreview>('/claim', payload);
}

export const claimableEntryLabel = (category?: RaceEntryCategory): string => {
  if (category === 'duo') return 'Duo';
  if (category === 'trio') return 'Trio';
  if (category === 'group') return 'Group';
  return 'Solo';
};
