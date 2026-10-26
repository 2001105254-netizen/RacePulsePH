import { auth } from '../firebase';

const apiUrl = (import.meta.env.VITE_ACCOUNT_API_URL || 'https://asia-southeast1-racepulseph.cloudfunctions.net/accountApi').replace(/\/$/, '');

export interface CodeDelivery {
  challengeId?: string;
  alreadyVerified?: boolean;
  expiresIn: number;
  retryAfter: number;
}

export class AccountRequestError extends Error {
  constructor(message: string, public retryAfter = 0, public status = 0) { super(message); }
}

const unavailableMessage = 'RacePulse email delivery is temporarily unavailable. Please try again later. If this continues, contact events@racepulseph.com.';

async function request<T>(path: string, body: object, authenticated = false): Promise<T> {
  const token = authenticated ? await auth.currentUser?.getIdToken() : null;
  if (authenticated && !token) throw new Error('Please sign in again to verify your email.');
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new AccountRequestError(offline ? 'You’re offline. Reconnect to the internet, then try again.' : unavailableMessage);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const unavailable = response.status === 404 || response.status >= 500;
    throw new AccountRequestError(unavailable ? unavailableMessage : result?.error || 'Could not complete this request. Please try again.', Number(result?.retryAfter) || 0, response.status);
  }
  if (!result || typeof result !== 'object') throw new AccountRequestError(unavailableMessage);
  return result as T;
}

function validateDelivery(delivery: CodeDelivery, allowVerified = false): CodeDelivery {
  if (allowVerified && delivery.alreadyVerified === true) return delivery;
  if (typeof delivery.challengeId !== 'string' || !/^[a-f0-9]{48}$/.test(delivery.challengeId)
    || !Number.isFinite(delivery.expiresIn) || delivery.expiresIn <= 0
    || !Number.isFinite(delivery.retryAfter) || delivery.retryAfter < 0) throw new AccountRequestError(unavailableMessage);
  return delivery;
}

export const requestVerificationCode = async (name?: string) => validateDelivery(await request<CodeDelivery>('/verification/request', { name }, true), true);
export const confirmVerificationCode = async (challengeId: string, code: string) => {
  const result = await request<{ verified: boolean }>('/verification/confirm', { challengeId, code }, true);
  if (result.verified !== true) throw new AccountRequestError(unavailableMessage);
  return result;
};
export const requestPasswordCode = async (email: string) => validateDelivery(await request<CodeDelivery>('/password/request', { email }));
export const confirmPasswordCode = async (email: string, challengeId: string, code: string) => {
  const result = await request<{ resetToken: string }>('/password/confirm', { email, challengeId, code });
  if (typeof result.resetToken !== 'string' || !/^[a-f0-9]{64}$/.test(result.resetToken)) throw new AccountRequestError(unavailableMessage);
  return result;
};
export const completePasswordReset = async (resetToken: string, password: string) => {
  const result = await request<{ reset: boolean }>('/password/complete', { resetToken, password });
  if (result.reset !== true) throw new AccountRequestError(unavailableMessage);
  return result;
};

export interface SignupDraft { displayName: string; username: string; role: 'runner' | 'organizer' | 'superadmin' }
const draftKey = (email: string) => `racepulse_signup:${email.trim().toLowerCase()}`;
export function saveSignupDraft(email: string, draft: SignupDraft) {
  // Only profile details are retained; passwords and codes stay in memory.
  try { sessionStorage.setItem(draftKey(email), JSON.stringify(draft)); } catch { /* The profile form remains available if storage is blocked. */ }
}
export function getSignupDraft(email: string): SignupDraft | null {
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey(email)) || 'null');
    return draft && typeof draft.displayName === 'string' && typeof draft.username === 'string' && ['runner', 'organizer', 'superadmin'].includes(draft.role) ? draft : null;
  } catch { return null; }
}
export function clearSignupDraft(email: string) {
  try { sessionStorage.removeItem(draftKey(email)); } catch { /* Storage may be blocked. */ }
}
