import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Race, UserProfile } from '../types';
import { defaults } from './accessPolicy';
import catalog from './access-presets.json';
type AccessState = { overrides?: Record<string, boolean>; scope?: string; raceIds?: string[]; status?: string; revision?: number };
type AccessContextValue = { can: (key: string) => boolean; inScope: (race: Race) => boolean; authority: boolean; ready: boolean; suspended: boolean; state: AccessState; version: string };
const denied: AccessContextValue = { can: () => false, inScope: () => false, authority: false, ready: false, suspended: false, state: {}, version: '' };
const Context = createContext(denied);
export const useAccess = () => useContext(Context);
export function useScopedRaces() {
  const { inScope, version } = useAccess();
  const [races, setRaces] = useState<Race[]>([]);
  useEffect(() => onSnapshot(collection(db, 'races'), snap => setRaces(snap.docs.map(d => ({ ...d.data(), id: d.id } as Race)).filter(inScope)), () => setRaces([])), [inScope, version]);
  return races;
}
export function AccessProvider({ profile, children }: { profile: UserProfile; children: React.ReactNode }) {
  const [state, setState] = useState<AccessState>({}), [ready, setReady] = useState(false), [error, setError] = useState('');
  useEffect(() => { setReady(false); setError(''); return onSnapshot(doc(db, 'userAccess', profile.uid), snap => { setState(snap.data() || {}); setReady(snap.exists()); if (!snap.exists()) void accessCommand('session', {}).catch(e => setError(e.message)); }, e => { setError(e.message); setReady(false); }); }, [profile.uid]);
  const value = useMemo<AccessContextValue>(() => {
    const active = ready && state.status !== 'suspended';
    const permissions = { ...defaults(profile.role), ...(state.overrides || {}) };
    const can = (key: string) => active && permissions[key] === true && (key.startsWith('personal.') || profile.role !== 'organizer' || profile.approved) && (catalog.dependencies[key] || []).every((dep: string) => permissions[dep] === true);
    const scope = state.scope || (['admin','superadmin'].includes(profile.role) ? 'all' : 'owned-assigned');
    return { ready, suspended: state.status === 'suspended', can, authority: active && profile.role === 'superadmin', state, version: `${profile.uid}:${profile.role}:${profile.approved}:${state.revision || 0}`,
      inScope: race => active && (scope === 'all' || (scope === 'selected' && (state.raceIds || []).includes(race.id)) || (scope === 'owned-assigned' && (race.createdBy === profile.uid || (race.organizerIds || []).includes(profile.uid)))) };
  }, [profile, state, ready]);
  if (error) return <div role="alert" className="p-8 text-center">Could not load access settings. <button onClick={() => window.location.reload()}>Try again</button></div>;
  return <Context.Provider value={value}>{ready ? children : <p role="status" className="p-8 text-center">Loading access…</p>}</Context.Provider>;
}
export async function authenticatedFetch(url: string, init: RequestInit = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to continue.');
  const token = await user.getIdToken();
  return fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${token}` } });
}
export async function accessCommand(path: string, body: object) {
  const url = (import.meta.env.VITE_ACCESS_API_URL || 'https://asia-southeast1-racepulseph.cloudfunctions.net/accessApi').replace(/\/$/, '');
  const response = await authenticatedFetch(`${url}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Access request failed.');
  return result;
}
