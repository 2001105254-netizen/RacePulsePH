const roles = ['runner', 'organizer', 'admin', 'superadmin'];
const groups = {
  Events: ['race.view', 'race.create', 'race.edit', 'race.categories', 'race.registration', 'race.artwork', 'race.bibs', 'race.team'],
  Roster: ['roster.view', 'roster.add', 'roster.import', 'roster.edit', 'roster.chips', 'roster.bibs', 'roster.kits', 'roster.slots', 'roster.remove'],
  Payments: ['revenue.view', 'payment.configure', 'payment.confirm'],
  Timing: ['timing.view', 'timing.scan', 'timing.manual', 'timing.correct', 'timing.start', 'timing.reset', 'timing.finish', 'timing.reopen'],
  Results: ['results.view', 'results.publish', 'results.export', 'hub.manage', 'hub.publish', 'roster.export', 'bibs.export'],
  Engraving: ['engraving.view', 'engraving.create', 'engraving.status', 'engraving.export', 'engraving.backup'],
  Personal: ['personal.register', 'personal.checkout', 'personal.results', 'personal.bibs', 'personal.certificates', 'personal.engraving', 'personal.friends', 'personal.invites'],
  Directories: ['users.view'],
};
const keys = Object.values(groups).flat();
function defaults(role) {
  return Object.fromEntries(keys.map(key => [key,
    role === 'superadmin' || (role === 'admin' && !key.startsWith('personal.')) ||
    (role === 'organizer' && !key.startsWith('engraving.') && key !== 'users.view' && key !== 'timing.correct') ||
    (role === 'runner' && key.startsWith('personal.'))]));
}
function effective(role, access = {}) {
  const result = defaults(role);
  for (const key of keys) if (typeof access.overrides?.[key] === 'boolean') result[key] = access.overrides[key];
  if (access.status === 'suspended') for (const key of keys) result[key] = false;
  return result;
}
const dependencies = Object.fromEntries(keys.filter(k => !k.startsWith('personal.') && !k.endsWith('.view') && k !== 'race.create' && k !== 'users.view').map(k => [k,
  k.startsWith('engraving.') ? ['engraving.view'] : k.startsWith('roster.') || k.startsWith('payment.confirm') ? ['roster.view'] : ['race.view']]));
Object.assign(dependencies, { 'timing.view': ['roster.view', 'race.view'], 'timing.scan': ['timing.view'], 'timing.manual': ['timing.scan'], 'results.view': ['timing.view'], 'results.publish': ['results.view'], 'timing.finish': ['results.publish'], 'revenue.view': ['roster.view'] });
Object.assign(dependencies, { 'personal.checkout': ['personal.register'], 'personal.certificates': ['personal.results'], 'personal.invites': ['personal.friends'] });
function accessFor(user, access = {}) {
  return { schemaVersion: 1, presetVersion: 1, revision: 0, scope: ['admin', 'superadmin'].includes(user.role) ? 'all' : 'owned-assigned', raceIds: [], status: 'active', overrides: {}, ...access };
}
function can(user, access, action) {
  if (!user || !roles.includes(user.role)) return false;
  const state = accessFor(user, access);
  if (state.status !== 'active') return false;
  if (!action.startsWith('personal.') && user.role === 'organizer' && !user.approved) return false;
  const permissions = effective(user.role, state);
  return permissions[action] === true && (dependencies[action] || []).every(key => permissions[key] === true);
}
function inScope(user, access, race) {
  if (!user || !race) return false;
  const state = accessFor(user, access);
  return state.status === 'active' && (state.scope === 'all' || (state.scope === 'selected' && state.raceIds.includes(race.id)) ||
    (state.scope === 'owned-assigned' && (race.createdBy === user.uid || (race.organizerIds || []).includes(user.uid))));
}
function isAuthority(user, access) { return user?.role === 'superadmin' && accessFor(user, access).status === 'active'; }
function validate(input) {
  if (!roles.includes(input.role)) throw new Error('Invalid role.');
  if (!['active', 'suspended'].includes(input.status)) throw new Error('Invalid access status.');
  if (!['owned-assigned', 'selected', 'all'].includes(input.scope)) throw new Error('Invalid race scope.');
  if (!Array.isArray(input.raceIds) || input.raceIds.length > 100 || input.raceIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id))) throw new Error('Invalid race selection.');
  if (!input.overrides || typeof input.overrides !== 'object' || Array.isArray(input.overrides)) throw new Error('Invalid overrides.');
  for (const [key, value] of Object.entries(input.overrides)) if (!keys.includes(key) || typeof value !== 'boolean') throw new Error('Unknown permission or invalid value.');
  if (!Number.isInteger(input.revision) || input.revision < 0) throw new Error('Invalid revision.');
  if (input.approved !== undefined && typeof input.approved !== 'boolean') throw new Error('Invalid approval.');
  const resolved = effective(input.role, input);
  for (const [key, required] of Object.entries(dependencies)) if (resolved[key] && required.some(dep => !resolved[dep])) throw new Error(`${key} requires ${required.join(', ')}.`);
  return { schemaVersion: 1, presetVersion: 1, overrides: input.overrides, scope: input.scope, raceIds: [...new Set(input.raceIds)], status: input.status };
}
module.exports = { roles, groups, keys, defaults, effective, validate, dependencies, accessFor, can, inScope, isAuthority };
