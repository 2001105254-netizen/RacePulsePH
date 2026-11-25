export const NATIVE_GOOGLE_LOGIN_OPTIONS = {
  style: 'standard' as const,
  filterByAuthorizedAccounts: false,
};

export type MappedAuthError = Error & { code?: string };

const GENERIC_GOOGLE_ERROR =
  'Unable to sign in with Google right now. Please try again or use email and password.';

function readErrorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return String((err as { code?: unknown }).code ?? '');
  }
  return '';
}

function readErrorMessage(err: unknown): string {
  if (err instanceof Error && typeof err.message === 'string') {
    return err.message.trim();
  }
  if (typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message.trim();
  }
  return '';
}

function makeAuthError(message: string, code?: string): MappedAuthError {
  const mapped = new Error(message) as MappedAuthError;
  if (code) {
    mapped.code = code;
  }
  return mapped;
}

/**
 * Normalizes native Android Credential Manager / GoogleProvider failures into concise,
 * user-safe messages so developer diagnostics (Logcat tags, SHA-1, client IDs) never leak in UI.
 */
export function mapNativeGoogleSignInError(err: unknown): MappedAuthError {
  const code = readErrorCode(err);
  const message = readErrorMessage(err);

  if (code === 'USER_CANCELLED' || /cancelled by user|canceled by user/i.test(message)) {
    return makeAuthError('Google sign-in was cancelled.', 'auth/popup-closed-by-user');
  }

  if (/\[16\]|Account reauth failed/i.test(message)) {
    return makeAuthError(
      'Google Sign-In could not verify your Google account on this device. Make sure you are signed into an active Google account in Android Settings, or sign in with email and password.',
      'auth/google-reauth-failed'
    );
  }

  if (/Developer console|28444|\b10:|Google Cloud OAuth is not configured/i.test(message)) {
    return makeAuthError(
      'Google Sign-In is temporarily unavailable for this app build. Please update RacePulsePH or sign in with email and password.',
      'auth/google-oauth-misconfigured'
    );
  }

  if (/No credentials available|NoCredentialException/i.test(message)) {
    return makeAuthError(
      'No Google account was found on this device. Add a Google account in Android Settings or sign in with email and password.',
      'auth/no-google-credential'
    );
  }

  if (!message || /Logcat|GoogleProvider|signingSha1|webClientId/i.test(message)) {
    return makeAuthError(GENERIC_GOOGLE_ERROR);
  }

  return makeAuthError(message, code || undefined);
}
