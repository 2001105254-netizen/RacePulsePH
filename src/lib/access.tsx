import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { subscribeSharedRaces } from './racesStore';
import { auth, db } from '../firebase';
import { Race, UserProfile } from '../types';
import { defaults } from './accessPolicy';
import { getAppCheckHeaders } from './botProtection';
import { resolveCloudFunctionBaseUrl } from './devFunctionsProxy';
import { boundedFetch, parseRetryAfterSeconds } from './resilientFetch';
import catalog from './access-presets.json';
type AccessState = { overrides?: Record<string, boolean>; permissions?: Record<string, boolean>; scope?: string; raceIds?: string[]; status?: string; revision?: number };
type AccessContextValue = { can: (key: string) => boolean; inScope: (race: Race) => boolean; authority: boolean; ready: boolean; suspended: boolean; state: AccessState; version: string };
const denied: AccessContextValue = { can: () => false, inScope: () => false, authority: false, ready: false, suspended: false, state: {}, version: '' };
const Context = createContext(denied);
export const AccessContext = Context;
export const useAccess = () => useContext(Context);
export interface ScopedRacesState {
  races: Race[];
  loading: boolean;
  error: string | null;
}

export function useScopedRacesState(): ScopedRacesState {
  const { inScope, version } = useAccess();
  const [state, setState] = useState<ScopedRacesState>({ races: [], loading: true, error: null });
  useEffect(() => {
    setState(prev => ({ races: prev.races, loading: prev.races.length === 0, error: null }));
    return subscribeSharedRaces((rawList, loaded, err) => {
      if (err) {
        setState({
          races: [],
          loading: false,
          error: err || 'Unable to load race events.',
        });
        return;
      }
      if (!loaded) return;
      setState({
        races: rawList.filter(inScope),
        loading: false,
        error: null,
      });
    });
  }, [inScope, version]);
  return state;
}

export function useScopedRaces() {
  return useScopedRacesState().races;
}
export function AccessProvider({ profile, children, onLoadState }: { profile: UserProfile; children: React.ReactNode; onLoadState?: (state: 'loading' | 'ready' | 'error') => void }) {
  const [state, setState] = useState<AccessState>({}), [ready, setReady] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    setReady(false);
    setError('');
    if (import.meta.env.DEV && profile.uid.startsWith('e2e-')) {
      setState({
        status: 'active',
        permissions: defaults(profile.role),
        scope: 'all',
      });
      setReady(true);
      return;
    }
    let syncedMissingPerms = false;
    return onSnapshot(
      doc(db, 'userAccess', profile.uid),
      (snap) => {
        const data = (snap.data() || {}) as AccessState;
        setState(data);
        setReady(snap.exists());
        if (!snap.exists()) {
          void accessCommand('session', {}).catch((e) => setError(e.message));
          return;
        }
        if (!syncedMissingPerms) {
          const expectedKeys = Object.keys(defaults(profile.role));
          const perms = data.permissions;
          if (!perms || expectedKeys.some((key) => typeof perms[key] !== 'boolean')) {
            syncedMissingPerms = true;
            void accessCommand('session', {}).catch(() => {});
          }
        }
      },
      (e) => {
        setError(e.message);
        setReady(false);
      },
    );
  }, [profile.uid, profile.role]);
  // Report after commit so a successful signal includes the mounted workspace.
  useEffect(() => { onLoadState?.(error ? 'error' : ready ? 'ready' : 'loading'); }, [error, ready, onLoadState]);
  const value = useMemo<AccessContextValue>(() => {
    const active = ready && state.status !== 'suspended';
    // Super Admin is the platform owner. Legacy custom denies must not leave
    // that account unable to repair a race or its uploaded assets.
    const permissions = profile.role === 'superadmin'
      ? defaults(profile.role)
      : { ...defaults(profile.role), ...(state.overrides || {}) };
    const dependencies = catalog.dependencies as Record<string, string[]>;
    const can = (key: string) => active && permissions[key] === true && (key.startsWith('personal.') || profile.role !== 'organizer' || profile.approved) && (dependencies[key] || []).every((dep: string) => permissions[dep] === true);
    // A Super Admin is the platform owner. Older access documents may still
    // contain a selected or owned-only scope from before the role was changed;
    // that must never hide races or lock the Super Admin out of Race Setup.
    const scope = profile.role === 'superadmin' ? 'all' : (state.scope || (profile.role === 'admin' ? 'all' : 'owned-assigned'));
    return { ready, suspended: state.status === 'suspended', can, authority: active && profile.role === 'superadmin', state, version: `${profile.uid}:${profile.role}:${profile.approved}:${state.revision || 0}`,
      inScope: race => active && (scope === 'all' || (scope === 'selected' && (state.raceIds || []).includes(race.id)) || (scope === 'owned-assigned' && (race.createdBy === profile.uid || (race.organizerIds || []).includes(profile.uid)))) };
  }, [profile, state, ready]);
  if (error) return <div role="alert" className="p-8 text-center">Could not load access settings. <button onClick={() => window.location.reload()}>Try again</button></div>;
  return <Context.Provider value={value}>{ready ? children : <p role="status" className="p-8 text-center">Loading access…</p>}</Context.Provider>;
}
export async function authenticatedFetch(url: string, init: RequestInit = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to continue.');
  const [token, appCheckHeaders] = await Promise.all([
    user.getIdToken(),
    getAppCheckHeaders(),
  ]);
  const isLanApi = url.startsWith('/api/');
  return boundedFetch(
    url,
    {
      ...init,
      headers: {
        ...appCheckHeaders,
        ...Object.fromEntries(new Headers(init.headers)),
        Authorization: `Bearer ${token}`,
      },
    },
    {
      maxRetries: 0,
      timeoutMs: 15_000,
      circuitKey: isLanApi ? '/api/lan' : undefined,
    },
  );
}
export async function accessCommand(path: string, body: object) {
  const url = resolveCloudFunctionBaseUrl({
    configuredUrl: import.meta.env.VITE_ACCESS_API_URL as string | undefined,
    defaultUrl: 'https://asia-southeast1-racepulseph.cloudfunctions.net/accessApi',
    functionName: 'accessApi',
  });
  const response = await authenticatedFetch(`${url}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retryAfter = parseRetryAfterSeconds(response, result);
    if (response.status === 429 && retryAfter > 0) {
      throw new Error(result.error || `Too many requests. Please wait ${retryAfter}s and try again.`);
    }
    throw new Error(result.error || 'Access request failed.');
  }
  return result;
}
