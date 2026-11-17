import { auth } from '../firebase';
import { Gender, RaceEntryCategory } from '../types';
import { getAppCheckHeaders, type HumanFormSignals } from './botProtection';
import { boundedFetch, parseRetryAfterSeconds } from './resilientFetch';

export interface PendingRegistrationPayload {
  raceId: string;
  distance: string;
  entryCategory: RaceEntryCategory;
  fullName: string;
  gender: Gender;
  age: number;
  emergencyContactName: string;
  emergencyContactPhone: string;
  shirtSize?: string;
  teamName?: string;
  teamMembers?: string[];
  parentalConsentConfirmed?: boolean;
  parentalGuardianName?: string;
  parentalGuardianRelationship?: string;
  termsAcceptedAt?: string;
  marketingOptIn?: boolean;
}

export interface PaymentCheckoutResponse {
  paymentId: string;
  checkoutUrl: string;
}

export interface PaymentStatusResponse {
  paymentId: string;
  raceId: string;
  status: 'creating' | 'pending' | 'paid' | 'failed' | 'expired';
  amount: number;
  raceName: string;
  registrationId?: string;
}

export class PaymentRequestError extends Error {
  constructor(
    message: string,
    public readonly status = 0,
    public readonly retryAfter = 0,
  ) {
    super(message);
    this.name = 'PaymentRequestError';
  }
}

// This is the standard Firebase Functions URL for RacePulsePH. A staging or
// custom domain can override it without rebuilding through VITE_PAYMENTS_API_URL.
const paymentsApiUrl = (import.meta.env.VITE_PAYMENTS_API_URL || 'https://asia-southeast1-racepulseph.cloudfunctions.net/paymentsApi').replace(/\/$/, '');

async function paymentRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in before paying for a race registration.');
  const [token, appCheckHeaders] = await Promise.all([
    user.getIdToken(),
    getAppCheckHeaders(),
  ]);
  const response = await boundedFetch(
    `${paymentsApiUrl}${path}`,
    {
      ...init,
      headers: {
        ...appCheckHeaders,
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    },
    {
      maxRetries: init?.method === 'POST' ? 0 : 1,
      timeoutMs: 15_000,
      dedupeGet: (init?.method || 'GET').toUpperCase() === 'GET',
      circuitKey: 'paymentsApi',
    },
  );
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const retryAfter = parseRetryAfterSeconds(response, body);
    const msg = typeof body.error === 'string' && body.error
      ? body.error
      : 'Unable to start secure checkout. Please try again.';
    throw new PaymentRequestError(msg, response.status, retryAfter);
  }
  return body as T;
}

export async function createPayMongoCheckout(
  registration: PendingRegistrationPayload,
  signals?: HumanFormSignals,
): Promise<PaymentCheckoutResponse> {
  const result = await paymentRequest<PaymentCheckoutResponse>('/checkout', {
    method: 'POST',
    body: JSON.stringify({
      registration,
      ...(signals ? signals : {}),
    }),
  });
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(result.checkoutUrl);
  } catch {
    throw new Error('Received an invalid checkout redirect URL.');
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Checkout redirect must use HTTPS.');
  }
  return result;
}

export function getPaymentStatus(paymentId: string): Promise<PaymentStatusResponse> {
  return paymentRequest<PaymentStatusResponse>(`/payments/${encodeURIComponent(paymentId)}`);
}
