import { formatDateTime } from '../lib/preciseTime';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  History,
  LayoutDashboard,
  LockKeyhole,
  MapPinned,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { Race, UserProfile } from '../types';
import {
  allPermissionKeys,
  defaults,
  groupDescriptions,
  groups,
  permissionDependencies,
  permissionDependents,
  permissionDescription,
  permissionDomains,
  permissionGroup,
  permissionLabel,
  permissionTitle,
  roleDescriptions,
  roleLabel,
  roles,
} from '../lib/accessPolicy';
import {
  AccessDraft,
  draftChanges,
  draftSummary,
  historyEntryChanges,
  normalizeDraft,
  permissionEvaluation,
  resetPermission,
  scopeLabel,
  setPermissionWithReport,
} from '../lib/accessDraft';
import DialogSurface from './ui/DialogSurface';
import { useFeedback } from './ui/FeedbackProvider';
import { Select } from './ui/Select';

export interface AccessHistoryEntry {
  id: string;
  at: string;
  actorName?: string;
  actorUid: string;
  action?: string;
  before: { role: string; approved?: boolean; access?: any };
  after: { role: string; approved?: boolean; access?: any };
}

export interface AccessWorkspaceProps {
  user: UserProfile;
  currentUserUid?: string;
  draft: AccessDraft;
  baseline: AccessDraft;
  races: Pick<Race, 'id' | 'name' | 'date'>[];
  history: AccessHistoryEntry[];
  ready: boolean;
  loaded: boolean;
  dirty: boolean;
  busy: boolean;
  error: string;
  conflicted: boolean;
  historyBusy: boolean;
  historyLoaded: boolean;
  onChange: (draft: AccessDraft) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
  onLoadHistory: () => Promise<void>;
  onRestore: (entry: AccessHistoryEntry) => Promise<void>;
  onRemove?: () => Promise<void>;
}

type EditSection = 'overview' | 'permissions' | 'races' | 'history';
type Section = EditSection | 'review';
type PermissionStateFilter = 'all' | 'enabled' | 'disabled';

const sections = [
  ['overview', 'Overview', LayoutDashboard],
  ['permissions', 'Permissions', Settings2],
  ['races', 'Race access', MapPinned],
  ['history', 'Change history', History],
] as const;

export default function AccessWorkspace(props: AccessWorkspaceProps) {
  const { user, currentUserUid, draft, baseline, onChange, busy } = props;
  const { confirm } = useFeedback();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const main = useRef<HTMLElement>(null);

  const [section, setSection] = useState<Section>('overview');
  const [lastEditSection, setLastEditSection] = useState<EditSection>('overview');
  const [domainFilter, setDomainFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState<PermissionStateFilter>('all');
  const [query, setQuery] = useState('');
  const [onlyOverrides, setOnlyOverrides] = useState(false);
  const [raceQuery, setRaceQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(['Events']));
  const [highlightedPerm, setHighlightedPerm] = useState<string | null>(null);
  const [lastCascade, setLastCascade] = useState<{ previousDraft: AccessDraft; message: string } | null>(null);

  const isSelf = Boolean(currentUserUid && currentUserUid === user.uid);
  const isSuperAdminTarget = draft.role === 'superadmin';
  const base = useMemo(() => defaults(draft.role), [draft.role]);
  const summary = useMemo(() => draftSummary(draft), [draft]);
  const overrides = summary.overrideCount;
  const raceNameMap = useMemo(
    () => Object.fromEntries(props.races.map((race) => [race.id, race.name])),
    [props.races],
  );
  const changes = useMemo(
    () => draftChanges(baseline, draft, raceNameMap),
    [baseline, draft, raceNameMap],
  );

  useEffect(() => {
    if (!highlightedPerm) return;
    const raf = window.requestAnimationFrame(() => {
      const target = document.getElementById(`${id}-perm-${highlightedPerm}`);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target?.focus();
    });
    const timer = window.setTimeout(() => setHighlightedPerm(null), 1800);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [highlightedPerm, id]);

  const navigate = (next: Section) => {
    if (section !== 'review') {
      setLastEditSection(section);
    }
    if (next !== 'review') {
      setLastEditSection(next);
    }
    setSection(next);
    main.current?.scrollTo({ top: 0 });
    main.current?.parentElement?.scrollTo({ top: 0 });
    main.current?.closest('.access-workspace')?.scrollTo({ top: 0 });
    if (next === 'history' && !props.historyLoaded && !props.historyBusy) {
      void props.onLoadHistory();
    }
  };

  const changeRole = async (role: string) => {
    if (role === draft.role || busy) return;
    if (isSelf && role !== 'superadmin') return;
    if (
      overrides > 0 &&
      !(await confirm({
        title: 'Change the role preset?',
        message: `Switching to ${roleLabel(role)} resets ${overrides} individual permission override${
          overrides === 1 ? '' : 's'
        }. Your changes are applied only after you review and save.`,
        confirmLabel: 'Change preset',
        cancelLabel: 'Keep current preset',
      }))
    ) {
      return;
    }
    const nextApproved =
      role === 'organizer' ? (user.role === 'organizer' ? draft.approved : false) : true;
    setLastCascade(null);
    onChange(
      normalizeDraft({
        ...draft,
        role,
        approved: nextApproved,
        overrides: {},
        scope: ['superadmin', 'admin'].includes(role) ? 'all' : 'owned-assigned',
        raceIds: [],
      }),
    );
  };

  const resetAll = async () => {
    if (
      !overrides ||
      isSuperAdminTarget ||
      !(await confirm({
        title: 'Reset custom permissions?',
        message: `The ${roleLabel(draft.role)} preset will replace all ${overrides} permission overrides. Race access and account status stay as shown.`,
        confirmLabel: 'Reset permissions',
        cancelLabel: 'Keep overrides',
      }))
    ) {
      return;
    }
    setLastCascade(null);
    onChange({ ...draft, overrides: {} });
  };

  const handleTogglePermission = (key: string, nextValue: boolean) => {
    const result = setPermissionWithReport(draft, key, nextValue);
    onChange(result.draft);
    const extraKeys = result.changedKeys.filter((item) => item !== key);
    if (extraKeys.length > 0) {
      const sample = extraKeys
        .slice(0, 2)
        .map((item) => permissionTitle(item))
        .join(', ');
      const suffix = extraKeys.length > 2 ? `, +${extraKeys.length - 2} more` : '';
      setLastCascade({
        previousDraft: draft,
        message: `${nextValue ? 'Enabled' : 'Disabled'} ${permissionTitle(key)} and ${extraKeys.length} related ${
          nextValue ? 'prerequisite' : 'dependent'
        }${extraKeys.length === 1 ? '' : 's'} (${sample}${suffix}).`,
      });
    } else {
      setLastCascade(null);
    }
  };

  const jumpToPermission = (targetKey: string) => {
    const targetGroup = permissionGroup(targetKey);
    setDomainFilter('all');
    setStateFilter('all');
    setOnlyOverrides(false);
    setQuery('');
    if (targetGroup) {
      setOpenGroups((prev) => {
        const next = new Set(prev);
        next.add(targetGroup);
        return next;
      });
    }
    setHighlightedPerm(targetKey);
  };

  const activeDomainGroups = useMemo(() => {
    const selectedDomain = permissionDomains.find((item) => item.id === domainFilter);
    return selectedDomain ? new Set(selectedDomain.groups) : null;
  }, [domainFilter]);

  const searchLower = query.trim().toLowerCase();
  const isFiltered =
    Boolean(searchLower) ||
    (onlyOverrides && !isSuperAdminTarget) ||
    domainFilter !== 'all' ||
    stateFilter !== 'all';

  const filteredGroups = useMemo(() => {
    return Object.entries(groups)
      .filter(([group]) => !activeDomainGroups || activeDomainGroups.has(group))
      .map(([group, permissions]) => {
        const visible = permissions.filter((key) => {
          if (onlyOverrides && !isSuperAdminTarget && !(key in draft.overrides)) return false;
          const ev = permissionEvaluation(draft, key);
          if (stateFilter === 'enabled' && !ev.configured) return false;
          if (stateFilter === 'disabled' && ev.configured) return false;
          if (!searchLower) return true;
          const haystack = `${permissionLabel(key)} ${permissionDescription(key)} ${group} ${
            groupDescriptions[group] || ''
          } ${key}`.toLowerCase();
          return haystack.includes(searchLower);
        });
        return { group, permissions, visible };
      })
      .filter((item) => item.visible.length > 0);
  }, [activeDomainGroups, draft, isSuperAdminTarget, onlyOverrides, searchLower, stateFilter]);

  const allVisibleExpanded =
    filteredGroups.length > 0 &&
    filteredGroups.every(({ group }) => isFiltered || openGroups.has(group));

  const toggleAllGroups = () => {
    if (isFiltered) return;
    setOpenGroups((prev) => {
      if (allVisibleExpanded) {
        return new Set();
      }
      const next = new Set(prev);
      for (const { group } of filteredGroups) next.add(group);
      return next;
    });
  };

  const raceSearchLower = raceQuery.trim().toLowerCase();
  const filteredRaces = useMemo(
    () => props.races.filter((race) => race.name.toLowerCase().includes(raceSearchLower)),
    [props.races, raceSearchLower],
  );

  const currentTitle =
    section === 'review'
      ? 'Review your changes'
      : sections.find((item) => item[0] === section)?.[1];

  const headerStatusText = summary.suspended
    ? 'Suspended'
    : summary.pendingApproval
      ? 'Pending approval'
      : `${summary.effectiveCount}/${summary.totalCount} active`;

  const canRemoveAccount =
    Boolean(props.onRemove) &&
    !isSelf &&
    !isSuperAdminTarget &&
    !(user.accessRemoved && baseline.status === 'suspended');

  return (
    <DialogSurface
      className="access-workspace"
      titleId={`${id}-title`}
      onRequestClose={props.onClose}
      initialFocusRef={heading}
    >
      <header className="access-workspace-header">
        <div className="access-workspace-identity">
          <span className="access-avatar" aria-hidden="true">
            {user.displayName?.trim().charAt(0) || 'U'}
          </span>
          <div className="access-identity-text">
            <p className="access-eyebrow">
              Access management <ChevronRight size={13} aria-hidden="true" /> Edit user
            </p>
            <h1 ref={heading} tabIndex={-1} id={`${id}-title`}>
              {user.displayName}
              {isSelf ? ' (You)' : ''}
            </h1>
            <p className="access-email">
              {user.username ? `@${user.username} · ` : ''}
              {user.email}
            </p>
          </div>
        </div>
        <div className="access-header-meta">
          <span className={`access-status ${!summary.suspended && !summary.pendingApproval ? 'is-active' : ''}`}>
            {roleLabel(draft.role)} · {headerStatusText}
          </span>
          <button
            type="button"
            aria-label="Close access editor"
            className="rp-button rp-button-secondary access-close"
            disabled={busy}
            onClick={props.onClose}
          >
            <X size={19} aria-hidden="true" />
            <span>Close editor</span>
          </button>
        </div>
      </header>

      <div className="access-workspace-body">
        <aside className="access-workspace-sidebar">
          <p className="access-eyebrow access-nav-caption">Manage access</p>
          <nav aria-label="Access editor sections">
            {sections.map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                className={`access-section-link ${section === key ? 'is-active' : ''}`}
                aria-current={section === key ? 'page' : undefined}
                onClick={() => navigate(key)}
              >
                <Icon size={20} aria-hidden="true" />
                <span>{label}</span>
                {key === 'permissions' && overrides > 0 && (
                  <span className="access-count">{overrides}</span>
                )}
                {key === 'races' && !isSuperAdminTarget && draft.scope === 'selected' && (
                  <span className="access-count">{draft.raceIds.length}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="access-sidebar-note">
            <ShieldCheck size={22} aria-hidden="true" />
            <strong>Super Admin controls</strong>
            <p>Changes take effect after saving and are recorded in history.</p>
          </div>
        </aside>

        <main ref={main} className="access-workspace-main" aria-label={currentTitle}>
          <div className="access-content">
            <div className="access-section-heading">
              <div>
                <h2>{currentTitle}</h2>
              </div>
              <span className={`access-status ${draft.status === 'active' ? 'is-active' : ''}`}>
                {draft.status === 'active' ? 'Active account' : 'Suspended account'}
              </span>
            </div>

            {!props.loaded && (
              <p role="status" className="access-inline-notice">
                Loading current access settings…
              </p>
            )}
            {!props.ready && props.loaded && (
              <p role="status" className="access-inline-notice">
                Access editing is temporarily unavailable. You can view settings, but changes cannot
                be saved yet.
              </p>
            )}
            {props.error && (
              <div role="alert" className="access-inline-notice is-error">
                <strong>
                  {props.conflicted ? 'Someone updated this account' : 'We couldn’t complete that action'}
                </strong>
                <p>{props.error}</p>
              </div>
            )}

            <fieldset className="access-fields" disabled={!props.loaded || busy}>
              {section === 'overview' && (
                <div className="access-overview-grid">
                  <section className="access-block access-overview-presets">
                    <div className="access-block-heading">
                      <h3>Start with a role preset</h3>
                      <p>Choose a bundle, then customize individual permissions if needed.</p>
                    </div>
                    {isSelf && (
                      <p className="access-inline-notice">
                        You are editing your own Super Admin account. Role demotion and account
                        suspension must be performed by another Super Admin.
                      </p>
                    )}
                    <div className="access-preset-grid" role="radiogroup" aria-label="Role preset">
                      {roles.map((role) => {
                        const presetValues = defaults(role);
                        const enabledCount = allPermissionKeys.filter(
                          (key) => presetValues[key] === true,
                        ).length;
                        const roleDisabled = isSelf && role !== 'superadmin';
                        return (
                          <label
                            key={role}
                            className={`access-preset ${draft.role === role ? 'is-selected' : ''} ${
                              roleDisabled ? 'is-locked' : ''
                            }`}
                          >
                            <input
                              type="radio"
                              name={`${id}-role`}
                              value={role}
                              disabled={roleDisabled}
                              checked={draft.role === role}
                              onChange={() => void changeRole(role)}
                            />
                            <span>
                              <strong>{roleLabel(role)}</strong>
                              <span>{roleDescriptions[role]}</span>
                              <span className="access-preset-count">
                                {enabledCount} of {allPermissionKeys.length} capabilities enabled
                              </span>
                            </span>
                            {draft.role === role && <Check size={20} aria-hidden="true" />}
                          </label>
                        );
                      })}
                    </div>
                  </section>

                  <div className="access-overview-side">
                    <section className="access-overview-card">
                      <div className="access-block-heading">
                        <h3>Account access</h3>
                        <p>Suspending access pauses operational and personal features.</p>
                      </div>
                      <div className="access-field">
                        <label htmlFor={`${id}-account-status`}>Status</label>
                        <Select
                          id={`${id}-account-status`}
                          disabled={isSelf}
                          value={draft.status}
                          onChange={(value) => onChange({ ...draft, status: value })}
                          surface="card"
                          size="lg"
                          options={[
                            { value: 'active', label: 'Active' },
                            { value: 'suspended', label: 'Suspended' },
                          ]}
                        />
                      </div>
                      {draft.role === 'organizer' && (
                        <label className="access-check-row">
                          <input
                            type="checkbox"
                            checked={draft.approved}
                            onChange={(event) =>
                              onChange({ ...draft, approved: event.target.checked })
                            }
                          />
                          <span>
                            <strong>Approved for organizer operations</strong>
                            <span>
                              Personal participation stays available while approval is pending.
                            </span>
                          </span>
                        </label>
                      )}
                      {user.accessRemoved && baseline.status === 'suspended' && (
                        <p className="access-inline-notice">
                          App access was removed for this login. Set Status to Active and save, or
                          restore a prior entry in Change history to reactivate.
                        </p>
                      )}
                      {canRemoveAccount && (
                        <div className="access-remove-row">
                          <div>
                            <strong>Remove app access</strong>
                            <p>Suspends access and blocks this login from recreating an account.</p>
                          </div>
                          <button
                            type="button"
                            className="rp-button rp-button-secondary access-remove-button"
                            disabled={!props.ready || busy || props.conflicted}
                            onClick={async () => {
                              if (
                                props.onRemove &&
                                (await confirm({
                                  title: `Remove ${user.displayName}'s app access?`,
                                  message:
                                    'Access is suspended immediately and this login cannot recreate an account. Existing race data and history stay intact and can be restored later.',
                                  confirmLabel: 'Remove access',
                                  cancelLabel: 'Keep account',
                                  destructive: true,
                                }))
                              ) {
                                await props.onRemove();
                              }
                            }}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                            <span>Remove access</span>
                          </button>
                        </div>
                      )}
                    </section>

                    <section className="access-overview-card access-overview-summary">
                      <div className="access-block-heading">
                        <h3>
                          {isSuperAdminTarget
                            ? 'Full platform capabilities'
                            : 'Effective access summary'}
                        </h3>
                        <p>
                          {summary.suspended
                            ? `Suspended: all ${summary.totalCount} capabilities are paused while status stays Suspended.`
                            : summary.pendingApproval
                              ? `Organizer approval is pending: ${summary.effectiveCount} personal capabilities work now; operational capabilities stay paused until approved.`
                              : isSuperAdminTarget
                                ? `Super Admin includes all ${summary.totalCount} operational and personal capabilities across every race.`
                                : `${summary.effectiveCount} of ${summary.totalCount} capabilities active · ${
                                    overrides
                                      ? `${overrides} custom override${overrides === 1 ? '' : 's'}`
                                      : `${roleLabel(draft.role)} preset`
                                  } · ${scopeLabel(draft.scope)}`}
                        </p>
                      </div>
                      <div className="access-overview-actions">
                        <button
                          type="button"
                          className="rp-button rp-button-secondary"
                          onClick={() => navigate('permissions')}
                        >
                          {isSuperAdminTarget ? 'View capabilities' : 'Customize permissions'}{' '}
                          <ArrowRight size={18} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="rp-button rp-button-text"
                          onClick={() => navigate('races')}
                        >
                          Race scope
                        </button>
                      </div>
                    </section>
                  </div>
                </div>
              )}

              {section === 'permissions' && (
                <>
                  <div className="access-permissions-summary-bar">
                    <p className="access-intro">
                      The <strong>{roleLabel(draft.role)}</strong> preset supplies defaults. Switch
                      any capability to customize; required permissions adjust together.
                    </p>
                    <span className="access-effective-pill">
                      {summary.effectiveCount} / {summary.totalCount} effective now
                    </span>
                  </div>

                  {isSuperAdminTarget && (
                    <div className="access-inline-notice">
                      <strong>Super Admin capabilities are locked to full access</strong>
                      <p>
                        Super Admin accounts retain all {allPermissionKeys.length} operational and
                        personal permissions across every race. To restrict capabilities, choose Admin,
                        Organizer, or Runner on Overview.
                      </p>
                    </div>
                  )}

                  {draft.status === 'suspended' && (
                    <div role="status" className="access-inline-notice is-error">
                      <strong>Account access is suspended</strong>
                      <p>
                        All capabilities below remain paused while suspended. Set Status to Active on
                        Overview to restore access.
                      </p>
                    </div>
                  )}

                  {draft.role === 'organizer' && !draft.approved && (
                    <div role="status" className="access-inline-notice">
                      <strong>Organizer approval is pending</strong>
                      <p>
                        Personal participation permissions work now, while operational permissions stay
                        paused until Approved for organizer operations is checked on Overview.
                      </p>
                    </div>
                  )}

                  {lastCascade && (
                    <div role="status" aria-live="polite" className="access-inline-notice access-cascade-notice">
                      <div>
                        <strong>Dependencies adjusted</strong>
                        <p>{lastCascade.message}</p>
                      </div>
                      <div className="access-cascade-actions">
                        <button
                          type="button"
                          className="rp-button rp-button-secondary"
                          onClick={() => {
                            onChange(lastCascade.previousDraft);
                            setLastCascade(null);
                          }}
                        >
                          Undo
                        </button>
                        <button
                          type="button"
                          className="rp-button rp-button-text"
                          onClick={() => setLastCascade(null)}
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="access-domain-tabs" role="group" aria-label="Filter permissions by workspace domain">
                    {permissionDomains.map((domain) => {
                      const domainKeys = domain.groups.flatMap((group) => groups[group as keyof typeof groups] || []);
                      const enabledInDomain = isSuperAdminTarget
                        ? domainKeys.length
                        : domainKeys.filter((key) => draft.overrides[key] ?? base[key]).length;
                      const active = domainFilter === domain.id;
                      return (
                        <button
                          key={domain.id}
                          type="button"
                          aria-pressed={active}
                          className={`access-domain-pill ${active ? 'is-active' : ''}`}
                          onClick={() => setDomainFilter(domain.id)}
                        >
                          <span>{domain.label}</span>
                          <span className="access-domain-count">
                            {enabledInDomain}/{domainKeys.length}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="access-permission-toolbar">
                    <div className="access-search-wrap">
                      <label className="access-search">
                        <Search size={20} aria-hidden="true" />
                        <input
                          aria-label="Find a permission"
                          placeholder="Search permissions or keys…"
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                      </label>
                      {query && (
                        <button
                          type="button"
                          className="rp-icon-button access-search-clear"
                          aria-label="Clear permission search"
                          onClick={() => setQuery('')}
                        >
                          <X size={18} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <div className="access-state-filter">
                      <label htmlFor={`${id}-perm-state`} className="sr-only">
                        Filter by configured state
                      </label>
                      <Select
                        id={`${id}-perm-state`}
                        aria-label="Filter by configured state"
                        value={stateFilter}
                        onChange={(value) => setStateFilter(value as PermissionStateFilter)}
                        surface="card"
                        size="lg"
                        options={[
                          { value: 'all', label: 'All states' },
                          { value: 'enabled', label: 'Enabled only' },
                          { value: 'disabled', label: 'Disabled only' },
                        ]}
                      />
                    </div>
                    <label className="access-filter-toggle">
                      <input
                        type="checkbox"
                        disabled={isSuperAdminTarget}
                        checked={!isSuperAdminTarget && onlyOverrides}
                        onChange={(event) => setOnlyOverrides(event.target.checked)}
                      />
                      Only overrides
                    </label>
                    <button
                      type="button"
                      className="rp-button rp-button-secondary access-expand-toggle"
                      disabled={isFiltered || !filteredGroups.length}
                      aria-expanded={allVisibleExpanded}
                      onClick={toggleAllGroups}
                    >
                      {allVisibleExpanded ? 'Collapse all' : 'Expand all'}
                    </button>
                    <button
                      type="button"
                      className="rp-button rp-button-text"
                      disabled={!overrides || isSuperAdminTarget}
                      onClick={() => void resetAll()}
                    >
                      Reset all
                    </button>
                  </div>

                  {filteredGroups.map(({ group, permissions, visible }) => {
                    const enabledCount = isSuperAdminTarget
                      ? permissions.length
                      : permissions.filter((key) => draft.overrides[key] ?? base[key]).length;
                    const groupOverrideCount = isSuperAdminTarget
                      ? 0
                      : permissions.filter((key) => key in draft.overrides).length;
                    const isOpen = isFiltered || openGroups.has(group);

                    return (
                      <details
                        className="access-permission-group"
                        key={group}
                        open={isOpen}
                        onToggle={(event) => {
                          if (isFiltered) return;
                          const nextOpen = event.currentTarget.open;
                          setOpenGroups((prev) => {
                            if (prev.has(group) === nextOpen) return prev;
                            const next = new Set(prev);
                            if (nextOpen) next.add(group);
                            else next.delete(group);
                            return next;
                          });
                        }}
                      >
                        <summary>
                          <ChevronRight size={20} className="access-group-chevron" aria-hidden="true" />
                          <span>
                            <strong>{group}</strong>
                            <span>{groupDescriptions[group]}</span>
                          </span>
                          <span className="access-group-badges">
                            {groupOverrideCount > 0 && (
                              <span className="access-group-override">
                                {groupOverrideCount} custom
                              </span>
                            )}
                            <span className="access-group-total">
                              {enabledCount}/{permissions.length} on
                            </span>
                          </span>
                        </summary>
                        <div>
                          {visible.map((key) => {
                            const switchId = `${id}-perm-${key}`;
                            const descId = `${id}-perm-desc-${key}`;
                            const evaluation = permissionEvaluation(draft, key);
                            const isOverride = evaluation.isOverride;
                            const checked = evaluation.configured;
                            const deps = permissionDependencies(key);
                            const dependents = permissionDependents(key);
                            const desc = permissionDescription(key);
                            const blockNote =
                              evaluation.blockedBy === 'suspended' && evaluation.configured
                                ? 'Paused while suspended'
                                : evaluation.blockedBy === 'pending-approval' && evaluation.configured
                                  ? 'Paused until organizer approved'
                                  : evaluation.blockedBy === 'dependency'
                                    ? 'Blocked by missing prerequisite'
                                    : '';
                            return (
                              <div
                                className={`access-permission-row ${highlightedPerm === key ? 'is-highlighted' : ''}`}
                                key={key}
                              >
                                <div className="access-permission-info">
                                  <label htmlFor={switchId} className="access-permission-label">
                                    <strong>{permissionTitle(key)}</strong>
                                  </label>
                                  <div id={descId} className="access-permission-details">
                                    {desc && <p className="access-permission-desc">{desc}</p>}
                                    <div className="access-permission-meta">
                                      <span className={`access-perm-origin ${isOverride ? 'is-custom' : ''}`}>
                                        {isSuperAdminTarget
                                          ? 'Locked to Super Admin'
                                          : isOverride
                                            ? `Custom override (${checked ? 'Granted' : 'Denied'})`
                                            : `From ${roleLabel(draft.role)} preset`}
                                      </span>
                                      {blockNote && (
                                        <span className="access-perm-paused">
                                          {' · '}
                                          {blockNote}
                                        </span>
                                      )}
                                      {deps.length > 0 && (
                                        <span className="access-dep-list">
                                          {' · '}Requires:{' '}
                                          {deps.map((dep, idx) => (
                                            <span key={dep}>
                                              {idx > 0 ? ', ' : ''}
                                              <button
                                                type="button"
                                                className="access-dep-link"
                                                onClick={() => jumpToPermission(dep)}
                                              >
                                                {permissionTitle(dep)}
                                              </button>
                                            </span>
                                          ))}
                                        </span>
                                      )}
                                      {dependents.length > 0 && (
                                        <span className="access-dep-list">
                                          {' · '}Used by:{' '}
                                          {dependents.length <= 2 ? (
                                            dependents.map((item, idx) => (
                                              <span key={item}>
                                                {idx > 0 ? ', ' : ''}
                                                <button
                                                  type="button"
                                                  className="access-dep-link"
                                                  onClick={() => jumpToPermission(item)}
                                                >
                                                  {permissionTitle(item)}
                                                </button>
                                              </span>
                                            ))
                                          ) : (
                                            `${dependents.length} dependent permissions`
                                          )}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="access-permission-actions">
                                  {isOverride && (
                                    <button
                                      type="button"
                                      className="rp-button rp-button-text"
                                      aria-label={`Reset ${permissionLabel(key)} to preset`}
                                      onClick={() => {
                                        setLastCascade(null);
                                        onChange(resetPermission(draft, key));
                                      }}
                                    >
                                      Reset
                                    </button>
                                  )}
                                  <input
                                    id={switchId}
                                    className="access-switch"
                                    role="switch"
                                    type="checkbox"
                                    disabled={isSuperAdminTarget}
                                    checked={checked}
                                    aria-describedby={descId}
                                    onChange={(event) =>
                                      handleTogglePermission(key, event.target.checked)
                                    }
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    );
                  })}

                  {filteredGroups.length === 0 && (
                    <div className="access-empty">
                      <Search size={30} aria-hidden="true" />
                      <h3>{onlyOverrides && !overrides ? 'No custom overrides' : 'No permissions match'}</h3>
                      <p>
                        {onlyOverrides && !overrides
                          ? 'This account follows its role preset.'
                          : 'Try clearing search or domain/state filters.'}
                      </p>
                      {isFiltered && (
                        <button
                          type="button"
                          className="rp-button rp-button-secondary"
                          onClick={() => {
                            setDomainFilter('all');
                            setStateFilter('all');
                            setOnlyOverrides(false);
                            setQuery('');
                          }}
                        >
                          Reset permission filters
                        </button>
                      )}
                    </div>
                  )}

                  <div className="access-authority-note">
                    <LockKeyhole size={22} aria-hidden="true" />
                    <p>
                      Access administration and restricted destructive actions remain exclusive to
                      Super Admins.
                    </p>
                  </div>
                </>
              )}

              {section === 'races' && (
                <>
                  <p className="access-intro">
                    Choose where operational permissions apply. Personal records stay limited to this
                    user, and public event information remains public.
                  </p>
                  {isSuperAdminTarget && (
                    <div className="access-inline-notice">
                      <strong>Global race access is locked for Super Admins</strong>
                      <p>
                        Super Admin operational permissions apply across all existing and future
                        races. Choose Admin or Organizer on Overview to limit race scope.
                      </p>
                    </div>
                  )}
                  <div className="access-field">
                    <label htmlFor={`${id}-race-scope`}>Operational race scope</label>
                    <Select
                      id={`${id}-race-scope`}
                      disabled={isSuperAdminTarget}
                      value={isSuperAdminTarget ? 'all' : draft.scope}
                      onChange={(value) =>
                        onChange({
                          ...draft,
                          scope: value,
                          raceIds: value === 'selected' ? draft.raceIds : [],
                        })
                      }
                      surface="card"
                      size="lg"
                      options={[
                        { value: 'owned-assigned', label: 'Owned + assigned races' },
                        { value: 'selected', label: 'Selected races' },
                        { value: 'all', label: 'All races' },
                      ]}
                    />
                  </div>
                  {!isSuperAdminTarget && draft.scope === 'selected' ? (
                    <section className="access-block">
                      <div className="access-block-heading">
                        <h3>
                          Select races <span className="access-count">{draft.raceIds.length}</span>
                        </h3>
                        <p>Only these events will be available in the operational workspace.</p>
                      </div>
                      <div className="access-race-toolbar">
                        <div className="access-search-wrap">
                          <label className="access-search">
                            <Search size={20} aria-hidden="true" />
                            <input
                              aria-label="Search races"
                              placeholder="Search race events…"
                              value={raceQuery}
                              onChange={(event) => setRaceQuery(event.target.value)}
                            />
                          </label>
                          {raceQuery && (
                            <button
                              type="button"
                              className="rp-icon-button access-search-clear"
                              aria-label="Clear race search"
                              onClick={() => setRaceQuery('')}
                            >
                              <X size={18} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                        {filteredRaces.length > 0 && (
                          <div className="access-race-quick-actions">
                            <button
                              type="button"
                              className="rp-button rp-button-secondary"
                              onClick={() =>
                                onChange({
                                  ...draft,
                                  raceIds: [
                                    ...new Set([
                                      ...draft.raceIds,
                                      ...filteredRaces.map((race) => race.id),
                                    ]),
                                  ],
                                })
                              }
                            >
                              Select visible
                            </button>
                            <button
                              type="button"
                              className="rp-button rp-button-text"
                              disabled={!draft.raceIds.length}
                              onClick={() => onChange({ ...draft, raceIds: [] })}
                            >
                              Clear all
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="access-race-list">
                        {filteredRaces.map((race) => (
                          <label className="access-check-row" key={race.id}>
                            <input
                              type="checkbox"
                              checked={draft.raceIds.includes(race.id)}
                              onChange={(event) =>
                                onChange({
                                  ...draft,
                                  raceIds: event.target.checked
                                    ? [...draft.raceIds, race.id]
                                    : draft.raceIds.filter((raceId) => raceId !== race.id),
                                })
                              }
                            />
                            <span>
                              <strong>{race.name}</strong>
                              <span>{race.date}</span>
                            </span>
                          </label>
                        ))}
                        {!props.races.length && (
                          <p className="access-intro">No events have been created yet.</p>
                        )}
                        {props.races.length > 0 && !filteredRaces.length && (
                          <p className="access-intro">No race events match "{raceQuery}".</p>
                        )}
                      </div>
                      {draft.raceIds.length === 0 && (
                        <p className="access-inline-notice">
                          No races are selected. This user will have no operational race access with
                          this scope.
                        </p>
                      )}
                    </section>
                  ) : (
                    <div className="access-scope-explanation">
                      <MapPinned size={30} aria-hidden="true" />
                      <h3>{scopeLabel(isSuperAdminTarget ? 'all' : draft.scope)}</h3>
                      <p>
                        {isSuperAdminTarget || draft.scope === 'all'
                          ? 'Operational permissions apply to every race, including future events.'
                          : 'Operational permissions apply to races this person creates and races whose organizer team includes them.'}
                      </p>
                    </div>
                  )}
                </>
              )}

              {section === 'history' && (
                <>
                  <div className="access-history-heading">
                    <p className="access-intro">
                      Every saved access change records who made it and what changed. Restoring a
                      configuration creates a new history entry.
                    </p>
                    <button
                      type="button"
                      className="rp-button rp-button-secondary"
                      disabled={props.historyBusy}
                      onClick={() => void props.onLoadHistory()}
                    >
                      {props.historyBusy ? 'Loading…' : 'Refresh history'}
                    </button>
                  </div>
                  {props.historyBusy && <p role="status">Loading access history…</p>}
                  {props.historyLoaded && !props.history.length && (
                    <div className="access-empty">
                      <History size={32} aria-hidden="true" />
                      <h3>No access changes yet</h3>
                      <p>Saved changes will appear here with their author and time.</p>
                    </div>
                  )}
                  <ol className="access-history-list">
                    {props.history.map((entry) => {
                      const entryChanges = historyEntryChanges(entry.before, entry.after, raceNameMap);
                      return (
                        <li key={entry.id}>
                          <div className="access-history-entry">
                            <p className="access-eyebrow">{formatDateTime(entry.at)}</p>
                            <h3>
                              {entry.action === 'restore'
                                ? 'Configuration restored'
                                : entry.action === 'remove'
                                  ? 'App access removed'
                                  : 'Access updated'}
                            </h3>
                            <p>By {entry.actorName || entry.actorUid}</p>
                            <p>
                              {roleLabel(entry.before.role)}{' '}
                              <ArrowRight size={14} className="access-inline-icon" aria-hidden="true" />{' '}
                              {roleLabel(entry.after.role)} ·{' '}
                              {scopeLabel(
                                entry.after.role === 'superadmin'
                                  ? 'all'
                                  : entry.after.access?.scope || 'owned-assigned',
                              )}
                            </p>
                            {entryChanges.length > 0 && (
                              <ul className="access-history-diffs" aria-label="Changes in this revision">
                                {entryChanges.map((diff) => (
                                  <li key={diff.label}>
                                    <strong>{diff.label}:</strong> {diff.before} to {diff.after}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <button
                            type="button"
                            className="rp-button rp-button-secondary"
                            disabled={!props.ready || busy || props.conflicted}
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: 'Restore this access configuration?',
                                  message:
                                    'The saved role, permissions and race scope will replace the current configuration. This restoration will be recorded as a new change.',
                                  confirmLabel: 'Restore access',
                                  cancelLabel: 'Keep current access',
                                })
                              ) {
                                await props.onRestore(entry);
                              }
                            }}
                          >
                            Restore configuration
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}

              {section === 'review' && (
                <>
                  <p className="access-intro">
                    Review the differences before applying them to <strong>{user.displayName}</strong>
                    . These changes take effect when saved.
                  </p>
                  {changes.length ? (
                    <div className="access-review-list">
                      {changes.map((change) => (
                        <div className="access-review-row" key={change.label}>
                          <strong>{change.label}</strong>
                          <div>
                            <span>{change.before}</span>
                            <ArrowRight size={18} aria-label="changes to" />
                            <strong>{change.after}</strong>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="access-empty">
                      <Check size={32} aria-hidden="true" />
                      <h3>No changes to save</h3>
                      <p>Update a role, permission or race scope first.</p>
                    </div>
                  )}
                </>
              )}
            </fieldset>
          </div>
        </main>
      </div>

      <footer className="access-workspace-footer">
        <div className="access-save-status">
          <span className={`access-save-dot ${props.dirty ? 'is-dirty' : ''}`} />
          <span>
            {busy
              ? 'Saving access…'
              : props.dirty
                ? `${changes.length} unsaved change${changes.length === 1 ? '' : 's'}`
                : 'All changes saved'}
          </span>
        </div>
        <div className="access-footer-actions">
          <button
            type="button"
            className="rp-button rp-button-secondary"
            disabled={busy}
            onClick={section === 'review' ? () => navigate(lastEditSection) : props.onClose}
          >
            {section === 'review' ? (
              <>
                <ArrowLeft size={18} aria-hidden="true" /> Keep editing
              </>
            ) : (
              'Cancel'
            )}
          </button>
          <button
            type="button"
            className="rp-button rp-button-primary"
            disabled={!props.ready || !props.loaded || !props.dirty || busy || props.conflicted}
            onClick={() => (section === 'review' ? void props.onSave() : navigate('review'))}
          >
            {busy ? 'Saving…' : section === 'review' ? 'Save access changes' : 'Review changes'}
            {!busy && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </div>
      </footer>
    </DialogSurface>
  );
}
