import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as appRouting from '../src/lib/appRouting.ts';

test('utility routes win over ?register query param on guest screen resolution', () => {
  const cases: Array<[string, string]> = [
    ['/cookie-policy', 'cookies'],
    ['/cookies', 'cookies'],
    ['/privacy-policy', 'privacy'],
    ['/terms-of-service', 'terms'],
    ['/refund-policy', 'refund'],
    ['/unsubscribe', 'unsubscribe'],
  ];

  for (const [pathname, expected] of cases) {
    assert.equal(
      appRouting.guestScreenFromLocation(pathname, '?register=race-1'),
      expected,
      `Expected ${pathname}?register=race-1 to resolve to ${expected}`,
    );
  }
});

test('?register query param opens signup from root and /register routes', () => {
  assert.equal(appRouting.guestScreenFromLocation('/register', '?register=race-1'), 'signup');
  assert.equal(appRouting.guestScreenFromLocation('/', '?register=race-1'), 'signup');
});

test('isPublicUtilityScreen identifies legal and unsubscribe screens only', () => {
  const isUtility = (appRouting as Record<string, any>).isPublicUtilityScreen;
  assert.equal(typeof isUtility, 'function', 'isPublicUtilityScreen must be exported');

  for (const screen of ['privacy', 'terms', 'refund', 'cookies', 'unsubscribe']) {
    assert.equal(isUtility(screen), true, `Expected ${screen} to be a utility screen`);
  }
  for (const screen of ['landing', 'login', 'signup', 'not-found']) {
    assert.equal(isUtility(screen), false, `Expected ${screen} not to be a utility screen`);
  }
});

test('isImmediateGuestRoute bypasses session loading block for auth and utility routes', () => {
  const isImmediate = (appRouting as Record<string, any>).isImmediateGuestRoute;
  assert.equal(typeof isImmediate, 'function', 'isImmediateGuestRoute must be exported');

  for (const screen of ['login', 'signup', 'privacy', 'terms', 'refund', 'cookies', 'unsubscribe']) {
    assert.equal(isImmediate(screen), true, `Expected ${screen} to render immediately without waiting on session`);
  }
  for (const screen of ['landing', 'not-found']) {
    assert.equal(isImmediate(screen), false, `Expected ${screen} not to be an immediate guest route`);
  }
});

test('resolveSignedInViewPriority prioritizes utility views even during verification or profile setup', () => {
  const resolvePriority = (appRouting as Record<string, any>).resolveSignedInViewPriority;
  assert.equal(typeof resolvePriority, 'function', 'resolveSignedInViewPriority must be exported');

  assert.equal(
    resolvePriority({ hasAuthUser: true, emailVerified: false, hasProfile: false, signedInUtilityView: 'cookies' }),
    'utility',
  );
  assert.equal(
    resolvePriority({ hasAuthUser: true, emailVerified: true, hasProfile: false, signedInUtilityView: 'privacy' }),
    'utility',
  );
  assert.equal(
    resolvePriority({ hasAuthUser: true, emailVerified: true, hasProfile: true, signedInUtilityView: 'terms' }),
    'utility',
  );
  assert.equal(
    resolvePriority({ hasAuthUser: true, emailVerified: false, hasProfile: false, signedInUtilityView: null }),
    'verify-email',
  );
  assert.equal(
    resolvePriority({ hasAuthUser: true, emailVerified: true, hasProfile: false, signedInUtilityView: null }),
    'complete-profile',
  );
  assert.equal(
    resolvePriority({ hasAuthUser: true, emailVerified: true, hasProfile: true, signedInUtilityView: null }),
    'workspace',
  );
  assert.equal(
    resolvePriority({ hasAuthUser: false, emailVerified: false, hasProfile: false, signedInUtilityView: 'cookies' }),
    'guest',
  );
});

test('isClientNavigationClick only intercepts unmodified primary clicks', () => {
  const isClientClick = (appRouting as Record<string, any>).isClientNavigationClick;
  assert.equal(typeof isClientClick, 'function', 'isClientNavigationClick must be exported');

  assert.equal(
    isClientClick({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }),
    true,
  );
  assert.equal(
    isClientClick({ defaultPrevented: true, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }),
    false,
  );
  assert.equal(
    isClientClick({ defaultPrevented: false, button: 1, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }),
    false,
  );
  assert.equal(
    isClientClick({ defaultPrevented: false, button: 0, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }),
    false,
  );
  assert.equal(
    isClientClick({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }),
    false,
  );
  assert.equal(
    isClientClick({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: true, altKey: false }),
    false,
  );
  assert.equal(
    isClientClick({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: true }),
    false,
  );
});
