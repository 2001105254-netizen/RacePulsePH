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
test('highlights permissions are toggleable with dependency enforcement across roles', () => {
  assert.equal(defaults('admin')['highlights.view'], true);
  assert.equal(defaults('admin')['highlights.manage'], true);
  assert.equal(defaults('admin')['highlights.settings'], true);
  assert.equal(defaults('admin')['highlights.playlist'], false);
  assert.equal(defaults('organizer')['highlights.view'], false);
  assert.equal(defaults('superadmin')['highlights.playlist'], true);

  // Admin can be toggled on for playlist or off for highlights management
  const adminWithPlaylist = { role: 'admin', status: 'active', scope: 'all', raceIds: [], overrides: { 'highlights.playlist': true } };
  assert.equal(can({ uid: 'a1', role: 'admin', approved: true }, adminWithPlaylist, 'highlights.playlist'), true);

  const adminWithoutManage = { role: 'admin', status: 'active', scope: 'all', raceIds: [], overrides: { 'highlights.manage': false } };
  assert.equal(can({ uid: 'a2', role: 'admin', approved: true }, adminWithoutManage, 'highlights.manage'), false);
  assert.equal(can({ uid: 'a2', role: 'admin', approved: true }, adminWithoutManage, 'highlights.settings'), true);

  // Disabling highlights.view breaks dependency for manage/settings/playlist
  assert.throws(() => validate({ ...input, role: 'organizer', overrides: { 'highlights.manage': true, 'highlights.view': false } }));
  assert.throws(() => validate({ ...input, role: 'admin', overrides: { 'highlights.playlist': true, 'highlights.settings': false } }));
});

test('route studio permissions enforce view and edit dependencies across roles', () => {
  assert.equal(defaults('runner')['routes.view'], false);
  assert.equal(defaults('organizer')['routes.view'], true);
  assert.equal(defaults('organizer')['routes.publish'], true);
  assert.equal(defaults('admin')['routes.assign'], true);
  assert.throws(() => validate({ ...input, role: 'organizer', overrides: { 'routes.publish': true, 'routes.edit': false } }));
  assert.throws(() => validate({ ...input, role: 'organizer', overrides: { 'routes.assign': true, 'race.view': false } }));
});

test('event analytics and standalone bib studio permissions follow role defaults and dependencies', () => {
  assert.equal(defaults('superadmin')['race.analytics'], true);
  assert.equal(defaults('admin')['race.analytics'], true);
  assert.equal(defaults('organizer')['race.analytics'], true);
  assert.equal(defaults('runner')['race.analytics'], false);
  assert.throws(() => validate({ ...input, role: 'admin', overrides: { 'race.analytics': true, 'race.view': false } }));

  assert.equal(defaults('superadmin')['bibs.studio'], true);
  assert.equal(defaults('admin')['bibs.studio'], false);
  assert.equal(defaults('organizer')['bibs.studio'], false);
  assert.equal(defaults('runner')['bibs.studio'], false);

  const delegatedStudio = validate({ ...input, role: 'runner', scope: 'owned-assigned', raceIds: [], overrides: { 'bibs.studio': true } });
  assert.equal(can({ uid: 'r1', role: 'runner', approved: true }, delegatedStudio, 'bibs.studio'), true);
});

test('badges, clubs, moderation, and extended personal permissions enforce defaults and dependencies', () => {
  const newKeys = [
    'badges.view',
    'badges.manage',
    'badges.grant',
    'clubs.view',
    'clubs.manage',
    'moderation.manage',
    'personal.record',
    'personal.social',
    'personal.clubs',
    'personal.inbox',
  ];
  assert.equal(keys.length, 72);
  for (const key of newKeys) {
    assert.ok(keys.includes(key), `Missing permission key: ${key}`);
  }

  for (const key of ['badges.view', 'badges.manage', 'badges.grant', 'clubs.view', 'clubs.manage', 'moderation.manage']) {
    assert.equal(defaults('superadmin')[key], true, `superadmin should default ${key} to true`);
    assert.equal(defaults('admin')[key], true, `admin should default ${key} to true`);
    assert.equal(defaults('organizer')[key], false, `organizer should default ${key} to false`);
    assert.equal(defaults('runner')[key], false, `runner should default ${key} to false`);
  }

  for (const key of ['personal.record', 'personal.social', 'personal.clubs', 'personal.inbox']) {
    assert.equal(defaults('superadmin')[key], true, `superadmin should default ${key} to true`);
    assert.equal(defaults('admin')[key], false, `admin should default ${key} to false`);
    assert.equal(defaults('organizer')[key], true, `organizer should default ${key} to true`);
    assert.equal(defaults('runner')[key], true, `runner should default ${key} to true`);
  }

  const orgUser = { uid: 'org1', role: 'organizer', approved: true };
  const orgState = { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} };
  assert.equal(can(orgUser, orgState, 'badges.manage'), false);
  assert.equal(can(orgUser, orgState, 'clubs.manage'), false);
  assert.equal(can(orgUser, orgState, 'moderation.manage'), false);

  assert.throws(() => validate({ ...input, role: 'organizer', overrides: { 'badges.manage': true } }));
  assert.throws(() => validate({ ...input, role: 'organizer', overrides: { 'badges.grant': true } }));
  assert.throws(() => validate({ ...input, role: 'organizer', overrides: { 'clubs.manage': true } }));
  assert.throws(() => validate({ ...input, role: 'admin', overrides: { 'badges.manage': true, 'badges.view': false } }));
  assert.throws(() => validate({ ...input, role: 'admin', overrides: { 'badges.grant': true, 'badges.view': false } }));
  assert.throws(() => validate({ ...input, role: 'admin', overrides: { 'clubs.manage': true, 'clubs.view': false } }));

  const orgWithBadges = validate({ ...input, role: 'organizer', overrides: { 'badges.view': true, 'badges.manage': true } });
  assert.equal(can(orgUser, orgWithBadges, 'badges.manage'), true);
  const orgWithModeration = validate({ ...input, role: 'organizer', overrides: { 'moderation.manage': true } });
  assert.equal(can(orgUser, orgWithModeration, 'moderation.manage'), true);
});
