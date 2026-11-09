const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaults, effective, validate, keys, can, inScope } = require('../functions/access-policy');
test('browser preset bundle matches authoritative policy', () => {
  const catalog = require('../src/lib/access-presets.json');
  for (const role of catalog.roles) assert.deepEqual(catalog.presets[role], defaults(role));
});
test('runner preset never includes operational access', () => {
  for (const key of keys) assert.equal(defaults('runner')[key], key.startsWith('personal.'));
});
test('explicit denial overrides administrator default', () => {
  assert.equal(defaults('admin')['timing.scan'], true);
  assert.equal(effective('admin', { overrides: { 'timing.scan': false } })['timing.scan'], false);
});
test('Super Admin retains global access despite legacy scope or custom deny', () => {
  const user = { uid: 'owner', role: 'superadmin', approved: true };
  const state = { status: 'active', scope: 'selected', raceIds: [], overrides: { 'race.artwork': false, 'race.edit': false } };
  assert.equal(inScope(user, state, { id: 'other_race', createdBy: 'someone_else' }), true);
  assert.equal(can(user, state, 'race.artwork'), true);
  assert.equal(can(user, state, 'race.edit'), true);
});
test('suspension disables every configurable capability', () => {
  assert.ok(Object.values(effective('superadmin', { status: 'suspended' })).every(value => value === false));
});
const input = { role: 'organizer', scope: 'selected', raceIds: ['race_1'], status: 'active', revision: 0, overrides: {} };
test('unknown and protected permissions cannot be injected', () => {
  for (const key of ['access.manage', 'role.change', '__proto__', 'race.delete']) assert.throws(() => validate({ ...input, overrides: JSON.parse(`{"${key}":true}`) }));
});
test('malformed scopes, values, and revisions are rejected', () => {
  for (const patch of [{ role: 'owner' }, { scope: 'everyone' }, { raceIds: ['../users'] }, { status: 'unknown' }, { revision: -1 }, { overrides: { 'timing.scan': 'true' } }]) assert.throws(() => validate({ ...input, ...patch }));
});
test('race assignments are deduplicated and versioned', () => {
  const result = validate({ ...input, raceIds: ['race_1', 'race_1'] });
  assert.deepEqual(result.raceIds, ['race_1']); assert.equal(result.schemaVersion, 1);
});
