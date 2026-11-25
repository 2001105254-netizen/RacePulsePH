import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANDROID_GUIDE_STEPS,
  ANDROID_GUIDE_STORAGE_PREFIX,
  androidGuideStorageKey,
  computeSpotlightPlacement,
  hasCompletedAndroidGuide,
  isAndroidGuideEnabled,
  markAndroidGuideCompleted,
  resetAndroidGuide,
  shouldAutoLaunchAndroidGuide,
} from '../src/lib/androidGuide.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function createThrowingStorage(): Storage {
  return {
    length: 0,
    clear() {
      throw new Error('Storage disabled');
    },
    getItem() {
      throw new Error('Storage disabled');
    },
    key() {
      return null;
    },
    removeItem() {
      throw new Error('Storage disabled');
    },
    setItem() {
      throw new Error('Storage disabled');
    },
  };
}

test('ANDROID_GUIDE_STEPS defines 5 canonical steps without em dashes', () => {
  assert.deepEqual(
    ANDROID_GUIDE_STEPS.map((s) => s.id),
    ['explore', 'register', 'details', 'payment', 'passes'],
  );
  ANDROID_GUIDE_STEPS.forEach((step, index) => {
    assert.equal(step.stepNumber, index + 1);
    assert.ok(step.title.length > 0);
    assert.ok(step.body.length > 0);
    assert.equal(step.title.includes('—'), false, `Step ${step.id} title contains forbidden em dash`);
    assert.equal(step.body.includes('—'), false, `Step ${step.id} body contains forbidden em dash`);
  });
});

test('androidGuideStorageKey builds prefix with trimmed UID', () => {
  assert.equal(androidGuideStorageKey('runner_123'), `${ANDROID_GUIDE_STORAGE_PREFIX}runner_123`);
  assert.equal(androidGuideStorageKey('  runner_abc  '), `${ANDROID_GUIDE_STORAGE_PREFIX}runner_abc`);
  assert.equal(androidGuideStorageKey('   '), '');
});

test('guide completion persistence reads, writes, resets, and tolerates restricted storage', () => {
  const storage = createMemoryStorage();
  assert.equal(hasCompletedAndroidGuide('u1', storage), false);

  assert.equal(markAndroidGuideCompleted('u1', 'completed', storage), true);
  assert.equal(hasCompletedAndroidGuide('u1', storage), true);
  assert.equal(hasCompletedAndroidGuide('u2', storage), false);

  assert.equal(resetAndroidGuide('u1', storage), true);
  assert.equal(hasCompletedAndroidGuide('u1', storage), false);

  assert.equal(markAndroidGuideCompleted('u1', 'skipped', storage), true);
  assert.equal(hasCompletedAndroidGuide('u1', storage), true);

  assert.equal(markAndroidGuideCompleted('  ', 'completed', storage), false);
  assert.equal(resetAndroidGuide('  ', storage), false);

  const throwing = createThrowingStorage();
  assert.equal(hasCompletedAndroidGuide('u1', throwing), false);
  assert.equal(markAndroidGuideCompleted('u1', 'completed', throwing), false);
  assert.equal(resetAndroidGuide('u1', throwing), false);
});

test('shouldAutoLaunchAndroidGuide enforces Android-only, auth/load readiness, and unblocked state', () => {
  const base = {
    isAndroid: true,
    uid: 'runner_1',
    hasCompleted: false,
    canRegister: true,
    hasExploreTab: true,
    profilesLoaded: true,
    blocked: false,
  };

  assert.equal(shouldAutoLaunchAndroidGuide(base), true);
  assert.equal(shouldAutoLaunchAndroidGuide({ ...base, isAndroid: false }), false);
  assert.equal(shouldAutoLaunchAndroidGuide({ ...base, hasCompleted: true }), false);
  assert.equal(shouldAutoLaunchAndroidGuide({ ...base, profilesLoaded: false }), false);
  assert.equal(shouldAutoLaunchAndroidGuide({ ...base, blocked: true }), false);
  assert.equal(shouldAutoLaunchAndroidGuide({ ...base, canRegister: false }), false);
  assert.equal(shouldAutoLaunchAndroidGuide({ ...base, hasExploreTab: false }), false);
  assert.equal(shouldAutoLaunchAndroidGuide({ ...base, uid: '   ' }), false);
});

test('computeSpotlightPlacement handles null or zero-area target rects safely', () => {
  assert.deepEqual(
    computeSpotlightPlacement(null, { width: 390, height: 844 }),
    { cardPlacement: 'center', spotlightBox: null, cursorPoint: null },
  );
  assert.deepEqual(
    computeSpotlightPlacement({ left: 10, top: 10, width: 0, height: 44 }, { width: 390, height: 844 }),
    { cardPlacement: 'center', spotlightBox: null, cursorPoint: null },
  );
  assert.deepEqual(
    computeSpotlightPlacement({ left: 10, top: 10, width: 80, height: 0 }, { width: 390, height: 844 }),
    { cardPlacement: 'center', spotlightBox: null, cursorPoint: null },
  );
});

test('computeSpotlightPlacement docks guide card opposite the target and clamps spotlight/cursor inside viewport', () => {
  // BottomNav Explore tab in bottom half -> card docks at top
  const bottomTarget = computeSpotlightPlacement(
    { left: 78, top: 786, width: 76, height: 48 },
    { width: 390, height: 844 },
  );
  assert.equal(bottomTarget.cardPlacement, 'top');
  assert.ok(bottomTarget.spotlightBox);
  assert.ok(bottomTarget.cursorPoint);
  assert.equal(bottomTarget.spotlightBox.left, 72);
  assert.equal(bottomTarget.spotlightBox.top, 780);
  assert.equal(bottomTarget.spotlightBox.width, 88);
  assert.equal(bottomTarget.spotlightBox.height, 60);
  assert.ok(bottomTarget.cursorPoint.x >= 78 && bottomTarget.cursorPoint.x <= 154);
  assert.ok(bottomTarget.cursorPoint.y >= 786 && bottomTarget.cursorPoint.y <= 834);

  // Upper Register button -> card docks at bottom thumb zone
  const topTarget = computeSpotlightPlacement(
    { left: 200, top: 180, width: 150, height: 44 },
    { width: 390, height: 844 },
  );
  assert.equal(topTarget.cardPlacement, 'bottom');
  assert.ok(topTarget.spotlightBox);
  assert.ok(topTarget.cursorPoint);
  assert.ok(topTarget.cursorPoint.x <= 390 - 24);
  assert.ok(topTarget.cursorPoint.y <= 844 - 24);

  // Narrow 320x568 & landscape 844x390 edge clamping
  const edgeTarget = computeSpotlightPlacement(
    { left: 2, top: 340, width: 316, height: 48 },
    { width: 320, height: 568 },
  );
  assert.ok(edgeTarget.spotlightBox);
  assert.ok(edgeTarget.spotlightBox.left >= 0);
  assert.ok(edgeTarget.spotlightBox.left + edgeTarget.spotlightBox.width <= 320);
  assert.ok(edgeTarget.cursorPoint);
  assert.ok(edgeTarget.cursorPoint.x >= 8 && edgeTarget.cursorPoint.x <= 296);

  const landscapeTarget = computeSpotlightPlacement(
    { left: 10, top: 80, width: 56, height: 48 },
    { width: 844, height: 390 },
  );
  assert.equal(landscapeTarget.cardPlacement, 'bottom');
  assert.ok(landscapeTarget.spotlightBox);
  assert.ok(landscapeTarget.spotlightBox.top + landscapeTarget.spotlightBox.height <= 390);
});

test('isAndroidGuideEnabled is strictly Android-native in production and previewable only in dev', () => {
  assert.equal(isAndroidGuideEnabled({ isAndroidNative: true, isDev: false, sessionFlag: null, search: '' }), true);
  assert.equal(isAndroidGuideEnabled({ isAndroidNative: false, isDev: false, sessionFlag: '1', search: '?previewAndroidGuide=1' }), false);
  assert.equal(isAndroidGuideEnabled({ isAndroidNative: false, isDev: true, sessionFlag: null, search: '' }), false);
  assert.equal(isAndroidGuideEnabled({ isAndroidNative: false, isDev: true, sessionFlag: '1', search: '' }), true);
  assert.equal(isAndroidGuideEnabled({ isAndroidNative: false, isDev: true, sessionFlag: null, search: '?previewAndroidGuide=1' }), true);
});
