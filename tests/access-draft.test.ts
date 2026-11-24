import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftChanges,
  draftKey,
  draftSummary,
  historyEntryChanges,
  normalizeDraft,
  permissionEvaluation,
  resetPermission,
  setPermission,
  setPermissionWithReport,
  type AccessDraft,
} from '../src/lib/accessDraft';
import {
  allPermissionKeys,
  groupDescriptions,
  groups,
  permissionCatalog,
  permissionDescription,
  permissionDomains,
  permissionLabel,
  permissionTitle,
  roleDescriptions,
  roles,
} from '../src/lib/accessPolicy';

const initial = (role = 'admin'): AccessDraft => ({
  role,
  approved: true,
  scope: 'all',
  raceIds: [],
  overrides: {},
  status: 'active',
});

test('draft equality ignores race and override ordering', () => {
  assert.equal(
    draftKey({
      ...initial(),
      raceIds: ['b', 'a'],
      overrides: { 'race.view': true, 'race.edit': false },
    }),
    draftKey({
      ...initial(),
      raceIds: ['a', 'b'],
      overrides: { 'race.edit': false, 'race.view': true },
    }),
  );
});

test('enabling dependent permissions also enables prerequisites without mutating baseline', () => {
  const before = initial('runner');
  const after = setPermission(before, 'timing.scan', true);
  assert.equal(after.overrides['timing.scan'], true);
  assert.equal(after.overrides['timing.view'], true);
  assert.deepEqual(before.overrides, {});
});

test('denying a prerequisite disables dependent permissions', () => {
  const after = setPermission(initial(), 'timing.view', false);
  assert.equal(after.overrides['timing.scan'], false);
  assert.equal(after.overrides['timing.view'], false);
});

test('toggling a permission back to its preset removes redundant overrides', () => {
  const disabled = setPermission(initial('admin'), 'race.edit', false);
  assert.equal(disabled.overrides['race.edit'], false);
  const restored = setPermission(disabled, 'race.edit', true);
  assert.equal('race.edit' in restored.overrides, false);
  assert.equal(draftKey(restored), draftKey(initial('admin')));
});

test('reset removes the selected override and restores preset behavior', () => {
  const after = resetPermission(setPermission(initial(), 'race.edit', false), 'race.edit');
  assert.equal('race.edit' in after.overrides, false);
  assert.equal(draftKey(after), draftKey(initial()));
});

test('superadmin drafts always stay locked to full global access without overrides', () => {
  const normalized = normalizeDraft({
    role: 'superadmin',
    approved: false,
    scope: 'selected',
    raceIds: ['race-one'],
    overrides: { 'race.edit': false },
    status: 'active',
  });
  assert.deepEqual(normalized, {
    role: 'superadmin',
    approved: true,
    scope: 'all',
    raceIds: [],
    overrides: {},
    status: 'active',
  });
  const after = setPermission(normalized, 'race.edit', false);
  assert.deepEqual(after.overrides, {});
});

test('review records role, status, selected race set and explicit overrides', () => {
  const after = {
    ...initial('organizer'),
    status: 'suspended',
    scope: 'selected',
    raceIds: ['race-one'],
    overrides: { 'race.edit': false },
  };
  const changes = draftChanges(initial(), after);
  for (const label of ['Role preset', 'Account access', 'Race access', permissionLabel('race.edit')]) {
    assert.ok(changes.some((change) => change.label === label));
  }
});

test('replacing a selected race is reviewable even when counts match', () => {
  assert.equal(
    draftChanges(
      { ...initial(), scope: 'selected', raceIds: ['one'] },
      { ...initial(), scope: 'selected', raceIds: ['two'] },
    ).length,
    1,
  );
});

test('historyEntryChanges summarizes role, scope, status, and permission diffs', () => {
  const diffs = historyEntryChanges(
    {
      role: 'organizer',
      approved: false,
      access: { status: 'active', scope: 'owned-assigned', raceIds: [], overrides: {} },
    },
    {
      role: 'admin',
      approved: true,
      access: {
        status: 'active',
        scope: 'selected',
        raceIds: ['race-one'],
        overrides: { 'highlights.playlist': true },
      },
    },
    { 'race-one': 'Baguio Cordillera 21K' },
  );
  assert.ok(diffs.some((d) => d.label === 'Role preset' && d.before === 'Organizer' && d.after === 'Admin'));
  assert.ok(diffs.some((d) => d.label === 'Race access' && d.after.includes('Baguio Cordillera 21K')));
  assert.ok(diffs.some((d) => d.label === permissionLabel('highlights.playlist')));
});

test('permission catalog covers every key with unique group titles, descriptions, and zero em dashes', () => {
  for (const role of roles) {
    assert.ok(roleDescriptions[role]?.trim().length > 0, `Missing role description for ${role}`);
    assert.equal(roleDescriptions[role].includes('—'), false);
  }
  for (const [group, keys] of Object.entries(groups)) {
    assert.ok(groupDescriptions[group]?.trim().length > 0, `Missing group description for ${group}`);
    assert.equal(groupDescriptions[group].includes('—'), false);
    const seenTitles = new Set<string>();
    for (const key of keys) {
      assert.ok(permissionCatalog[key], `Missing catalog metadata for ${key}`);
      const title = permissionTitle(key);
      const label = permissionLabel(key);
      const description = permissionDescription(key);
      assert.ok(title.length > 0 && description.length > 0, `Incomplete metadata for ${key}`);
      assert.equal(title.includes('—') || label.includes('—') || description.includes('—'), false);
      assert.equal(seenTitles.has(title), false, `Duplicate title "${title}" in group ${group}`);
      seenTitles.add(title);
    }
  }
  assert.equal(Object.keys(permissionCatalog).length, allPermissionKeys.length);
  assert.equal(allPermissionKeys.length, 72);
  for (const domain of permissionDomains) {
    assert.equal(domain.label.includes('—'), false);
  }
  const domainGroups = new Set(permissionDomains.filter((d) => d.id !== 'all').flatMap((d) => d.groups));
  for (const group of ['Badges', 'Clubs', 'Moderation']) {
    assert.ok(domainGroups.has(group), `Missing ${group} in permissionDomains`);
  }
});

test('draftSummary and setPermissionWithReport surface pending approval, suspension, and cascade keys', () => {
  const pendingDraft = { ...initial('organizer'), approved: false };
  const pendingOrg = draftSummary(pendingDraft);
  assert.equal(pendingOrg.pendingApproval, true);
  assert.equal(pendingOrg.effectiveCount, 12);
  assert.ok(pendingOrg.configuredCount > pendingOrg.effectiveCount);
  assert.equal(permissionEvaluation(pendingDraft, 'race.view').blockedBy, 'pending-approval');
  assert.equal(permissionEvaluation(pendingDraft, 'personal.register').effective, true);

  const suspendedSummary = draftSummary({ ...initial('admin'), status: 'suspended' });
  assert.equal(suspendedSummary.suspended, true);
  assert.equal(suspendedSummary.effectiveCount, 0);
  assert.equal(permissionEvaluation({ ...initial('admin'), status: 'suspended' }, 'race.view').blockedBy, 'suspended');

  const cascade = setPermissionWithReport(initial('runner'), 'payment.confirm', true);
  assert.ok(cascade.changedKeys.includes('payment.confirm'));
  assert.ok(cascade.changedKeys.includes('roster.view'));
});
