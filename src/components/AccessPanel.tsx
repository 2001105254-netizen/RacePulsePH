import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { ArrowRight, Search, X } from 'lucide-react';
import { db } from '../firebase';
import { Race, UserProfile } from '../types';
import { accessCommand } from '../lib/access';
import { subscribeSharedRaces } from '../lib/racesStore';
import { formatDateTime } from '../lib/preciseTime';
import { roleLabel, roles } from '../lib/accessPolicy';
import { AccessDraft, draftKey, draftSummary, normalizeDraft, scopeLabel } from '../lib/accessDraft';
import AccessWorkspace, { AccessHistoryEntry } from './AccessWorkspace';
import { useFeedback } from './ui/FeedbackProvider';
import { Select } from './ui/Select';

interface AccessRecord {
  scope?: string;
  raceIds?: string[];
  overrides?: Record<string, boolean>;
  status?: string;
  revision?: number;
  updatedAt?: string;
}

const fromServer = (user: UserProfile, value: AccessRecord = {}): AccessDraft =>
  normalizeDraft({
    role: user.role,
    approved: user.approved,
    scope: value.scope || (['admin', 'superadmin'].includes(user.role) ? 'all' : 'owned-assigned'),
    raceIds: value.raceIds || [],
    overrides: value.overrides || {},
    status: value.status || 'active',
  });

export default function AccessPanel({
  currentUserId,
  initialSelectedUid,
  onInitialSelectedHandled,
}: {
  currentUserId?: string;
  initialSelectedUid?: string | null;
  onInitialSelectedHandled?: () => void;
}) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [states, setStates] = useState<Record<string, AccessRecord>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(initialSelectedUid || null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!initialSelectedUid) return;
    setSelected(initialSelectedUid);
    onInitialSelectedHandled?.();
  }, [initialSelectedUid, onInitialSelectedHandled]);

  useEffect(
    () =>
      onSnapshot(
        collection(db, 'users'),
        (snap) => {
          setUsers(
            snap.docs
              .map((item) => item.data() as UserProfile)
              .sort((a, b) => a.displayName.localeCompare(b.displayName)),
          );
          setLoading(false);
        },
        (err) => {
          setError(err.message);
          setLoading(false);
        },
      ),
    [],
  );

  useEffect(
    () =>
      onSnapshot(
        collection(db, 'userAccess'),
        (snap) => setStates(Object.fromEntries(snap.docs.map((item) => [item.id, item.data()]))),
        (err) => setError(err.message),
      ),
    [],
  );

  const enriched = useMemo(
    () =>
      users.map((user) => {
        const record = states[user.uid];
        const normalized = fromServer(user, record);
        const summary = draftSummary(normalized);
        return { user, record, normalized, summary };
      }),
    [states, users],
  );

  const counts = useMemo(() => {
    let superadmin = 0;
    let admin = 0;
    let organizer = 0;
    let runner = 0;
    let customized = 0;
    let pending = 0;
    let suspended = 0;
    for (const item of enriched) {
      if (item.user.role === 'superadmin') superadmin += 1;
      else if (item.user.role === 'admin') admin += 1;
      else if (item.user.role === 'organizer') organizer += 1;
      else if (item.user.role === 'runner') runner += 1;
      if (item.summary.overrideCount > 0) customized += 1;
      if (item.user.role === 'organizer' && !item.user.approved) pending += 1;
      if (item.normalized.status === 'suspended') suspended += 1;
    }
    return {
      all: enriched.length,
      superadmin,
      admin,
      organizer,
      runner,
      customized,
      pending,
      suspended,
    };
  }, [enriched]);

  const queryTerm = search.trim().toLowerCase();
  const visible = enriched.filter(({ user, normalized, summary }) => {
    const matches =
      filter === 'all' ||
      user.role === filter ||
      (filter === 'customized' && summary.overrideCount > 0) ||
      (filter === 'pending' && user.role === 'organizer' && !user.approved) ||
      (filter === 'suspended' && normalized.status === 'suspended');
    const haystack = `${user.displayName} ${user.nickname || ''} ${user.username || ''} ${user.email}`.toLowerCase();
    return matches && (!queryTerm || haystack.includes(queryTerm));
  });

  const current = users.find((user) => user.uid === selected);

  const summaryFilters = [
    ['all', 'All people', counts.all],
    ['superadmin', 'Super Admins', counts.superadmin],
    ['admin', 'Admins', counts.admin],
    ['organizer', 'Organizers', counts.organizer],
    ['runner', 'Runners', counts.runner],
    ['customized', 'Custom overrides', counts.customized],
    ['pending', 'Pending approval', counts.pending],
    ['suspended', 'Suspended / removed', counts.suspended],
  ] as const;

  return (
    <section className="access-directory" aria-labelledby="access-directory-title">
      <div className="access-directory-heading">
        <div>
          <h2 id="access-directory-title">People and access</h2>
          <p>Choose a person to manage their role preset, individual permissions, and race scope.</p>
        </div>
        <span className="access-directory-total">{users.length} people</span>
      </div>
      {error && (
        <p role="alert" className="access-inline-notice is-error">
          {error}
        </p>
      )}
      <div className="access-directory-summary" role="group" aria-label="Quick directory filters">
        {summaryFilters.map(([key, label, value]) => (
          <button
            key={key}
            type="button"
            className={`access-summary-chip ${filter === key ? 'is-active' : ''}`}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            <span>{label}</span>
            <strong>{value}</strong>
          </button>
        ))}
      </div>
      <div className="access-directory-toolbar">
        <div className="access-search-wrap">
          <label className="access-search">
            <Search size={20} aria-hidden="true" />
            <input
              aria-label="Search users"
              placeholder="Search by name, username, or email…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {search && (
            <button
              type="button"
              className="rp-icon-button access-search-clear"
              aria-label="Clear user search"
              onClick={() => setSearch('')}
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="access-field access-role-filter">
          <label htmlFor="access-people-filter" className="sr-only">
            Filter people
          </label>
          <Select
            id="access-people-filter"
            aria-label="Filter people"
            value={filter}
            onChange={setFilter}
            surface="card"
            size="lg"
            options={[
              { value: 'all', label: 'All people' },
              ...roles.map((role) => ({ value: role, label: roleLabel(role) })),
              { value: 'customized', label: 'Customized access' },
              { value: 'pending', label: 'Pending approval' },
              { value: 'suspended', label: 'Suspended or removed' },
            ]}
          />
        </div>
      </div>
      <div className="access-directory-columns" aria-hidden="true">
        <span>Person</span>
        <span>Role and permissions</span>
        <span>Race access</span>
        <span>Status</span>
        <span />
      </div>
      {loading && (
        <p role="status" className="access-empty">
          Loading people…
        </p>
      )}
      <ul className="access-user-list">
        {visible.map(({ user, record, normalized, summary }) => {
          const count = summary.overrideCount;
          const status =
            user.accessRemoved && normalized.status === 'suspended'
              ? 'Removed'
              : normalized.status === 'suspended'
                ? 'Suspended'
                : user.role === 'organizer' && !user.approved
                  ? 'Pending approval'
                  : 'Active';
          const isSelf = Boolean(currentUserId && currentUserId === user.uid);
          const scopeDetail =
            user.role === 'superadmin'
              ? 'All races'
              : normalized.scope === 'selected'
                ? `Selected (${normalized.raceIds.length})`
                : scopeLabel(normalized.scope);
          return (
            <li key={user.uid} className="access-user-row">
              <div className="access-user-person">
                <span className="access-avatar" aria-hidden="true">
                  {user.displayName?.trim().charAt(0) || 'U'}
                </span>
                <div>
                  <h3>
                    {user.displayName}
                    {isSelf ? ' (You)' : ''}
                  </h3>
                  <p>
                    {user.username ? `@${user.username} · ` : ''}
                    {user.email}
                  </p>
                </div>
              </div>
              <div className="access-user-role">
                <strong>{roleLabel(user.role)}</strong>
                <span>
                  {summary.suspended
                    ? '0 active (suspended)'
                    : user.role === 'superadmin'
                      ? `Full platform access (${summary.totalCount} active)`
                      : count
                        ? `${summary.effectiveCount}/${summary.totalCount} active · ${count} override${count === 1 ? '' : 's'}`
                        : summary.pendingApproval
                          ? `Personal only (${summary.effectiveCount} active)`
                          : `Preset · ${summary.effectiveCount}/${summary.totalCount} active`}
                </span>
              </div>
              <p className="access-user-scope">{scopeDetail}</p>
              <div className="access-user-status-cell">
                <span className={`access-status ${status === 'Active' ? 'is-active' : ''}`}>
                  {status}
                </span>
                {record?.updatedAt && (
                  <span className="access-user-updated">Updated {formatDateTime(record.updatedAt)}</span>
                )}
              </div>
              <button
                type="button"
                className="rp-button rp-button-secondary"
                aria-label={`Manage access for ${user.displayName}`}
                onClick={() => setSelected(user.uid)}
              >
                Manage access <ArrowRight size={18} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {!loading && !visible.length && (
        <div className="access-empty">
          <Search size={30} aria-hidden="true" />
          <h3>No people match your search</h3>
          <p>Try another name or choose a different filter.</p>
        </div>
      )}
      <p className="access-directory-count" role="status">
        Showing {visible.length} of {users.length} people
      </p>
      {current && (
        <AccessEditor
          key={current.uid}
          user={current}
          currentUserUid={currentUserId}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function AccessEditor({
  user,
  currentUserUid,
  onClose,
}: {
  user: UserProfile;
  currentUserUid?: string;
  onClose: () => void;
}) {
  const { confirm, notify } = useFeedback();
  const [baseline, setBaseline] = useState(() => fromServer(user));
  const [draft, setDraft] = useState(() => fromServer(user));
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflicted, setConflicted] = useState(false);
  const [races, setRaces] = useState<Race[]>([]);
  const [history, setHistory] = useState<AccessHistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);

  const dirty = draftKey(draft) !== draftKey(baseline);
  const live = useRef({ dirty, revision, baseline });
  live.current = { dirty, revision, baseline };
  const saveAttempt = useRef<{ key: string; id: string } | null>(null);

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'userAccess', user.uid),
        (snap) => {
          const value = snap.data() as AccessRecord | undefined;
          const nextRevision = value?.revision || 0;
          if (live.current.dirty) {
            if (
              nextRevision !== live.current.revision ||
              user.role !== live.current.baseline.role ||
              user.approved !== live.current.baseline.approved
            ) {
              setConflicted(true);
              setError(
                'Close and reopen this editor to review the latest settings. Your unsaved changes have not been applied.',
              );
            }
            return;
          }
          const next = fromServer(user, value);
          setBaseline(next);
          setDraft(next);
          setRevision(nextRevision);
          setLoaded(true);
        },
        (err) => setError(err.message),
      ),
    [user.uid, user.role, user.approved],
  );

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'accessSystem', 'rollout'),
        (snap) => setReady(snap.data()?.enforcementReady === true),
        (err) => setError(err.message),
      ),
    [],
  );

  useEffect(
    () =>
      subscribeSharedRaces((list, racesLoaded, err) => {
        if (err) {
          setError(err);
          return;
        }
        if (racesLoaded) setRaces([...list].sort((a, b) => b.date.localeCompare(a.date)));
      }),
    [],
  );

  const close = async () => {
    if (busy) return;
    if (
      !dirty ||
      (await confirm({
        title: 'Discard unsaved changes?',
        message: `Your edits to ${user.displayName} haven’t been saved. Discard them to return to the user list.`,
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        destructive: true,
      }))
    ) {
      onClose();
    }
  };

  const save = async () => {
    if (busy || conflicted || !ready || !dirty) return;
    const payloadDraft = normalizeDraft(draft);
    const key = draftKey(payloadDraft);
    if (saveAttempt.current?.key !== key) saveAttempt.current = { key, id: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      await accessCommand('save', {
        ...payloadDraft,
        uid: user.uid,
        revision,
        requestId: saveAttempt.current.id,
      });
      onClose();
      notify({
        tone: 'success',
        title: 'Access updated',
        message: `${user.displayName}’s settings were saved and recorded in history.`,
      });
    } catch (err: any) {
      setError(err.message || 'Please try saving again.');
    } finally {
      setBusy(false);
    }
  };

  const loadHistory = async () => {
    setHistoryBusy(true);
    try {
      setHistory((await accessCommand('history', { uid: user.uid })).history);
      setHistoryLoaded(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setHistoryBusy(false);
    }
  };

  const restore = async (entry: AccessHistoryEntry) => {
    if (busy || conflicted || !ready) return;
    setBusy(true);
    setError('');
    try {
      await accessCommand('restore', {
        uid: user.uid,
        revision,
        historyId: entry.id,
        requestId: crypto.randomUUID(),
      });
      onClose();
      notify({
        tone: 'success',
        title: 'Access restored',
        message: 'The restored configuration was recorded as a new history entry.',
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async () => {
    if (busy || conflicted || !ready || user.uid === currentUserUid) return;
    setBusy(true);
    setError('');
    try {
      await accessCommand('remove', {
        uid: user.uid,
        revision,
        requestId: crypto.randomUUID(),
      });
      onClose();
      notify({
        tone: 'success',
        title: 'App access removed',
        message: `${user.displayName} no longer has active app access.`,
      });
    } catch (err: any) {
      setError(err.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccessWorkspace
      user={user}
      currentUserUid={currentUserUid}
      baseline={baseline}
      draft={draft}
      onChange={setDraft}
      ready={ready}
      loaded={loaded}
      dirty={dirty}
      busy={busy}
      error={error}
      conflicted={conflicted}
      races={races}
      history={history}
      historyBusy={historyBusy}
      historyLoaded={historyLoaded}
      onClose={() => void close()}
      onSave={save}
      onLoadHistory={loadHistory}
      onRestore={restore}
      onRemove={removeAccount}
    />
  );
}
