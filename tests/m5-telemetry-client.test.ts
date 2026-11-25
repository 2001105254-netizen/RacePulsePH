import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDevE2eTelemetrySnapshot,
  detectClientPlatform,
  formatBytes,
  formatCompactCount,
  shouldSendThrottledHeartbeat,
  triggerPercent,
  triggerStatusLabel,
} from '../src/lib/telemetry/formatters';

test('formatBytes formats byte sizes cleanly across B, KB, MB, and GB', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1_572_864), '1.5 MB');
  assert.equal(formatBytes(2_523_293_286), '2.35 GB');
  assert.equal(formatBytes(-50), '0 B');
  assert.equal(formatBytes(Number.NaN), '0 B');
});

test('formatCompactCount formats counts cleanly across units, K, and M', () => {
  assert.equal(formatCompactCount(0), '0');
  assert.equal(formatCompactCount(999), '999');
  assert.equal(formatCompactCount(1_240), '1.2K');
  assert.equal(formatCompactCount(5_000_000), '5.0M');
});

test('triggerPercent and triggerStatusLabel bound percentages and map statuses cleanly', () => {
  assert.equal(triggerPercent(350, 500), 70);
  assert.equal(triggerPercent(10_000, 500), 999);
  assert.equal(triggerPercent(10, 0), 0);

  assert.equal(triggerStatusLabel('ok'), 'OK');
  assert.equal(triggerStatusLabel('watch'), 'Watch');
  assert.equal(triggerStatusLabel('scale'), 'Scale');
});

test('detectClientPlatform identifies Capacitor native platforms and web fallback', () => {
  assert.equal(detectClientPlatform('Mozilla/5.0 Android', true, 'android'), 'android');
  assert.equal(detectClientPlatform('Mozilla/5.0 iPhone', true, 'ios'), 'ios');
  assert.equal(detectClientPlatform('Mozilla/5.0 Windows', false, 'web'), 'web');
});

test('shouldSendThrottledHeartbeat enforces 15-minute cross-tab interval cleanly', () => {
  const intervalMs = 15 * 60 * 1000;
  const now = 1_700_000_000_000;
  assert.equal(shouldSendThrottledHeartbeat(null, now, intervalMs), true);
  assert.equal(shouldSendThrottledHeartbeat(0, now, intervalMs), true);
  assert.equal(shouldSendThrottledHeartbeat(Number.NaN, now, intervalMs), true);
  assert.equal(shouldSendThrottledHeartbeat(now - intervalMs + 5_000, now, intervalMs), false);
  assert.equal(shouldSendThrottledHeartbeat(now - intervalMs, now, intervalMs), true);
});

test('buildDevE2eTelemetrySnapshot returns deterministic non-empty snapshot with zero PII', () => {
  const snap = buildDevE2eTelemetrySnapshot();
  assert.equal(snap.onlineNow.total > 0, true);
  assert.equal(snap.triggers.length, 4);
  assert.equal(snap.rollups.dailySeries.length, 14);
  assert.equal(snap.firestore.collections.length > 0, true);

  const json = JSON.stringify(snap);
  assert.equal(json.includes('@'), false);
  assert.equal(/"(uid|email|ip)"\s*:/i.test(json), false);
});
