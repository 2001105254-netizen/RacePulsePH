import { useState } from 'react';
import { signOutUser } from '../firebase';
import { UserProfile } from '../types';
import { useAccess } from '../lib/access';
import AdminDashboard from './AdminDashboard';
import RunnerDashboard from './RunnerDashboard';
export default function AuthorizedWorkspace({ profile, raceId, onRaceHandled }: { profile: UserProfile; raceId: string | null; onRaceHandled: () => void }) {
  const access = useAccess();
  const operations = access.authority || ['race.view','race.create','timing.view','roster.view','engraving.view','users.view','hub.manage'].some(access.can);
  const personal = ['personal.register','personal.results','personal.bibs','personal.certificates','personal.engraving','personal.friends'].some(access.can);
  const [selected, setSelected] = useState(operations ? 'operations' : 'personal');
  const workspace = selected === 'operations' && operations || !personal ? 'operations' : 'personal';
  if (access.suspended || (!operations && !personal)) return <div className="p-8 text-center space-y-4"><p>Your account currently has no active access. Contact a Super Admin.</p><button onClick={() => signOutUser()}>Sign out</button></div>;
  return <>
    {operations && personal && <div className="flex justify-center gap-3 p-3"><button className={`px-4 py-2 rounded-xl ${workspace === 'operations' ? 'bg-red-600 text-white' : 'glass-inset'}`} onClick={() => setSelected('operations')}>Operations</button><button className={`px-4 py-2 rounded-xl ${workspace === 'personal' ? 'bg-red-600 text-white' : 'glass-inset'}`} onClick={() => setSelected('personal')}>My participation</button></div>}
    {profile.role === 'organizer' && !profile.approved && <p className="text-center p-3 text-sm">Organizer operations are awaiting approval. Your personal features remain available.</p>}
    <div key={`${access.version}:${workspace}`}>
      {workspace === 'operations' ? <AdminDashboard profile={profile} /> : <RunnerDashboard profile={profile} initialRaceId={raceId} onInitialRaceHandled={onRaceHandled} />}
    </div>
  </>;
}
