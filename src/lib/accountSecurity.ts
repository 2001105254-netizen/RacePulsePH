import { auth } from '../firebase';
import { useFirebaseEmulators } from './firebaseEnvironment';

const apiUrl = (useFirebaseEmulators ? '/api/account' : import.meta.env.VITE_ACCOUNT_API_URL || 'https://asia-southeast1-racepulseph.cloudfunctions.net/accountApi').replace(/\/$/, '');

export interface CodeDelivery {
  challengeId?: string;
  alreadyVerified?: boolean;
  expiresIn: number;
  retryAfter: number;
}

export class AccountRequestError extends Error {
  constructor(message: string, public retryAfter = 0) { super(message); }
}

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
    throw new Error('Could not reach the email service. Check your connection and try again.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new AccountRequestError(result.error || 'Could not complete this request. Please try again.', Number(result.retryAfter) || 0);
  return result as T;
}

export const requestVerificationCode = (name?: string) => request<CodeDelivery>('/verification/request', { name }, true);
export const confirmVerificationCode = (challengeId: string, code: string) => request('/verification/confirm', { challengeId, code }, true);
export const requestPasswordCode = (email: string) => request<CodeDelivery>('/password/request', { email });
export const confirmPasswordCode = (email: string, challengeId: string, code: string) => request<{ resetToken: string }>('/password/confirm', { email, challengeId, code });
export const completePasswordReset = (resetToken: string, password: string) => request('/password/complete', { resetToken, password });

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
