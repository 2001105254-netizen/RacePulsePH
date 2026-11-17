import { allPermissionKeys, defaults, dependencies, permissionLabel, roleLabel } from './accessPolicy';

export interface AccessDraft {
  role: string;
  approved: boolean;
  scope: string;
  raceIds: string[];
  overrides: Record<string, boolean>;
  status: string;
}

export interface AccessHistorySnapshot {
  role: string;
  approved?: boolean;
  access?: {
    status?: string;
    scope?: string;
    raceIds?: string[];
    overrides?: Record<string, boolean>;
  };
}

export interface PermissionEvaluation {
  configured: boolean;
  effective: boolean;
  isOverride: boolean;
  blockedBy: 'suspended' | 'pending-approval' | 'dependency' | null;
}

export interface DraftSummary {
  totalCount: number;
  configuredCount: number;
  effectiveCount: number;
  overrideCount: number;
  suspended: boolean;
  pendingApproval: boolean;
}

export function normalizeDraft(draft: AccessDraft): AccessDraft {
  const preset = defaults(draft.role);
  if (draft.role === 'superadmin') {
    return {
      ...draft,
      approved: true,
      scope: 'all',
      raceIds: [],
      overrides: {},
    };
  }
  const overrides: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(draft.overrides || {})) {
    if (typeof value === 'boolean' && value !== (preset[key] === true)) {
      overrides[key] = value;
    }
  }
  return {
    ...draft,
    raceIds: draft.scope === 'selected' ? [...new Set(draft.raceIds)] : [],
    overrides,
  };
}

export function draftKey(draft: AccessDraft) {
  return JSON.stringify({
    ...draft,
    raceIds: [...new Set(draft.raceIds)].sort(),
    overrides: Object.fromEntries(
      Object.entries(draft.overrides).sort(([a], [b]) => a.localeCompare(b)),
    ),
  });
}

export function setPermissionWithReport(
  draft: AccessDraft,
  key: string,
  value: boolean,
): { draft: AccessDraft; changedKeys: string[] } {
  if (draft.role === 'superadmin') {
    return { draft: { ...draft, overrides: {} }, changedKeys: [] };
  }
  const base = defaults(draft.role);
  const prevConfigured = (permKey: string) =>
    permKey in draft.overrides ? draft.overrides[permKey] : base[permKey] === true;
  const overrides: Record<string, boolean> = { ...draft.overrides, [key]: value };
  const adjust = (permission: string, enabled: boolean) => {
    if ((overrides[permission] ?? base[permission]) !== enabled) {
      overrides[permission] = enabled;
    }
  };
  const seen = new Set<string>();
  const visit = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    if (value) {
      for (const dep of dependencies[current] || []) {
        adjust(dep, true);
        visit(dep);
      }
    } else {
      for (const [action, deps] of Object.entries(dependencies)) {
        if (deps.includes(current)) {
          adjust(action, false);
          visit(action);
        }
      }
    }
  };
  visit(key);
  for (const [permKey, permValue] of Object.entries(overrides)) {
    if (permValue === (base[permKey] === true)) {
      delete overrides[permKey];
    }
  }
  const changedKeys = allPermissionKeys.filter((permKey) => {
    const nextVal = permKey in overrides ? overrides[permKey] : base[permKey] === true;
    return nextVal !== prevConfigured(permKey);
  });
  return { draft: { ...draft, overrides }, changedKeys };
}

export function setPermission(draft: AccessDraft, key: string, value: boolean): AccessDraft {
  return setPermissionWithReport(draft, key, value).draft;
}

export function permissionEvaluation(draft: AccessDraft, key: string): PermissionEvaluation {
  const isSuperAdmin = draft.role === 'superadmin';
  const preset = defaults(draft.role);
  const isOverride = !isSuperAdmin && key in draft.overrides;
  const configured = isSuperAdmin ? true : (draft.overrides[key] ?? preset[key] === true);
  if (draft.status === 'suspended') {
    return { configured, effective: false, isOverride, blockedBy: 'suspended' };
  }
  if (!isSuperAdmin && draft.role === 'organizer' && !draft.approved && !key.startsWith('personal.')) {
    return { configured, effective: false, isOverride, blockedBy: 'pending-approval' };
  }
  const depsOk = isSuperAdmin
    ? true
    : (dependencies[key] || []).every((dep) => (draft.overrides[dep] ?? preset[dep] === true));
  if (!depsOk) {
    return { configured, effective: false, isOverride, blockedBy: configured ? 'dependency' : null };
  }
  return { configured, effective: configured, isOverride, blockedBy: null };
}

export function draftSummary(draft: AccessDraft): DraftSummary {
  const isSuperAdmin = draft.role === 'superadmin';
  let configuredCount = 0;
  let effectiveCount = 0;
  for (const key of allPermissionKeys) {
    const ev = permissionEvaluation(draft, key);
    if (ev.configured) configuredCount += 1;
    if (ev.effective) effectiveCount += 1;
  }
  return {
    totalCount: allPermissionKeys.length,
    configuredCount,
    effectiveCount,
    overrideCount: isSuperAdmin ? 0 : Object.keys(draft.overrides).length,
    suspended: draft.status === 'suspended',
    pendingApproval: !isSuperAdmin && draft.role === 'organizer' && !draft.approved,
  };
}

export function resetPermission(draft: AccessDraft, key: string): AccessDraft {
  const next = setPermission(draft, key, defaults(draft.role)[key] === true);
  delete next.overrides[key];
  return next;
}

export const scopeLabel = (scope: string) =>
  ({
    all: 'All races',
    selected: 'Selected races',
    'owned-assigned': 'Owned + assigned races',
  })[scope] || scope;

const statusLabel = (status: string) => (status === 'suspended' ? 'Suspended' : 'Active');

export function draftChanges(
  before: AccessDraft,
  after: AccessDraft,
  raceNames: Record<string, string> = {},
): { label: string; before: string; after: string }[] {
  const changes: { label: string; before: string; after: string }[] = [];
  if (before.role !== after.role) {
    changes.push({ label: 'Role preset', before: roleLabel(before.role), after: roleLabel(after.role) });
  }
  if (before.status !== after.status) {
    changes.push({ label: 'Account access', before: statusLabel(before.status), after: statusLabel(after.status) });
  }
  if (after.role === 'organizer' && before.approved !== after.approved) {
    changes.push({
      label: 'Organizer approval',
      before: before.approved ? 'Approved' : 'Pending',
      after: after.approved ? 'Approved' : 'Pending',
    });
  }
  const describeRaces = (draft: AccessDraft) =>
    scopeLabel(draft.scope) +
    (draft.scope === 'selected'
      ? `: ${draft.raceIds.map((id) => raceNames[id] || id).join(', ') || 'None'}`
      : '');
  if (
    before.scope !== after.scope ||
    (after.scope === 'selected' &&
      JSON.stringify([...before.raceIds].sort()) !== JSON.stringify([...after.raceIds].sort()))
  ) {
    changes.push({ label: 'Race access', before: describeRaces(before), after: describeRaces(after) });
  }
  const describe = (draft: AccessDraft, key: string) =>
    `${(draft.overrides[key] ?? defaults(draft.role)[key]) ? 'On' : 'Off'} · ${
      key in draft.overrides ? 'Custom' : 'Preset'
    }`;
  for (const key of new Set([...Object.keys(before.overrides), ...Object.keys(after.overrides)])) {
    if (describe(before, key) !== describe(after, key)) {
      changes.push({
        label: permissionLabel(key),
        before: describe(before, key),
        after: describe(after, key),
      });
    }
  }
  return changes;
}

function historySnapshotToDraft(snapshot: AccessHistorySnapshot): AccessDraft {
  const role = snapshot.role || 'runner';
  return normalizeDraft({
    role,
    approved: snapshot.approved ?? role !== 'organizer',
    scope: snapshot.access?.scope || (['admin', 'superadmin'].includes(role) ? 'all' : 'owned-assigned'),
    raceIds: Array.isArray(snapshot.access?.raceIds) ? snapshot.access.raceIds : [],
    overrides:
      snapshot.access?.overrides && typeof snapshot.access.overrides === 'object'
        ? snapshot.access.overrides
        : {},
    status: snapshot.access?.status || 'active',
  });
}

export function historyEntryChanges(
  before: AccessHistorySnapshot,
  after: AccessHistorySnapshot,
  raceNames: Record<string, string> = {},
) {
  return draftChanges(historySnapshotToDraft(before), historySnapshotToDraft(after), raceNames);
}
