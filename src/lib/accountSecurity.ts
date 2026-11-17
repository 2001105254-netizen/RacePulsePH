import { auth } from '../firebase';
import { getAppCheckHeaders, type HumanFormSignals } from './botProtection';
import { parseRetryAfterSeconds } from './resilientFetch';
import type { FriendProfile } from '../types';

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

const emailUnavailableMessage = 'RacePulse email delivery is temporarily unavailable. Please try again later. If this continues, contact events@racepulseph.com.';
const searchUnavailableMessage = 'Runner search is temporarily unavailable. Please try again shortly.';

async function request<T>(
  path: string,
  body: object,
  authenticated = false,
  unavailableFallback = emailUnavailableMessage,
): Promise<T> {
  const token = authenticated ? await auth.currentUser?.getIdToken() : null;
  if (authenticated && !token) throw new Error('Please sign in again to continue.');
  const appCheckHeaders = typeof getAppCheckHeaders === 'function' ? await getAppCheckHeaders() : {};
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...appCheckHeaders,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new AccountRequestError(offline ? 'You’re offline. Reconnect to the internet, then try again.' : unavailableFallback);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const unavailable = response.status === 404 || response.status >= 500;
    const retryAfter = typeof parseRetryAfterSeconds === 'function'
      ? parseRetryAfterSeconds(response, result)
      : Number(result?.retryAfter || response.headers?.get?.('Retry-After')) || 0;
    throw new AccountRequestError(
      unavailable ? unavailableFallback : result?.error || 'Could not complete this request. Please try again.',
      retryAfter,
      response.status,
    );
  }
  if (!result || typeof result !== 'object') throw new AccountRequestError(unavailableFallback);
  return result as T;
}

function validateDelivery(delivery: CodeDelivery, allowVerified = false): CodeDelivery {
  if (allowVerified && delivery.alreadyVerified === true) return delivery;
  if (typeof delivery.challengeId !== 'string' || !/^[a-f0-9]{48}$/.test(delivery.challengeId)
    || !Number.isFinite(delivery.expiresIn) || delivery.expiresIn <= 0
    || !Number.isFinite(delivery.retryAfter) || delivery.retryAfter < 0) throw new AccountRequestError(emailUnavailableMessage);
  return delivery;
}

export const requestVerificationCode = async (name?: string, signals?: HumanFormSignals) =>
  validateDelivery(await request<CodeDelivery>('/verification/request', { name, ...(signals || {}) }, true), true);

export const confirmVerificationCode = async (challengeId: string, code: string, signals?: HumanFormSignals) => {
  const result = await request<{ verified: boolean }>('/verification/confirm', { challengeId, code, ...(signals || {}) }, true);
  if (result.verified !== true) throw new AccountRequestError(emailUnavailableMessage);
  return result;
};

export const requestPasswordCode = async (email: string, signals?: HumanFormSignals) =>
  validateDelivery(await request<CodeDelivery>('/password/request', { email, ...(signals || {}) }));

export const confirmPasswordCode = async (email: string, challengeId: string, code: string, signals?: HumanFormSignals) => {
  const result = await request<{ resetToken: string }>('/password/confirm', { email, challengeId, code, ...(signals || {}) });
  if (typeof result.resetToken !== 'string' || !/^[a-f0-9]{64}$/.test(result.resetToken)) throw new AccountRequestError(emailUnavailableMessage);
  return result;
};

export const completePasswordReset = async (resetToken: string, password: string, signals?: HumanFormSignals) => {
  const result = await request<{ reset: boolean }>('/password/complete', { resetToken, password, ...(signals || {}) });
  if (result.reset !== true) throw new AccountRequestError(emailUnavailableMessage);
  return result;
};

export interface DeleteAccountResult {
  deleted: boolean;
  purgedDocs: number;
  anonymizedDocs: number;
}

export const deleteMyAccountAndData = async () => {
  const result = await request<DeleteAccountResult>('/account/delete', { confirmation: 'DELETE' }, true);
  if (result.deleted !== true) throw new AccountRequestError(emailUnavailableMessage);
  return result;
};

export const updateMarketingPreference = async (marketingOptIn: boolean) => {
  const result = await request<{ updated: boolean; marketingOptIn: boolean }>(
    '/account/preferences',
    { marketingOptIn },
    true
  );
  if (result.updated !== true) throw new AccountRequestError(emailUnavailableMessage);
  return result;
};

export interface UnsubscribeResult {
  unsubscribed: boolean;
  email?: string;
  marketingOptIn: boolean;
}

export const submitUnsubscribe = async (input: { token?: string; email?: string; marketingOptIn?: boolean }) => {
  return request<UnsubscribeResult>('/unsubscribe', input, false);
};

export const searchRunnerFriends = async (query: string): Promise<FriendProfile[]> => {
  const result = await request<{ results: FriendProfile[] }>(
    '/friends/search',
    { query },
    true,
    searchUnavailableMessage,
  );
  if (!Array.isArray(result.results)) throw new AccountRequestError(searchUnavailableMessage);
  return result.results;
};

export interface SignupDraft {
  displayName: string;
  username: string;
  role: 'runner' | 'organizer' | 'superadmin';
  over13Confirmed?: boolean;
  termsAcceptedAt?: string;
  marketingOptIn?: boolean;
}
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
