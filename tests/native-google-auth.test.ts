import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIVE_GOOGLE_LOGIN_OPTIONS,
  mapNativeGoogleSignInError,
} from '../src/lib/nativeGoogleAuth.ts';

test('NATIVE_GOOGLE_LOGIN_OPTIONS explicitly disables authorized-account filtering for standard Android login', () => {
  assert.equal(NATIVE_GOOGLE_LOGIN_OPTIONS.style, 'standard');
  assert.equal(NATIVE_GOOGLE_LOGIN_OPTIONS.filterByAuthorizedAccounts, false);
});

test('mapNativeGoogleSignInError maps USER_CANCELLED to auth/popup-closed-by-user', () => {
  const err = Object.assign(new Error('Google Sign-In cancelled by user'), { code: 'USER_CANCELLED' });
  const mapped = mapNativeGoogleSignInError(err);
  assert.equal(mapped.code, 'auth/popup-closed-by-user');
  assert.equal(mapped.message, 'Google sign-in was cancelled.');
});

test('mapNativeGoogleSignInError hides developer Logcat diagnostics on [16] Account reauth failed', () => {
  const rawPluginError = new Error(
    'Google Sign-In failed: [16] Account reauth failed. The plugin cleared Credential Manager credential-selection state and retried once. ' +
      'If this affects only some users, check OAuth consent screen (External vs Internal, test users in Testing mode), ' +
      'Family Link accounts (ensure filterByAuthorizedAccounts is not set to true), and whether the user disabled Sign in with Google for your app. ' +
      'See Logcat tag GoogleProvider for package, signingSha1, and webClientId.'
  );

  const mapped = mapNativeGoogleSignInError(rawPluginError);
  assert.equal(mapped.code, 'auth/google-reauth-failed');
  assert.doesNotMatch(mapped.message, /Logcat|GoogleProvider|signingSha1|webClientId|filterByAuthorizedAccounts/i);
  assert.match(mapped.message, /Google/i);
  assert.match(mapped.message, /email and password/i);
  assert.ok(!mapped.message.includes('—'), 'Error microcopy must not contain em dashes');
});

test('mapNativeGoogleSignInError hides developer diagnostics on OAuth misconfiguration errors', () => {
  const rawPluginError = new Error(
    'Google Sign-In failed: Google Cloud OAuth is not configured for this installed build (10: Developer console is not set up correctly). ' +
      'Check Logcat tag GoogleProvider for package, signingSha1, and webClientId.'
  );

  const mapped = mapNativeGoogleSignInError(rawPluginError);
  assert.equal(mapped.code, 'auth/google-oauth-misconfigured');
  assert.doesNotMatch(mapped.message, /Logcat|GoogleProvider|signingSha1|webClientId|28444/i);
  assert.match(mapped.message, /email and password/i);
});

test('mapNativeGoogleSignInError maps NoCredentialException cleanly', () => {
  const rawError = new Error('Google Sign-In failed: No credentials available');
  const mapped = mapNativeGoogleSignInError(rawError);
  assert.equal(mapped.code, 'auth/no-google-credential');
  assert.match(mapped.message, /Google account/i);
});

test('mapNativeGoogleSignInError handles non-Error inputs safely', () => {
  const mapped = mapNativeGoogleSignInError(null);
  assert.equal(mapped.message, 'Unable to sign in with Google right now. Please try again or use email and password.');
});
