import { defaults, dependencies, permissionLabel, roleLabel } from './accessPolicy';
export interface AccessDraft { role: string; approved: boolean; scope: string; raceIds: string[]; overrides: Record<string, boolean>; status: string }
export function draftKey(draft: AccessDraft) { return JSON.stringify({ ...draft, raceIds: [...new Set(draft.raceIds)].sort(), overrides: Object.fromEntries(Object.entries(draft.overrides).sort(([a], [b]) => a.localeCompare(b))) }); }
export function setPermission(draft: AccessDraft, key: string, value: boolean): AccessDraft {
  const overrides = { ...draft.overrides, [key]: value };
  const preset = defaults(draft.role);
  const adjust = (permission: string, enabled: boolean) => { if ((overrides[permission] ?? preset[permission]) !== enabled) overrides[permission] = enabled; };
  const seen = new Set<string>();
  const visit = (current: string) => {
    if (seen.has(current)) return; seen.add(current);
    if (value) for (const dep of dependencies[current] || []) { adjust(dep, true); visit(dep); }
    else for (const [action, deps] of Object.entries(dependencies)) if (deps.includes(current)) { adjust(action, false); visit(action); }
  };
  visit(key); return { ...draft, overrides };
}
export function resetPermission(draft: AccessDraft, key: string): AccessDraft { const next = setPermission(draft, key, defaults(draft.role)[key] === true); delete next.overrides[key]; return next; }
export const scopeLabel = (scope: string) => ({ all: 'All races', selected: 'Selected races', 'owned-assigned': 'Owned + assigned races' })[scope] || scope;
export function draftChanges(before: AccessDraft, after: AccessDraft, raceNames: Record<string,string> = {}): { label: string; before: string; after: string }[] {
  const changes: { label: string; before: string; after: string }[] = [];
  if (before.role !== after.role) changes.push({ label: 'Role preset', before: roleLabel(before.role), after: roleLabel(after.role) });
  if (before.status !== after.status) changes.push({ label: 'Account access', before: before.status, after: after.status });
  if (after.role === 'organizer' && before.approved !== after.approved) changes.push({ label: 'Organizer approval', before: before.approved ? 'Approved' : 'Pending', after: after.approved ? 'Approved' : 'Pending' });
  const describeRaces = (draft: AccessDraft) => scopeLabel(draft.scope) + (draft.scope === 'selected' ? `: ${draft.raceIds.map(id => raceNames[id] || id).join(', ') || 'None'}` : '');
  if (before.scope !== after.scope || (after.scope === 'selected' && JSON.stringify([...before.raceIds].sort()) !== JSON.stringify([...after.raceIds].sort()))) changes.push({ label: 'Race access', before: describeRaces(before), after: describeRaces(after) });
  const describe = (draft: AccessDraft, key: string) => `${(draft.overrides[key] ?? defaults(draft.role)[key]) ? 'On' : 'Off'} · ${key in draft.overrides ? 'Custom' : 'Preset'}`;
  for (const key of new Set([...Object.keys(before.overrides), ...Object.keys(after.overrides)])) if (describe(before, key) !== describe(after, key)) changes.push({ label: permissionLabel(key), before: describe(before, key), after: describe(after, key) });
  return changes;
}
