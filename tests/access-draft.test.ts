import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftChanges, draftKey, resetPermission, setPermission, type AccessDraft } from '../src/lib/accessDraft';
const initial = (role = 'admin'): AccessDraft => ({ role, approved: true, scope: 'all', raceIds: [], overrides: {}, status: 'active' });
test('draft equality ignores race and override ordering', () => {
  assert.equal(draftKey({...initial(),raceIds:['b','a'],overrides:{'race.view':true,'race.edit':false}}),draftKey({...initial(),raceIds:['a','b'],overrides:{'race.edit':false,'race.view':true}}));
});
test('enabling dependent permissions also enables prerequisites without mutating baseline', () => {
  const before = initial('runner'); const after = setPermission(before,'timing.scan',true);
  assert.equal(after.overrides['timing.scan'],true);assert.equal(after.overrides['timing.view'],true);assert.deepEqual(before.overrides,{});
});
test('denying a prerequisite disables dependent permissions', () => {
  const after = setPermission(initial(),'timing.view',false);
  assert.equal(after.overrides['timing.scan'],false);assert.equal(after.overrides['timing.view'],false);
});
test('reset removes the selected override and restores preset behavior', () => {
  const after = resetPermission(setPermission(initial(),'race.edit',false),'race.edit');
  assert.equal('race.edit' in after.overrides,false);assert.equal(draftKey(after),draftKey(initial()));
});
test('review records role, status, selected race set and explicit overrides', () => {
  const after = {...initial('organizer'),status:'suspended',scope:'selected',raceIds:['race-one'],overrides:{'race.edit':false}};
  const changes = draftChanges(initial(),after);
  for (const label of ['Role preset','Account access','Race access','Race — Edit']) assert.ok(changes.some(change=>change.label===label));
});
test('replacing a selected race is reviewable even when counts match', () => {
  assert.equal(draftChanges({...initial(),scope:'selected',raceIds:['one']},{...initial(),scope:'selected',raceIds:['two']}).length,1);
});
