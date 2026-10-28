import { useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { ArrowRight, Search, ShieldCheck } from 'lucide-react';
import { db } from '../firebase';
import { Race, UserProfile } from '../types';
import { accessCommand } from '../lib/access';
import { roleLabel, roles } from '../lib/accessPolicy';
import { AccessDraft, draftKey, scopeLabel } from '../lib/accessDraft';
import AccessWorkspace, { AccessHistoryEntry } from './AccessWorkspace';
import { useFeedback } from './ui/FeedbackProvider';

interface AccessRecord { scope?: string; raceIds?: string[]; overrides?: Record<string, boolean>; status?: string; revision?: number }
const fromServer = (user: UserProfile, value: AccessRecord = {}): AccessDraft => ({ role: user.role, approved: user.approved, scope: value.scope || (['admin','superadmin'].includes(user.role) ? 'all' : 'owned-assigned'), raceIds: value.raceIds || [], overrides: value.overrides || {}, status: value.status || 'active' });

export default function AccessPanel() {
  const [users, setUsers] = useState<UserProfile[]>([]), [states, setStates] = useState<Record<string, AccessRecord>>({});
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [selected, setSelected] = useState<string | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => onSnapshot(collection(db, 'users'), snap => { setUsers(snap.docs.map(item => item.data() as UserProfile).sort((a,b) => a.displayName.localeCompare(b.displayName))); setLoading(false); }, error => { setError(error.message); setLoading(false); }), []);
  useEffect(() => onSnapshot(collection(db, 'userAccess'), snap => setStates(Object.fromEntries(snap.docs.map(item => [item.id, item.data()]))), error => setError(error.message)), []);
  const visible = users.filter(user => {
    const state = states[user.uid];
    const matches = filter === 'all' || user.role === filter || filter === 'customized' && Object.keys(state?.overrides || {}).length > 0 || filter === 'pending' && user.role === 'organizer' && !user.approved || filter === 'suspended' && state?.status === 'suspended';
    return matches && `${user.displayName} ${user.email}`.toLowerCase().includes(search.toLowerCase());
  });
  const current = users.find(user => user.uid === selected);
  return <section className="access-directory" aria-labelledby="access-directory-title">
    <div className="access-directory-heading"><div><p className="access-eyebrow"><ShieldCheck size={16} aria-hidden="true" /> Super Admin workspace</p><h2 id="access-directory-title">People & access</h2><p>Choose a person to manage their role, permissions and race access.</p></div><span className="access-directory-total">{users.length} people</span></div>
    {error && <p role="alert" className="access-inline-notice is-error">{error}</p>}
    <div className="access-directory-toolbar"><label className="access-search"><Search size={20} aria-hidden="true" /><input aria-label="Search users" placeholder="Search by name or email…" value={search} onChange={event => setSearch(event.target.value)} /></label><label className="access-field access-role-filter"><span className="sr-only">Filter people</span><select aria-label="Filter people" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All people</option>{roles.map(role => <option key={role} value={role}>{roleLabel(role)}</option>)}<option value="customized">Customized access</option><option value="pending">Pending approval</option><option value="suspended">Suspended</option></select></label></div>
    <div className="access-directory-columns" aria-hidden="true"><span>Person</span><span>Role & permissions</span><span>Race access</span><span>Status</span><span /></div>
    {loading && <p role="status" className="access-empty">Loading people…</p>}
    <ul className="access-user-list">{visible.map(user => {
      const state = states[user.uid], count = Object.keys(state?.overrides || {}).length;
      const status = state?.status === 'suspended' ? 'Suspended' : user.role === 'organizer' && !user.approved ? 'Pending approval' : 'Active';
      return <li key={user.uid} className="access-user-row"><div className="access-user-person"><span className="access-avatar" aria-hidden="true">{user.displayName?.trim().charAt(0) || 'U'}</span><div><h3>{user.displayName}</h3><p>{user.email}</p></div></div><div className="access-user-role"><strong>{roleLabel(user.role)}</strong><span>{count ? `${count} custom override${count === 1 ? '' : 's'}` : 'Preset permissions'}</span></div><p className="access-user-scope">{scopeLabel(state?.scope || (['admin','superadmin'].includes(user.role) ? 'all' : 'owned-assigned'))}</p><span className={`access-status ${status === 'Active' ? 'is-active' : ''}`}>{status}</span><button className="rp-button rp-button-secondary" aria-label={`Manage access for ${user.displayName}`} onClick={() => setSelected(user.uid)}>Manage access <ArrowRight size={18} aria-hidden="true" /></button></li>;
    })}</ul>
    {!loading && !visible.length && <div className="access-empty"><Search size={30} /><h3>No people match your search</h3><p>Try another name or choose a different filter.</p></div>}
    <p className="access-directory-count" role="status">Showing {visible.length} of {users.length} people</p>
    {current && <AccessEditor key={current.uid} user={current} onClose={() => setSelected(null)} />}
  </section>;
}

function AccessEditor({ user, onClose }: { user: UserProfile; onClose: () => void }) {
  const { confirm, notify } = useFeedback();
  const [baseline, setBaseline] = useState(() => fromServer(user)), [draft, setDraft] = useState(() => fromServer(user));
  const [revision, setRevision] = useState(0), [ready, setReady] = useState(false), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflicted, setConflicted] = useState(false);
  const [races, setRaces] = useState<Race[]>([]), [history, setHistory] = useState<AccessHistoryEntry[]>([]), [historyLoaded, setHistoryLoaded] = useState(false), [historyBusy, setHistoryBusy] = useState(false);
  const dirty = draftKey(draft) !== draftKey(baseline);
  const live = useRef({ dirty, revision, baseline }); live.current = { dirty, revision, baseline };
  const saveAttempt = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => onSnapshot(doc(db, 'userAccess', user.uid), snap => {
    const value = snap.data() as AccessRecord | undefined, nextRevision = value?.revision || 0;
    if (live.current.dirty) {
      if (nextRevision !== live.current.revision || user.role !== live.current.baseline.role || user.approved !== live.current.baseline.approved) { setConflicted(true); setError('Close and reopen this editor to review the latest settings. Your unsaved changes have not been applied.'); }
      return;
    }
    const next = fromServer(user, value); setBaseline(next); setDraft(next); setRevision(nextRevision); setLoaded(true);
  }, error => setError(error.message)), [user.uid, user.role, user.approved]);
  useEffect(() => onSnapshot(doc(db, 'accessSystem', 'rollout'), snap => setReady(snap.data()?.enforcementReady === true), error => setError(error.message)), []);
  useEffect(() => onSnapshot(collection(db, 'races'), snap => setRaces(snap.docs.map(item => ({ ...item.data(), id: item.id } as Race)).sort((a,b) => b.date.localeCompare(a.date))), error => setError(error.message)), []);
  const close = async () => {
    if (busy) return;
    if (!dirty || await confirm({ title: 'Discard unsaved changes?', message: `Your edits to ${user.displayName} haven’t been saved. Discard them to return to the user list.`, confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', destructive: true })) onClose();
  };
  const save = async () => {
    if (busy || conflicted || !ready || !dirty) return;
    const key = draftKey(draft); if (saveAttempt.current?.key !== key) saveAttempt.current = { key, id: crypto.randomUUID() };
    setBusy(true); setError('');
    try { await accessCommand('save', { ...draft, uid: user.uid, revision, requestId: saveAttempt.current.id }); onClose(); notify({ tone: 'success', title: 'Access updated', message: `${user.displayName}’s settings were saved and recorded in history.` }); }
    catch (error: any) { setError(error.message || 'Please try saving again.'); }
    finally { setBusy(false); }
  };
  const loadHistory = async () => {
    setHistoryBusy(true); try { setHistory((await accessCommand('history', { uid: user.uid })).history); setHistoryLoaded(true); } catch (error: any) { setError(error.message); } finally { setHistoryBusy(false); }
  };
  const restore = async (entry: AccessHistoryEntry) => {
    if (busy || conflicted || !ready) return;
    setBusy(true); setError('');
    try { await accessCommand('restore', { uid: user.uid, revision, historyId: entry.id, requestId: crypto.randomUUID() }); onClose(); notify({ tone: 'success', title: 'Access restored', message: 'The restored configuration was recorded as a new history entry.' }); } catch (error: any) { setError(error.message); } finally { setBusy(false); }
  };
  return <AccessWorkspace user={user} baseline={baseline} draft={draft} onChange={setDraft} ready={ready} loaded={loaded} dirty={dirty} busy={busy} error={error} conflicted={conflicted} races={races} history={history} historyBusy={historyBusy} historyLoaded={historyLoaded} onClose={() => void close()} onSave={save} onLoadHistory={loadHistory} onRestore={restore} />;
}
